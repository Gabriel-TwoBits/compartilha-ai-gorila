import { Observable } from "rxjs"

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

/**
 * True for a canvas track — ours, or the black one partytracks swaps in while a
 * browser screen share is idle. A real capture is never one, so this tells the
 * two apart without bookkeeping.
 */
export function isPlaceholder(track: MediaStreamTrack): boolean {
  return "canvas" in track
}
