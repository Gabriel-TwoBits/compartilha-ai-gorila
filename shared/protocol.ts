/**
 * Wire contract for the signaling WebSocket, shared by the server and the client.
 *
 * Cloudflare Realtime has no notion of a room: a viewer can only pull a track if
 * it knows the (sessionId, trackName) pair of the publisher. Distributing that
 * pair is the entire reason this signaling layer exists.
 */

export const MAX_NICKNAME_LENGTH = 24

/** Address of a single track inside the Cloudflare SFU. */
export type TrackRef = {
  sessionId: string
  trackName: string
}

/**
 * An in-progress broadcast: the screen, the camera, or both, plus optional audio.
 *
 * An address is present only while its track carries real media. The publisher
 * keeps an idle video track on a black placeholder so turning it on is a
 * `replaceTrack` rather than a renegotiation, but a viewer must never pull that
 * placeholder: a still canvas yields a single frame and the SFU never finishes
 * delivering it, so the viewer's renegotiation hangs without an error.
 *
 * At least one of `screen` and `camera` is always set; with neither there is no
 * broadcast, only `null`.
 */
export type Broadcast = {
  screen: TrackRef | null
  camera: TrackRef | null
  audio: TrackRef | null
}

/**
 * The nickname is the identity. Someone with two tabs open is one participant
 * with two connections, not two people in the sidebar. The flip side is that two
 * friends who pick the same nickname merge into one entry — acceptable in a room
 * whose real gate is the shared password.
 */
export type Participant = {
  nickname: string
  broadcast: Broadcast | null
  /** Nicknames watching this participant's broadcast, excluding themselves. */
  viewers: string[]
}

/**
 * Server to client. A single message type carrying the full room snapshot,
 * resent on every change. For a room of friends, deltas would be complexity
 * without a payoff.
 */
export type ServerMessage = {
  type: "state"
  /** Our own nickname, so the UI can tell us apart from everyone else. */
  you: string
  participants: Participant[]
}

/** Client to server. */
export type ClientMessage =
  | ({ type: "broadcast-start" } & Broadcast)
  | { type: "broadcast-stop" }
  /** Whose broadcasts we currently have open, empty when showing none. */
  | { type: "watching"; nicknames: string[] }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parseTrackRef(value: unknown): TrackRef | null {
  if (!isRecord(value)) return null
  const { sessionId, trackName } = value
  if (typeof sessionId !== "string" || sessionId.length === 0) return null
  if (typeof trackName !== "string" || trackName.length === 0) return null
  return { sessionId, trackName }
}

/**
 * An address that may legitimately be absent. A missing or `null` value is
 * `{ ref: null }`; a malformed one is `null`, so the caller drops the whole
 * message rather than publishing a half-valid state.
 */
function parseOptionalTrackRef(value: unknown): { ref: TrackRef | null } | null {
  if (value === null || value === undefined) return { ref: null }
  const ref = parseTrackRef(value)
  if (ref === null) return null
  return { ref }
}

/**
 * Trust boundary: anything arriving on the socket is arbitrary text. Returns
 * `null` for anything that does not match the contract exactly, malformed JSON
 * included.
 */
export function parseClientMessage(raw: string): ClientMessage | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  if (!isRecord(parsed)) return null

  switch (parsed.type) {
    case "broadcast-start": {
      const screen = parseOptionalTrackRef(parsed.screen)
      const camera = parseOptionalTrackRef(parsed.camera)
      const audio = parseOptionalTrackRef(parsed.audio)
      if (screen === null || camera === null || audio === null) return null
      // Audio alone is nothing to watch.
      if (screen.ref === null && camera.ref === null) return null
      return { type: "broadcast-start", screen: screen.ref, camera: camera.ref, audio: audio.ref }
    }
    case "broadcast-stop":
      return { type: "broadcast-stop" }
    case "watching": {
      const { nicknames } = parsed
      // Watching nobody is the common case, so an absent list is not an error.
      if (nicknames === null || nicknames === undefined) {
        return { type: "watching", nicknames: [] }
      }
      if (!Array.isArray(nicknames)) return null
      // One bad entry drops the whole report: a partially applied list would
      // leave the viewer counts claiming something nobody asked for.
      for (const nickname of nicknames) {
        if (typeof nickname !== "string" || nickname.length === 0) return null
      }
      return { type: "watching", nicknames: nicknames as string[] }
    }
    default:
      return null
  }
}

/**
 * The client trusts its own server, but not a stale one: after a deploy an old
 * tab can still be holding a socket that speaks a different shape. Returns
 * `null` rather than letting a malformed snapshot reach the UI.
 */
export function parseServerMessage(raw: string): ServerMessage | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  if (!isRecord(parsed)) return null
  if (parsed.type !== "state") return null
  if (typeof parsed.you !== "string") return null
  if (!Array.isArray(parsed.participants)) return null

  return {
    type: "state",
    you: parsed.you,
    participants: parsed.participants as Participant[],
  }
}

const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/g

/**
 * Normalizes and validates a nickname, returning `null` when nothing usable is
 * left. Control characters are stripped so a nickname cannot break the rendering
 * on other clients nor the cookie it gets serialized into.
 */
export function normalizeNickname(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const cleaned = raw.replace(CONTROL_CHARACTERS, "").trim()
  if (cleaned.length === 0) return null
  return cleaned.slice(0, MAX_NICKNAME_LENGTH)
}
