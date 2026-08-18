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
 * An in-progress broadcast. Audio is optional: the browser only hands over an
 * audio track when the user ticks "share audio" in the screen picker.
 */
export type Broadcast = {
  video: TrackRef
  audio: TrackRef | null
}

export type Participant = {
  id: string
  nickname: string
  broadcast: Broadcast | null
}

/**
 * Server to client. A single message type carrying the full room snapshot,
 * resent on every change. For a room of friends, deltas would be complexity
 * without a payoff.
 */
export type ServerMessage = {
  type: "state"
  you: string
  participants: Participant[]
}

/** Client to server. */
export type ClientMessage =
  | { type: "broadcast-start"; video: TrackRef; audio: TrackRef | null }
  | { type: "broadcast-stop" }

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
      const video = parseTrackRef(parsed.video)
      if (video === null) return null
      // A missing audio track is legitimate; a malformed one is not, and drops
      // the whole message rather than silently publishing a half-valid state.
      if (parsed.audio === null || parsed.audio === undefined) {
        return { type: "broadcast-start", video, audio: null }
      }
      const audio = parseTrackRef(parsed.audio)
      if (audio === null) return null
      return { type: "broadcast-start", video, audio }
    }
    case "broadcast-stop":
      return { type: "broadcast-stop" }
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
