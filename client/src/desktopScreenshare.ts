import { BehaviorSubject, EMPTY, Observable, Subject, shareReplay, switchMap } from "rxjs"
import { type DesktopSource, desktopBridge } from "./desktop"
import { captureConstraints, currentQuality } from "./quality"
import type { ScreenSource } from "./screenSource"

/**
 * Screen capture inside the desktop app.
 *
 * Same shape as the browser's source, so nothing downstream has to know which
 * one it got: `PartyTracks.push` takes any observable of a track, and the SFU
 * layer never learns where the pixels came from.
 *
 * What differs is the picking. In a browser the capture call itself raises
 * Chrome's picker. Here there are two routes, and the platform decides:
 *
 *   - a list of our own (X11, Windows) — thumbnails in our UI, then a capture
 *     bound to the chosen id, with no picker in the way at all;
 *   - the system portal (Wayland) — the choice happens *before* the capture,
 *     in a separate step, and `getDisplayMedia` only collects the answer.
 */

/**
 * Constraints that configure Chromium's own desktop capturer.
 *
 * Not part of the standard `MediaTrackConstraints`, and not expressible in its
 * type — hence the cast at the call site. They belong in `mandatory` because
 * that is where Chromium reads them when building the capturer: asking through
 * `applyConstraints` afterwards would only scale down something already
 * captured too large, spending CPU for nothing.
 */
type DesktopCaptureConstraints = {
  mandatory: {
    chromeMediaSource: "desktop"
    chromeMediaSourceId: string
    maxWidth: number
    maxHeight: number
    maxFrameRate: number
  }
}

const broadcasting = new BehaviorSubject<boolean>(false)

/** What the picker chose. Never set under the portal, where the system decides. */
const chosenSource = new BehaviorSubject<DesktopSource | null>(null)

const errors = new Subject<Error>()

export const chosenSource$ = chosenSource.asObservable()

export function chooseSource(source: DesktopSource | null): void {
  chosenSource.next(source)
}

export function chosenSourceNow(): DesktopSource | null {
  return chosenSource.value
}

function stopStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop()
}

function toError(cause: unknown): Error {
  if (cause instanceof Error) return cause
  return new Error(String(cause))
}

async function acquire(): Promise<MediaStream> {
  const bridge = desktopBridge()
  if (bridge === null) throw new Error("a captura do app não está disponível")

  const preset = currentQuality()

  if (bridge.usesPortal) {
    // The picker runs first and on its own. Raising it from inside the display
    // media handler deadlocks, so by the time getDisplayMedia is called the
    // answer is already parked in the main process.
    const picked = await bridge.pickScreen()
    if (!picked) throw new Error("nenhuma tela escolhida")

    // No `chromeMediaSourceId` here, so there is no capturer to configure from
    // the inside: the limits go as ordinary constraints.
    return navigator.mediaDevices.getDisplayMedia({
      audio: false,
      video: captureConstraints(preset),
    })
  }

  const source = chosenSource.value
  if (source === null) throw new Error("escolha uma tela ou uma janela antes de transmitir")

  const constraints: DesktopCaptureConstraints = {
    mandatory: {
      chromeMediaSource: "desktop",
      chromeMediaSourceId: source.id,
      maxWidth: preset.width,
      maxHeight: preset.height,
      maxFrameRate: preset.frameRate,
    },
  }

  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: constraints as unknown as MediaTrackConstraints,
  })
}

/**
 * One capture, alive for as long as anyone is subscribed.
 *
 * Completing on `ended` is what makes "stop sharing" in the system's own UI
 * reach the room: without it the broadcast would stay announced over a track
 * that no longer carries anything.
 */
const capture$ = new Observable<MediaStreamTrack>((subscriber) => {
  let stream: MediaStream | null = null
  let cancelled = false

  acquire()
    .then((acquired) => {
      // Unsubscribing while the portal is still open leaves a live capture with
      // nobody to stop it.
      if (cancelled) {
        stopStream(acquired)
        return
      }
      stream = acquired
      const [track] = acquired.getVideoTracks()
      if (track === undefined) {
        subscriber.error(new Error("a fonte escolhida não entregou nenhuma imagem"))
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

/**
 * The track being broadcast, while broadcasting.
 *
 * A failure flips broadcasting back off and is reported on `error$` rather than
 * thrown: dismissing the portal is a decision, not a fault, and it must leave
 * the button ready to be pressed again.
 */
const broadcastTrack$ = broadcasting.pipe(
  switchMap((on) => {
    if (!on) return EMPTY
    return new Observable<MediaStreamTrack>((subscriber) =>
      capture$.subscribe({
        next: (track) => subscriber.next(track),
        error: (cause: unknown) => {
          errors.next(toError(cause))
          broadcasting.next(false)
        },
        complete: () => {
          broadcasting.next(false)
          subscriber.complete()
        },
      }),
    )
  }),
  // One capture no matter how many subscribers: the local preview, the push to
  // the SFU and the hook that keeps the pipeline warm are three of them.
  shareReplay({ bufferSize: 1, refCount: true }),
)

/**
 * The desktop's answer to the browser's screenshare source.
 *
 * Audio is deliberately empty. Nothing in a desktop capture carries sound on
 * Linux anyway, and per-application audio — the reason this app exists — is not
 * built yet. Until it is, the footer's audio picker (a PipeWire monitor source)
 * is the route, exactly as in the browser.
 */
export const desktopScreenshare: ScreenSource = {
  isBroadcasting$: broadcasting.asObservable(),
  video: {
    broadcastTrack$,
    error$: errors.asObservable(),
  },
  audio: {
    broadcastTrack$: EMPTY,
  },
  toggleBroadcasting: () => {
    broadcasting.next(!broadcasting.value)
  },
}
