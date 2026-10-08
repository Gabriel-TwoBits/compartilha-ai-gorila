import { Observable } from "rxjs"

/**
 * Every placeholder track handed out, ours and partytracks' alike.
 *
 * Marked rather than recognised by type: Chromium makes a canvas capture a
 * `CanvasCaptureMediaStreamTrack` with a `canvas` property, but Firefox hands
 * over a plain `MediaStreamTrack` and keeps `canvas` on the stream. Guessing
 * from the track announced the placeholder as a screen there, which showed as a
 * black overlay and left viewers pulling a track that never delivers.
 */
const placeholders = new WeakSet<MediaStreamTrack>()

export function markPlaceholder(track: MediaStreamTrack): void {
  placeholders.add(track)
}

/** As small as an encoder accepts: nothing is ever meant to see it. */
const PLACEHOLDER_SIZE_PX = 2

/**
 * How often the canvas is repainted. A canvas capture only yields a frame when
 * the canvas changes, and partytracks withholds a push's address until the
 * sender has put bytes on the wire — painted only once, before the capture
 * starts, the broadcast is never announced.
 */
const REPAINT_INTERVAL_MS = 1000

/**
 * A black video track that holds a transceiver's place while its source is off.
 *
 * Publishing the screen and the camera for the whole broadcast, each on this
 * placeholder while idle, turns switching either on into a `replaceTrack`
 * instead of a renegotiation with the SFU, which makes the video of everyone
 * watching flicker.
 *
 * It must never be pulled: a still canvas yields a single frame and the SFU
 * never finishes delivering it. `isPlaceholder` is what keeps its address out of
 * the announcement.
 *
 * Cold on purpose: each subscriber gets a track of its own, so the screen and
 * the camera never share one sender's track.
 */
export function placeholderVideoTrack$(): Observable<MediaStreamTrack> {
  return new Observable<MediaStreamTrack>((subscriber) => {
    const canvas = document.createElement("canvas")
    canvas.width = PLACEHOLDER_SIZE_PX
    canvas.height = PLACEHOLDER_SIZE_PX
    const context = canvas.getContext("2d")
    if (context === null) {
      subscriber.error(new Error("o navegador não gerou a trilha reserva"))
      return undefined
    }

    const [track] = canvas.captureStream().getVideoTracks()
    if (track === undefined) {
      subscriber.error(new Error("o navegador não gerou a trilha reserva"))
      return undefined
    }

    markPlaceholder(track)
    const paint = () => context.fillRect(0, 0, PLACEHOLDER_SIZE_PX, PLACEHOLDER_SIZE_PX)
    paint()
    const timer = window.setInterval(paint, REPAINT_INTERVAL_MS)

    subscriber.next(track)
    return () => {
      window.clearInterval(timer)
      track.stop()
    }
  })
}

/** True for a track marked by `markPlaceholder`; a real capture never is. */
export function isPlaceholder(track: MediaStreamTrack): boolean {
  return placeholders.has(track)
}

/**
 * A silent audio track that holds the audio transceiver's place while the screen
 * is off.
 *
 * The broadcast's sound belongs to the screen: a camera alone must not carry the
 * computer's audio. Swapping the source for silence rather than dropping the
 * push keeps the transceiver, so the screen coming back is a `replaceTrack`, not
 * a renegotiation.
 *
 * A destination with nothing feeding it yields no frames at all, and partytracks
 * neither announces a push nor replaces its track until the sender has put bytes
 * on the wire — so the screen would never get its sound. A constant source at
 * zero keeps the graph rendering. The broadcast always starts from a click, so
 * the context is allowed to run.
 */
export function placeholderAudioTrack$(): Observable<MediaStreamTrack> {
  return new Observable<MediaStreamTrack>((subscriber) => {
    const context = new AudioContext()
    const destination = context.createMediaStreamDestination()
    const [track] = destination.stream.getAudioTracks()
    if (track === undefined) {
      void context.close()
      subscriber.error(new Error("o navegador não gerou a trilha de silêncio"))
      return undefined
    }

    const silence = context.createConstantSource()
    silence.offset.value = 0
    silence.connect(destination)
    silence.start()

    markPlaceholder(track)
    subscriber.next(track)
    return () => {
      track.stop()
      void context.close()
    }
  })
}
