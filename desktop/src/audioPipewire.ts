import { type ChildProcess, execFile, spawn } from "node:child_process"
import { promisify } from "node:util"
import type { AudioMode } from "./audioMode"
import {
  type PipewireObject,
  type PortPair,
  audioApps,
  linksInto,
  nodeIdByName,
  pairPorts,
  portsOf,
  wiringFor,
} from "./pipewireGraph"

const run = promisify(execFile)

/**
 * Per-application audio on Linux, through PipeWire and without a native addon.
 *
 * A sink of our own, one link per ticked application, and a single recorder
 * reading that sink's monitor. Out comes 16-bit stereo PCM at 48 kHz.
 *
 * Simpler than the Windows side, which needs one capture client per
 * application: here there is one recorder and N links. Which is also why there
 * is exactly ONE source id — see `SOURCE_ID`.
 */

const SINK_NAME = "gorila"

export const SAMPLE_RATE = 48000
export const CHANNELS = 2

/**
 * The id every chunk of PCM arrives under, and the only entry `setMode` ever
 * returns.
 *
 * It has to match on both sides. The renderer builds one worklet per id and
 * silently drops a chunk whose id has no worklet — so returning one id per pid
 * here, as the Windows backend legitimately does, throws away every sample
 * without a single error anywhere. On Linux the recorder is one; what separates
 * applications are the LINKS, not the sources.
 */
const SOURCE_ID = "pipewire"

/**
 * How long to wait for `pw-link` before giving up on it.
 *
 * `pw-link` does not return until the link leaves the `init` state, and a link
 * to an application that is not making sound at that instant stays in `init`
 * until it does. Without a ceiling the process lives forever, `setMode` never
 * answers and the broadcast sits on "preparing" with no error anywhere.
 *
 * Killing it is safe and correct: the link is already made — it is created with
 * `linger`, so it outlives the process and activates on its own when sound
 * returns. Measured, `pw-link` answers in 4-5 ms both to link and to complain
 * about a port that does not exist; the ceiling only ever costs time in the
 * idle case.
 */
const LINK_TIMEOUT_MS = 1000

/**
 * How often the wiring is compared against the graph while a mode is on.
 *
 * A mode is a standing intention, and nothing announces an application that
 * starts playing after it was picked. Worse, links are made against PORT IDS: a
 * player opens a node per stream and destroys it when the sound ends, so the
 * ports a link was made against stop existing the moment a video does — the
 * wiring decays on its own even with nobody touching anything.
 *
 * This is the ceiling on how late a game opened mid-broadcast becomes audible.
 * A `pw-dump` costs a few milliseconds, and the panel already asks for one at a
 * comparable rhythm.
 */
const RECONCILE_MS = 2000

/** Long enough for a graph change to settle, short enough not to be felt. */
const SETTLE_POLL_MS = 50
const SETTLE_ATTEMPTS = 60

/**
 * Receives the PCM. Module state, not a closure captured when the recorder was
 * built: the recorder is created once and outlives every change of mode, so a
 * receiver captured at creation would keep feeding whoever asked first.
 */
let deliver: ((sourceId: string, pcm: Buffer) => void) | null = null

let recorder: ChildProcess | null = null
let sinkModule: string | null = null

/** What the wiring is brought back to on every pass. */
let activeMode: AudioMode = { kind: "none" }
let reconciler: NodeJS.Timeout | null = null
let reconciling = false

async function dump(): Promise<PipewireObject[]> {
  const { stdout } = await run("pw-dump", [], { maxBuffer: 64 * 1024 * 1024 })
  const parsed: unknown = JSON.parse(stdout)
  // A trust boundary like any other: this is another program's output.
  return Array.isArray(parsed) ? (parsed as PipewireObject[]) : []
}

/** Applications currently making sound, for the list the person ticks. */
export async function listApps(): Promise<{ pid: number; name: string; binary: string }[]> {
  const graph = await dump()
  return audioApps(graph).map(({ pid, name, binary }) => ({ pid, name, binary }))
}

/**
 * Unloads sinks of ours that outlived a previous run.
 *
 * Tearing down on exit only covers a clean exit. A crash, a kill, or a session
 * that ends with the machine — none of those run it, and each leaves a phantom
 * audio device that survives on the person's machine and shows up in every
 * volume control from then on. Clearing them at startup is what makes that
 * self-healing instead of cumulative.
 */
