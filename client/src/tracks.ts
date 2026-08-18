import { PartyTracks, type Screenshare, getScreenshare } from "partytracks/client"
import type { TrackMetadata } from "partytracks/client"
import type { TrackRef } from "@shared/protocol"

/**
 * Lazily created singletons.
 *
 * `PartyTracks` opens a peer connection against `/partytracks/*`, which requires
 * a session, so it must not be constructed before login. Keeping one instance
 * also means React's double render in StrictMode cannot end up with two peer
 * connections or two screen capture prompts.
 */

/**
 * Capture ceiling. Cloudflare bills egress once per viewer, so the cost of a
 * stream multiplies by the size of the room — capping the source is the
 * cheapest lever there is. 720p30 is plenty for watching someone play.
 */
const MAX_WIDTH = 1280
const MAX_HEIGHT = 720
const MAX_FRAMERATE = 30

/**
 * Encoder ceiling, in bits per second.
 *
 * The capture constraints bound the picture, not the bitrate: a busy 720p30
 * screen still pushes well past this if the encoder is left to decide on its
 * own. This is the number that actually bounds the bill.
 */
const MAX_BITRATE_BPS = 2_500_000

let partyTracks: PartyTracks | null = null
let screenshare: Screenshare | null = null

export function getPartyTracks(): PartyTracks {
  partyTracks ??= new PartyTracks()
  return partyTracks
}

export function getScreenshareSource(): Screenshare {
  screenshare ??= getScreenshare({
    audio: true,
    video: {
      constraints: {
        width: { max: MAX_WIDTH },
        height: { max: MAX_HEIGHT },
        frameRate: { max: MAX_FRAMERATE },
      },
    },
  })
  return screenshare
}

/** Handed to `PartyTracks.push` to cap what the video encoder actually sends. */
export const videoSendEncodings: RTCRtpEncodingParameters[] = [
  { maxBitrate: MAX_BITRATE_BPS, maxFramerate: MAX_FRAMERATE },
]

/**
 * Narrows the SFU's loosely typed metadata down to an address we can put on the
 * wire. Every field on `TrackMetadata` is optional, so a track that failed to
 * publish would otherwise be announced as `{}` and leave viewers pulling nothing.
 */
export function toTrackRef(metadata: TrackMetadata | null): TrackRef | null {
  if (metadata === null) return null
  const { sessionId, trackName } = metadata
  if (typeof sessionId !== "string" || sessionId.length === 0) return null
  if (typeof trackName !== "string" || trackName.length === 0) return null
  return { sessionId, trackName }
}

/** Turns a wire address back into what `PartyTracks.pull` expects. */
export function toTrackMetadata(ref: TrackRef): TrackMetadata {
  return { location: "remote", sessionId: ref.sessionId, trackName: ref.trackName }
}
