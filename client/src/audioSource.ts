import { BehaviorSubject, Observable, Subject } from "rxjs"
import { isDesktop } from "./desktop"
import { inputDevices$, mediaDevices, stopStream } from "./mediaInputs"
import { processAudioTrack$ } from "./processAudio"

/**
 * Where the broadcast's audio comes from: `null` is whatever the screen picker
 * itself handed over, anything else is the id of an audio input device.
 *
 * Screen audio is not available everywhere. Firefox implements none of it, and
 * Chromium on Linux offers it for browser tabs alone — the operating system
 * loopback it needs for a window or the whole screen only exists on Windows and
 * ChromeOS. Capturing a PipeWire/PulseAudio "Monitor of …" source as if it were
 * a microphone is the way around that, and the only route that carries the
 * sound of a native application.
 */
export type AudioSourceId = string | null

/**
 * Marks the per-application capture, which only the desktop app has.
 *
 * A sentinel rather than another device id: nothing the browser enumerates can
 * ever collide with it, and the switch below stays a plain three-way choice.
 */
export const PROCESS_AUDIO_SOURCE = "process-audio"

/**
 * Inside the app the screen capture carries no sound of its own, so the
 * browser's default would mean silence. The per-application mix is what the
 * app is for, and it is the default there.
 */
const selectedAudioSource = new BehaviorSubject<AudioSourceId>(
  isDesktop() ? PROCESS_AUDIO_SOURCE : null,
)

export const audioSourceId$: Observable<AudioSourceId> = selectedAudioSource.asObservable()

export function selectAudioSource(sourceId: AudioSourceId): void {
  selectedAudioSource.next(sourceId)
}

/**
 * The track for a chosen source: whatever the screen picker handed over, one
 * specific input, or the mix of captured applications.
 *
 * The last one is the reason the desktop app exists — it is the only route that
 * carries a game without carrying the call alongside it.
 */
export function audioSourceTrack$(
  sourceId: AudioSourceId,
  screenAudio$: Observable<MediaStreamTrack>,
): Observable<MediaStreamTrack> {
  if (sourceId === null) return screenAudio$
  if (sourceId === PROCESS_AUDIO_SOURCE) return processAudioTrack$
  return audioInputTrack$(sourceId)
}

/** Fires when a fresh capture grant may have revealed the device names. */
const audioInputsRevealed = new Subject<void>()

/** The inputs offered in the picker, re-read on every hotplug and after a grant. */
export const audioInputs$: Observable<MediaDeviceInfo[]> = inputDevices$(
  "audioinput",
  audioInputsRevealed,
)

/**
 * Device labels stay blank until a capture permission has been granted at least
 * once, and a list of unnamed ids is useless for picking a monitor source. One
 * grant is enough; the stream is stopped as soon as it arrives.
 */
export async function revealAudioInputs(): Promise<void> {
  const stream = await mediaDevices().getUserMedia({ audio: true })
  stopStream(stream)
  audioInputsRevealed.next()
}

/**
 * Capture constraints for a hand-picked input.
 *
 * The voice processing chain is built for microphones and wrecks everything
 * else: it gates and ducks a game's soundtrack into something unlistenable.
 * `exact` matters just as much — a loose `deviceId` is a preference the browser
 * may substitute, and what it substitutes is the real microphone.
 */
const CAPTURE_CONSTRAINTS = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
} satisfies MediaTrackConstraints

/** Captures one specific input, or fails — it never falls back to another device. */
export function audioInputTrack$(deviceId: string): Observable<MediaStreamTrack> {
  return new Observable<MediaStreamTrack>((subscriber) => {
    let capture: MediaStream | null = null
    let cancelled = false

    mediaDevices()
      .getUserMedia({ audio: { ...CAPTURE_CONSTRAINTS, deviceId: { exact: deviceId } } })
      .then((stream) => {
        // Unsubscribing before the permission prompt is answered leaves the
        // capture live with nobody to stop it.
        if (cancelled) {
          stopStream(stream)
          return
        }
        capture = stream
        const [track] = stream.getAudioTracks()
        if (track === undefined) {
          subscriber.error(new Error("a entrada escolhida não entregou nenhuma trilha"))
          return
        }
        subscriber.next(track)
      })
      .catch((captureError: unknown) => {
        subscriber.error(captureError)
      })

    return () => {
      cancelled = true
      if (capture !== null) stopStream(capture)
    }
  })
}