async function unloadStaleSinks(): Promise<void> {
  const { stdout } = await run("pactl", ["list", "short", "modules"]).catch(() => ({ stdout: "" }))

  for (const line of stdout.split("\n")) {
    const [id, name, args] = line.split("\t")
    if (name !== "module-null-sink") continue
    if (args === undefined || !args.includes(`sink_name=${SINK_NAME}`)) continue
    if (id === undefined) continue
    await run("pactl", ["unload-module", id]).catch(() => undefined)
  }
}

async function ensureSink(): Promise<void> {
  if (sinkModule !== null) return

  await unloadStaleSinks()

  const { stdout } = await run("pactl", [
    "load-module",
    "module-null-sink",
    `sink_name=${SINK_NAME}`,
    `sink_properties=device.description=CompartilhaAiGorila`,
  ])
  sinkModule = stdout.trim()
}

/** The device sound normally comes out of, by node name. */
async function defaultSinkName(): Promise<string | null> {
  const { stdout } = await run("pactl", ["get-default-sink"]).catch(() => ({ stdout: "" }))
  const name = stdout.trim()
  return name.length > 0 ? name : null
}

async function unloadSink(): Promise<void> {
  if (sinkModule === null) return
  // Leaving it behind puts a phantom audio device on the person's machine that
  // outlives the app. Unloading takes the node, and with it every link into it,
  // so the per-application wiring needs no separate teardown.
  await run("pactl", ["unload-module", sinkModule]).catch(() => undefined)
  sinkModule = null
}

async function unlink(pairs: PortPair[]): Promise<void> {
  await Promise.all(
    pairs.map(([output, input]) =>
      run("pw-link", ["-d", String(output), String(input)], {
        timeout: LINK_TIMEOUT_MS,
      }).catch(() => undefined),
    ),
  )
}

/**
 * Makes every link at once, never one after another.
 *
 * In a queue a single silent application holds the ceiling of everyone behind
 * it, and "everything but Discord" links the whole list.
 */
async function link(pairs: PortPair[]): Promise<void> {
  await Promise.all(
    pairs.map(([output, input]) =>
      run("pw-link", [String(output), String(input)], { timeout: LINK_TIMEOUT_MS }).catch(
        // Killed by the ceiling: the link exists and counts, it just has not
        // activated. Any other failure means the application closed between the
        // dump and the link, and there is nothing to undo. Either way the next
        // pass reads the truth off the graph.
        () => undefined,
      ),
    ),
  )
}

/**
 * Brings the sink's inbound links back to what the mode asks for.
 *
 * Both sides come from the same fresh graph: what is wired, and what should be.
 * Neither is remembered between passes — a list kept here would go stale the
 * moment a player closed a stream, and silently.
 */
async function reconcile(): Promise<void> {
  const graph = await dump()
  const defaultSink = activeMode.kind === "system" ? await defaultSinkName() : null

  const wanted = wiringFor(graph, activeMode, SINK_NAME, defaultSink)
  // TRADEOFF: every inbound link is taken as ours, so an application routed
  // into the sink by hand from the system mixer is undone on the next pass.
  // Sparing those would mean telling them apart from the ones we made.
  const current = linksInto(graph, nodeIdByName(graph, SINK_NAME))

  const key = ([output, input]: PortPair): string => `${output}:${input}`
  const wantedKeys = new Set(wanted.map(key))
  const currentKeys = new Set(current.map(key))

  await unlink(current.filter((pair) => !wantedKeys.has(key(pair))))
  await link(wanted.filter((pair) => !currentKeys.has(key(pair))))
}

function startReconciling(): void {
  if (reconciler !== null) return

  reconciler = setInterval(() => {
    // A pass still running holds the next one: `pw-dump` on a busy graph can
    // outlast the interval, and two passes at once would each read the other's
    // half-made wiring and undo it.
    if (reconciling) return
    reconciling = true
    void reconcile()
      // A failed pass is not worth reporting: the next one is two seconds away
      // and reads the graph afresh.
      .catch(() => undefined)
      .finally(() => {
        reconciling = false
      })
  }, RECONCILE_MS)
}

