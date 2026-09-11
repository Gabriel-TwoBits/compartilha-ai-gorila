import { PartyTracks, type Screenshare, getScreenshare, setLogLevel } from "partytracks/client"
import type { TrackMetadata } from "partytracks/client"
import { type Observable, map } from "rxjs"
import type { TrackRef } from "@shared/protocol"
import { captureConstraints, currentQuality, quality$, sendEncodings } from "./quality"

// partytracks logs at "warn" by default, which hides every peer connection and
// ICE transition. Those are the only trace a session that fails to connect
// leaves behind, and the SFU rejects track requests until it does connect.
if (import.meta.env.DEV) setLogLevel("debug")

/**
 * Lazily created singletons.
 *
 * `PartyTracks` opens a peer connection against `/partytracks/*`, which requires
 * a session, so it must not be constructed before login. Keeping one instance
 * also means React's double render in StrictMode cannot end up with two peer
 * connections or two screen capture prompts.
 */

let partyTracks: PartyTracks | null = null
let screenshare: Screenshare | null = null

export function getPartyTracks(): PartyTracks {
  partyTracks ??= new PartyTracks()
  return partyTracks
}

export function getScreenshareSource(): Screenshare {
  // The constraints are read once, when the singleton is built: `getScreenshare`
  // takes them at construction and offers no way to revise them. A preset picked
  // later is applied to the live track instead, by `applyQualityToTrack` below.
  screenshare ??= getScreenshare({
    audio: true,
    video: { constraints: captureConstraints(currentQuality()) },
  })
  return screenshare
}

/**
 * Caps what the video encoder sends, following the picker.
 *
 * `PartyTracks.push` applies every emission, so changing preset mid-broadcast
 * re-caps the existing encoder rather than republishing the track.
 */
export const videoSendEncodings$: Observable<RTCRtpEncodingParameters[]> = quality$.pipe(
  map(sendEncodings),
)

/**
 * Re-caps a capture that is already running.
 *
 * The encoder ceiling alone would leave the source untouched: the browser would
 * keep grabbing 1080p and hand the encoder more pixels than its budget can pay
 * for, which it spends by blurring everything. A capture that refuses the new
 * constraints keeps the old ones, which is worse than a failed broadcast and
 * better than a dead one — hence the swallowed rejection.
 */
export async function applyQualityToTrack(track: MediaStreamTrack): Promise<void> {
  await track.applyConstraints(captureConstraints(currentQuality())).catch(() => undefined)
}

/**
 * Tells the encoder this is a game, not a spreadsheet.
 *
 * Chromium treats screen capture as `maintain-resolution` by default: short of
 * CPU or bandwidth it holds the resolution and drops the frame rate, and 1080p
 * at 5 fps is a slideshow. The hint flips that trade — the picture softens but
 * stays fluid. It has to be set before the offer, so the encoder is born aware.
 */
export function hintMotion(track: MediaStreamTrack): void {
  track.contentHint = "motion"
}

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
