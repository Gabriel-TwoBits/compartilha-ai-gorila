import type { AudioMode } from "./audioMode"

/**
 * Reading the PipeWire graph, and deciding what to wire to what.
 *
 * Pure functions over the JSON `pw-dump` prints, kept free of `electron` and of
 * any process spawning so the room's own test suite can exercise them. Every
 * rule below was expensive to learn and silent to break.
 */

/** What `pw-dump` prints: a flat array of objects, each with a type and props. */
export type PipewireObject = {
  id: number
  type?: string
  info?: {
    props?: Record<string, unknown>
  }
}

export type AudioApp = {
  /** PipeWire node id — what ports hang off. */
  nodeId: number
  /** Operating system pid. The identity the interface ticks and unticks. */
  pid: number
  /** Executable name, for matching against the ones that must never go out. */
  binary: string
  /** What to show in the list. */
  name: string
}

export type Port = {
  id: number
  /** "FL", "FR", "MONO"… absent on ports that carry no channel. */
  channel: string | null
}

export type PortPair = [outputId: number, inputId: number]

/** Applications playing sound carry this class; recorders carry Stream/Input/Audio. */
const PLAYBACK_CLASS = "Stream/Output/Audio"

function props(object: PipewireObject): Record<string, unknown> {
  return object.info?.props ?? {}
}

function isType(object: PipewireObject, suffix: string): boolean {
  return (object.type ?? "").endsWith(suffix)
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  // pw-dump prints most numbers as numbers, but a prop that came from a string
  // property stays a string.
  if (typeof value === "string") {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

/**
 * The applications currently playing audio.
 *
 * The pid does not live on the Node. The Node only points at a Client through
 * `client.id`, and it is the Client that carries `application.process.id` and
 * `application.process.binary` — reading the pid off the node yields nothing,
 * silently, and every application then looks like the same unknown one.
 *
 * The list comes from who is *making sound right now*, which is both better and
 * worse than Windows' "who owns a window": more accurate about what is audible,
 * and blind to a game that happens to be silent at this instant.
 */
export function audioApps(graph: PipewireObject[]): AudioApp[] {
  const clients = new Map<number, Record<string, unknown>>()
  for (const object of graph) {
    if (isType(object, "Client")) clients.set(object.id, props(object))
  }

  const apps: AudioApp[] = []

  for (const object of graph) {
    if (!isType(object, "Node")) continue

    const nodeProps = props(object)
    if (nodeProps["media.class"] !== PLAYBACK_CLASS) continue

    const clientId = readNumber(nodeProps["client.id"])
    if (clientId === null) continue

    const clientProps = clients.get(clientId)
    if (clientProps === undefined) continue

    const pid = readNumber(clientProps["application.process.id"])
    if (pid === null) continue

    const binary = readString(clientProps["application.process.binary"]) ?? "?"
    const name =
      readString(nodeProps["application.name"]) ??
      readString(clientProps["application.name"]) ??
      readString(nodeProps["node.name"]) ??
      binary

    apps.push({ nodeId: object.id, pid, binary, name })
  }

  return apps
}

/** The node with this exact `node.name`, or `null`. */
export function nodeIdByName(graph: PipewireObject[], name: string): number | null {
  for (const object of graph) {
    if (!isType(object, "Node")) continue
    if (props(object)["node.name"] === name) return object.id
  }
  return null
}

/**
 * The ports of one node, in one direction.
 *
 * Identified by **port id**, never by name: with two players running there are
 * two ports called `output_FL`, and `pw-link` given an ambiguous name picks one
 * of them. The id is the only thing that is unique.
 */
export function portsOf(
  graph: PipewireObject[],
  nodeId: number | null,
  direction: "in" | "out",
): Port[] {
  if (nodeId === null) return []

  const ports: Port[] = []

  for (const object of graph) {
    if (!isType(object, "Port")) continue
    const portProps = props(object)
    if (readNumber(portProps["node.id"]) !== nodeId) continue
    if (portProps["port.direction"] !== direction) continue
    ports.push({ id: object.id, channel: readString(portProps["audio.channel"]) })
  }

  return ports
}

/**
 * Matches outputs to inputs, channel by channel.
 *
 * By channel rather than by position: `pw-dump` does not list a node's ports in
 * channel order — a stereo source can come back FR first — and pairing by index
 * then swaps left and right for everyone watching, which nobody notices until
 * somebody says the audio feels wrong.
 *
 * Sources without channel labels, or whose labels do not line up with the
 * destination's, fall back to position. That is the mono case, and the
 * alternative there is no audio at all.
 */
export function pairPorts(outputs: Port[], inputs: Port[]): PortPair[] {
  const byChannel = new Map<string, Port>()
  for (const input of inputs) {
    if (input.channel !== null) byChannel.set(input.channel, input)
  }

  const everyOutputMatched = outputs.every(
    (output) => output.channel !== null && byChannel.has(output.channel),
  )

  if (everyOutputMatched && outputs.length > 0) {
    return outputs.map((output) => {
      // Checked by `everyOutputMatched`; the lookup cannot miss here.
      const input = byChannel.get(output.channel as string) as Port
      return [output.id, input.id]
    })
  }

  const count = Math.min(outputs.length, inputs.length)
  const pairs: PortPair[] = []
  for (let index = 0; index < count; index += 1) {
    const output = outputs[index]
    const input = inputs[index]
    if (output === undefined || input === undefined) continue
    pairs.push([output.id, input.id])
  }
  return pairs
}

/**
 * Applications that must never reach the broadcast, matched on the executable.
 *
 * Discord because carrying the call is the entire problem this app exists to
 * solve, and ourselves because capturing our own output while watching someone
 * feeds their audio back to them.
 */
const NEVER_BROADCAST = /^(discord(ptb|canary|development)?|electron|compartilha-ai-gorila)$/i

export function isExcludedFromBroadcast(app: AudioApp): boolean {
  return NEVER_BROADCAST.test(app.binary)
}

/**
 * Which applications a mode actually wires up.
 *
 * "Everything" is an inclusion of the whole list, never PipeWire's own
 * exclusion: the native exclude takes one process tree, and more than one thing
 * must stay out. Selecting by what the list contains keeps that rule in one
 * place — and the list already omits what must never go out.
 */
export function appsForMode(apps: AudioApp[], mode: AudioMode): AudioApp[] {
  const allowed = apps.filter((app) => !isExcludedFromBroadcast(app))

  switch (mode.kind) {
    case "none":
      return []
    case "system":
      // The default sink's monitor carries everything at once, so no
      // per-application wiring happens in this mode.
      return []
    case "include":
      return allowed.filter((app) => mode.pids.includes(app.pid))
    case "everything":
      return allowed
    default:
      // Unreachable: every AudioMode variant is handled above.
      return []
  }
}