function stopReconciling(): void {
  if (reconciler === null) return
  clearInterval(reconciler)
  reconciler = null
}

/** Polls until `check` is satisfied, or gives up with what it last saw. */
async function settle(check: () => Promise<boolean>): Promise<boolean> {
  for (let attempt = 0; attempt < SETTLE_ATTEMPTS; attempt += 1) {
    if (await check()) return true
    await new Promise((resolve) => setTimeout(resolve, SETTLE_POLL_MS))
  }
  return false
}

/**
 * Starts the recorder and wires it to our sink's monitor.
 *
 * `--target 0` matters: `--target` by name or by id is simply not obeyed —
 * WirePlumber connects the recorder to the default sink regardless, and the
 * recording comes out carrying everything. `0` takes automatic linking out of
 * the way so the link can be made by hand.
 */
async function ensureRecorder(): Promise<void> {
  if (recorder !== null) return

  await ensureSink()

  const started = spawn("pw-record", [
    "--target",
    "0",
    "--rate",
    String(SAMPLE_RATE),
    "--channels",
    String(CHANNELS),
    "--format",
    "s16",
    "-",
  ])

  started.stdout.on("data", (pcm: Buffer) => deliver?.(SOURCE_ID, pcm))
  started.on("error", () => {
    recorder = null
  })
  started.on("exit", () => {
    recorder = null
  })

  recorder = started

  // Waiting for the recorder's node to appear is not enough: its ports are
  // negotiated after it, and linking against an empty list links nothing and
  // complains about nothing. The recorder then stands there, mute, with no
  // error in any log.
  let pairs: PortPair[] = []
  const ready = await settle(async () => {
    const graph = await dump()
    const monitors = portsOf(graph, nodeIdByName(graph, SINK_NAME), "out")
    const inputs = portsOf(graph, recorderNodeId(graph, started.pid), "in")
    if (monitors.length === 0 || inputs.length === 0) return false
    pairs = pairPorts(monitors, inputs)
    return pairs.length > 0
  })

  if (!ready) {
    throw new Error(
      "o PipeWire não deu portas ao gravador a tempo — o WirePlumber está rodando?",
    )
  }

  // This link lands on the recorder, not on the sink, so no reconciliation pass
  // ever sees it: it is made once and stays for as long as the recorder does.
  await link(pairs)
}

/** The recorder's node, found by the pid we spawned. */
function recorderNodeId(graph: PipewireObject[], pid: number | undefined): number | null {
  if (pid === undefined) return null

  const clients = new Map<number, number>()
  for (const object of graph) {
    if (!(object.type ?? "").endsWith("Client")) continue
    const clientPid = object.info?.props?.["application.process.id"]
    if (typeof clientPid === "number") clients.set(object.id, clientPid)
  }

  for (const object of graph) {
    if (!(object.type ?? "").endsWith("Node")) continue
    const props = object.info?.props ?? {}
    if (props["media.class"] !== "Stream/Input/Audio") continue
    const clientId = props["client.id"]
    if (typeof clientId !== "number") continue
    if (clients.get(clientId) === pid) return object.id
  }

  return null
}

/**
 * Applies an audio mode, and returns the source ids that will carry PCM.
 *
 * The sink and the recorder stay up across every change; only the links move.
 * That is what lets the mode be switched mid-broadcast without the track being
 * republished.
 */
export async function setMode(
  mode: AudioMode,
  onPcm: (sourceId: string, pcm: Buffer) => void,
): Promise<string[]> {
  deliver = onPcm
  activeMode = mode

  if (mode.kind === "none") {
    stopReconciling()
    await reconcile()
    return []
  }

  await ensureRecorder()
  await reconcile()
  startReconciling()

  // The id is returned even with nothing wired yet. There is one recorder and
  // one id whatever is linked behind it, and the worklet has to exist BEFORE
  // the first application does: built only when something happens to be playing
  // at this instant, a broadcast started in silence stays silent for good, and
  // every sample of whoever starts playing next is dropped without a word.
  return [SOURCE_ID]
}

/** Tears everything down. Called when the app quits. */
export async function stop(): Promise<void> {
  stopReconciling()
  activeMode = { kind: "none" }
  recorder?.kill()
  recorder = null
  deliver = null
  await unloadSink()
}
