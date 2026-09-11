import { execFile } from "node:child_process"
import { arch, platform, release } from "node:os"
import { join, sep } from "node:path"
import { promisify } from "node:util"
import type { AudioMode } from "./audioMode"
import {
  type WindowsProcess,
  type WindowsWindow,
  supportsProcessLoopback,
  windowsApps,
} from "./windowsProcesses"

const run = promisify(execFile)

/**
 * Per-application audio on Windows, through WASAPI process loopback.
 *
 * The browser only knows how to capture "all of the system's audio", which is
 * why the Discord call leaks into a broadcast. Windows can capture a process
 * tree instead, and that is what closes the hole.
 *
 * Output is 16-bit little-endian PCM, stereo, 48 kHz — the same as the PipeWire
 * backend, so the worklet on the other side does not change a line.
 *
 * **Written without a Windows machine to try it on.** Every rule below comes
 * from measurements someone else made; the pure half lives in
 * `windowsProcesses.ts` and is covered by tests, and this half is the part that
 * will need a real machine to confirm.
 */

/** One capture client per application, so one source id per pid. */
type Capture = {
  id: string
  handle: { stop: () => void }
}

type LoopbackCapture = {
  new (): {
    start: (pid: number, includeProcessTree: boolean, onChunk: (pcm: Buffer) => void) => void
    stop: () => void
    startSystemAudio: (onChunk: (pcm: Buffer) => void) => void
  }
}

export const SAMPLE_RATE = 48000
export const CHANNELS = 2

/** A single PowerShell call: spawning is dear, and this runs every few seconds. */
const PROCESS_SCRIPT = `
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$procs = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name
$windows = Get-Process | Where-Object { $_.MainWindowTitle } | Select-Object Id, MainWindowTitle
ConvertTo-Json -Compress -Depth 3 @{ procs = @($procs); windows = @($windows) }
`

const POWERSHELL_MAX_BUFFER = 8 * 1024 * 1024

let LoopbackCaptureClass: LoopbackCapture | null = null

/**
 * Loads the native addon.
 *
 * Resolved inside the function, never in the module body: the package is
 * optional and absent on Linux, so a `require.resolve` at the top level would
 * kill the app during import — before any of our code runs, and for everyone,
 * including the people who will never capture a thing through WASAPI.
 *
 * The `.node` is loaded by path rather than through the package's own
 * `bindings` wrapper. Inside a packaged app the JavaScript lives in `app.asar`
 * and the binary in `app.asar.unpacked`; `bindings` looks in the first and
 * finds nothing.
 */
function addon(): LoopbackCapture {
  if (LoopbackCaptureClass !== null) return LoopbackCaptureClass

  const packageJson = require.resolve("loopback-capture/package.json")
  const root = packageJson.slice(0, packageJson.lastIndexOf(sep))

  const binary = join(
    root,
    "prebuilds",
    `${platform()}-${arch()}`,
    "loopback_capture_addon.node",
  ).replace(`app.asar${sep}`, `app.asar.unpacked${sep}`)

  LoopbackCaptureClass = (require(binary) as { LoopbackCapture: LoopbackCapture }).LoopbackCapture
  return LoopbackCaptureClass
}

/** Whether this Windows can capture per process at all. */
export function canCapturePerProcess(): boolean {
  return supportsProcessLoopback(release())
}

/** Applications showing a window, which is the only kind that can be ticked. */
export async function listApps(): Promise<{ pid: number; name: string; binary: string }[]> {
  const { stdout } = await run(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", PROCESS_SCRIPT],
    { maxBuffer: POWERSHELL_MAX_BUFFER, windowsHide: true },
  )

  const parsed: unknown = JSON.parse(stdout)
  // A trust boundary like any other: this is another program's output.
  if (typeof parsed !== "object" || parsed === null) return []

  const { procs, windows } = parsed as {
    procs?: WindowsProcess[]
    windows?: WindowsWindow[]
  }

  return windowsApps(
    { procs: Array.isArray(procs) ? procs : [], windows: Array.isArray(windows) ? windows : [] },
    process.pid,
  )
}

let captures: Capture[] = []

/** Stops every capture client. */
export async function stop(): Promise<void> {
  for (const capture of captures) {
    try {
      capture.handle.stop()
    } catch {
      // Already dead, which is the state we were asking for.
    }
  }
  captures = []
}

/**
 * Applies an audio mode, and returns the source ids that will carry PCM.
 *
 * One id per pid here, unlike PipeWire's single one: on Windows each
 * application needs its own WASAPI client, and the renderer builds a worklet
 * per id. Getting this list wrong throws the audio away in silence.
 *
 * Past half a dozen applications it is worth measuring the CPU before letting
 * the panel tick more.
 */
export async function setMode(
  mode: AudioMode,
  onPcm: (sourceId: string, pcm: Buffer) => void,
): Promise<string[]> {
  await stop()

  if (mode.kind === "none") return []

  const Capture = addon()

  const open = (id: string, begin: (client: InstanceType<LoopbackCapture>) => void): void => {
    const handle = new Capture()
    begin(handle)
    captures.push({ id, handle })
  }

  if (mode.kind === "system") {
    // The device as a whole, ourselves included — which is why this is the only
    // mode that can echo, and the only one that warns.
    open("system", (client) => client.startSystemAudio((pcm) => onPcm("system", pcm)))
    return captures.map((capture) => capture.id)
  }

  const wanted =
    mode.kind === "include"
      ? mode.pids
      : (await listApps()).map((app) => app.pid)

  for (const pid of wanted) {
    const id = `pid:${pid}`
    // `includeProcessTree` is true because a game's audio often comes out of a
    // child process, not the one owning the window.
    //
    // The native exclusion mode is never used anywhere. It takes ONE process
    // tree, and more than one thing has to stay out — the list being built from
    // window owners is what keeps the mixers out instead.
    open(id, (client) => client.start(pid, true, (pcm) => onPcm(id, pcm)))
  }

  return captures.map((capture) => capture.id)
}
