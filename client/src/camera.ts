import { BehaviorSubject, EMPTY, Observable, Subject, switchMap } from "rxjs"
import { inputDevices$, mediaDevices, stopStream } from "./mediaInputs"
import { CAMERA_PRESET } from "./quality"

/**
 * The webcam, broadcast as a track of its own beside the screen.
 *
 * It lives outside the screen share: it can go on with the screen, on its own,
 * and on and off in the middle of either without taking anything down.
 */

const STORAGE_KEY = "cag:camera"

function readStoredCamera(): string | null {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored === null || stored === "") return null
    return stored
  } catch {
    // Private windows and blocked site data throw on access rather than
    // returning null.
    return null
  }
}

/** `null` is the system default, which is the first camera listed. */
const selectedCamera = new BehaviorSubject<string | null>(readStoredCamera())

export const cameraId$: Observable<string | null> = selectedCamera.asObservable()

export function selectCamera(deviceId: string): void {
  selectedCamera.next(deviceId)
  try {
    window.localStorage.setItem(STORAGE_KEY, deviceId)
  } catch {
    // The choice not surviving a reload is not worth failing over.
  }
}

const camerasRevealed = new Subject<void>()

export const cameraInputs$: Observable<MediaDeviceInfo[]> = inputDevices$(
  "videoinput",
  camerasRevealed,
)

/**
 * Device labels stay blank until the camera has been granted once, and a list
 * of "Câmera 1, Câmera 2" does not tell anyone which one sits on top of the
 * monitor. One grant is enough; the stream is stopped as soon as it arrives.
 *
 * Only ever called from a click: asking lights the webcam's LED, which would
 * alarm someone who only opened the panel to look.
 */
export async function revealCameras(): Promise<void> {
  const stream = await mediaDevices().getUserMedia({ video: true })
  stopStream(stream)
  camerasRevealed.next()
}

/**
 * `ideal` rather than `max` or `exact`: a camera has a fixed list of modes, and
 * a hard constraint it cannot meet fails instead of settling for the nearest.
 * The encoder ceiling is what actually bounds the bill.
 */
export function cameraConstraints(deviceId: string | null): MediaTrackConstraints {
  const constraints: MediaTrackConstraints = {
    width: { ideal: CAMERA_PRESET.width },
    height: { ideal: CAMERA_PRESET.height },
    frameRate: { ideal: CAMERA_PRESET.frameRate },
  }
  if (deviceId === null) return constraints
  return { ...constraints, deviceId: { exact: deviceId } }
}

function toError(cause: unknown): Error {
  if (cause instanceof Error) return cause
  return new Error(String(cause))
}

/** One capture of one camera, completing when the device goes away. */
function capture$(deviceId: string | null): Observable<MediaStreamTrack> {
  return new Observable<MediaStreamTrack>((subscriber) => {
    let stream: MediaStream | null = null
    let cancelled = false

    mediaDevices()
      .getUserMedia({ audio: false, video: cameraConstraints(deviceId) })
      .then((acquired) => {
        // Turning the camera off while the permission prompt is still up
        // would otherwise leave its LED on with nothing showing.
        if (cancelled) {
          stopStream(acquired)
          return
        }
        stream = acquired
        const [track] = acquired.getVideoTracks()
        if (track === undefined) {
          subscriber.error(new Error("a câmera não entregou nenhuma imagem"))
          return
        }
        track.addEventListener("ended", () => subscriber.complete())
        subscriber.next(track)
      })
      .catch((cause: unknown) => {
        subscriber.error(toError(cause))
      })

    return () => {
      cancelled = true
      if (stream !== null) stopStream(stream)
    }
  })
}

const on = new BehaviorSubject<boolean>(false)
const errors = new Subject<Error>()

export const cameraOn$: Observable<boolean> = on.asObservable()
export const cameraError$: Observable<Error> = errors.asObservable()

export function toggleCamera(): void {
  on.next(!on.value)
}

export function turnCameraOff(): void {
  on.next(false)
}

/**
 * The camera's track while it is on, nothing while it is off.
 *
 * Picking another camera mid-broadcast swaps the capture in place. A failure
 * turns the camera back off and is reported on `cameraError$` rather than
 * thrown: a denied permission is a decision, and it must leave the button ready
 * to be pressed again.
 */
export const cameraTrack$: Observable<MediaStreamTrack> = on.pipe(
  switchMap((isOn) => {
    if (!isOn) return EMPTY
    return selectedCamera.pipe(
      switchMap(
        (deviceId) =>
          new Observable<MediaStreamTrack>((subscriber) =>
            capture$(deviceId).subscribe({
              next: (track) => subscriber.next(track),
              error: (cause: unknown) => {
                errors.next(toError(cause))
                on.next(false)
              },
              complete: () => on.next(false),
            }),
          ),
      ),
    )
  }),
)
