import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useObservable, useObservableAsValue } from "partytracks/react"
import {
  type Observable,
  catchError,
  combineLatest,
  distinctUntilChanged,
  map,
  of,
  shareReplay,
  startWith,
  switchMap,
  tap,
  withLatestFrom,
} from "rxjs"
import type { ClientMessage } from "@shared/protocol"
import { audioSourceId$, audioSourceTrack$ } from "./audioSource"
import { cameraError$, cameraOn$, cameraTrack$, toggleCamera, turnCameraOff } from "./camera"
import {
  isPlaceholder,
  markPlaceholder,
  placeholderAudioTrack$,
  placeholderVideoTrack$,
} from "./placeholder"
import {
  applyQualityToTrack,
  getBroadcastTracks,
  getScreenshareSource,
  hintMotion,
  toTrackRef,
  videoSendEncodings$,
} from "./tracks"
import { CAMERA_PRESET, quality$, sendEncodings } from "./quality"
import type { Signaling } from "./useSignaling"

/**
 * What the broadcast is waiting on, shown on the stage while it assembles.
 *
 * The step has to change whenever the nature of the wait changes, not merely
 * when it starts: a spinner that says "capturing the screen" while the SFU is
 * the slow part reads as the screen picker having hung, and sends people
 * hunting in the wrong place.
 */
export type BroadcastStep = "capturing" | "connecting" | "announcing" | "live"

const STEP_LABELS: Record<BroadcastStep, string> = {
  capturing: "capturando a imagem",
  connecting: "conectando com a galera",
  announcing: "avisando a galera",
  live: "no ar",
}

export function describeStep(step: BroadcastStep): string {
  return STEP_LABELS[step]
}

/** Whatever rxjs hands the error callback, the footer needs a string. */
function describePushError(pushError: unknown): string {
  if (pushError instanceof Error) return `falha ao publicar a transmissão: ${pushError.message}`
  return "falha ao publicar a transmissão"
}

function describeCameraError(cameraError: Error): string {
  if (cameraError.name === "NotAllowedError") return "o acesso à câmera foi bloqueado"
  return `não consegui abrir a câmera: ${cameraError.message}`
}

/** A failing audio source must not take the broadcast down, but silence needs a reason. */
function describeAudioError(audioError: unknown): string {
  if (audioError instanceof Error) return `transmitindo sem áudio: ${audioError.message}`
  return "transmitindo sem áudio"
}

export type Broadcasting = {
  /** Anything of ours on air: the screen, the camera, or both. */
  isLive: boolean
  /** The screen share is on, or its picker is open. */
  isSharingScreen: boolean
  /** The camera is on, or being opened. */
  isCameraOn: boolean
  /** Our own captures while they are on air, for our own tile. */
  screenTrack: MediaStreamTrack | null
  cameraTrack: MediaStreamTrack | null
  /** Last error while acquiring the screen or the camera, e.g. a dismissed picker. */
  error: string | null
  /** How far along the handshake is, while `isLive` and not yet `live`. */
  step: BroadcastStep
  /**
   * The audio actually going out, or `null` when none is. The level meter reads
   * it: "did I pick the right source?" has no honest answer but watching the bar
   * move when the game makes noise.
   */
  audioTrack: MediaStreamTrack | null
  toggleScreen: () => void
  toggleCamera: () => void
  /** Takes everything off the air, the camera included. */
  stop: () => void
}

/**
 * A video track that is always present while broadcasting: the source's own
 * while it is on, a black placeholder while it is off.
 *
 * Keeping the transceiver for the whole broadcast is what lets the screen or the
 * camera come and go as a `replaceTrack`, invisible to whoever is watching,
 * rather than as a renegotiation that makes their video flicker.
 */
function slot$(
  on$: Observable<boolean>,
  source$: Observable<MediaStreamTrack>,
  prepare: (track: MediaStreamTrack) => void,
): Observable<MediaStreamTrack> {
  return on$.pipe(
    distinctUntilChanged(),
    switchMap((on) => (on ? source$ : placeholderVideoTrack$())),
    tap(prepare),
    // One track, prepared once, for both the push and the flag announcing it.
    shareReplay({ bufferSize: 1, refCount: true }),
  )
}

/** Whether a slot carries real media, which is what makes its address worth pulling. */
function carriesMedia$(track$: Observable<MediaStreamTrack>): Observable<boolean> {
  return track$.pipe(
    map((track) => !isPlaceholder(track)),
    distinctUntilChanged(),
  )
}

const cameraSendEncodings$ = of(sendEncodings(CAMERA_PRESET))

/**
 * Publishes our screen and camera to the SFU and announces their track
 * addresses to the room.
 *
 * The push subscriptions are tied to being live rather than being permanent:
 * an idle participant relaying placeholders through Cloudflare would be pure
 * waste.
 */
export function useBroadcast(signaling: Signaling): Broadcasting {
  const partyTracks = getBroadcastTracks()
  const screenshare = getScreenshareSource()
  const { send, connected } = signaling

  const isSharingScreen = useObservableAsValue(screenshare.isBroadcasting$, false)
  const isCameraOn = useObservableAsValue(cameraOn$, false)
  const isLive = isSharingScreen || isCameraOn
  const [error, setError] = useState<string | null>(null)
  const [step, setStep] = useState<BroadcastStep>("capturing")
  const [audioTrack, setAudioTrack] = useState<MediaStreamTrack | null>(null)
  const [screenTrack, setScreenTrack] = useState<MediaStreamTrack | null>(null)
  const [cameraTrack, setCameraTrack] = useState<MediaStreamTrack | null>(null)

  // `isBroadcasting$` is only ever fed from inside the `broadcastTrack$`
  // pipeline, and that pipeline is ref-counted: with nobody subscribed,
  // toggling flips a flag nothing reads, the screen picker never opens and the
  // effect below never runs. This keeps it warm — while idle it emits a local
  // black canvas and touches neither the capture APIs nor the network.
  //
  // That black canvas is marked here as a placeholder. partytracks flips
  // `isBroadcasting$` before emitting, so a track arriving while it reads false
  // is the idle one; the desktop source emits nothing while idle.
  const screenWithState$ = useMemo(
    () => screenshare.video.broadcastTrack$.pipe(withLatestFrom(screenshare.isBroadcasting$)),
    [screenshare],
  )
  useObservable(screenWithState$, ([track, sharing]) => {
    if (!sharing) markPlaceholder(track)
  })

  /** What the room was last told, so a reconnect can repeat it. */
  const announcement = useRef<ClientMessage | null>(null)

  /** The capture currently on air, so a new preset can be applied to it. */
  const captureTrack = useRef<MediaStreamTrack | null>(null)

  useObservable(screenshare.video.error$, (screenError) => {
    setError(screenError.message)
  })

  useObservable(cameraError$, (cameraError) => {
    setError(describeCameraError(cameraError))
  })

  // Raising the preset mid-broadcast has to reach the capture as well as the
  // encoder. The encoder follows `videoSendEncodings$` on its own; the capture
  // is a device already running, and only `applyConstraints` moves it.
  useObservable(quality$, () => {
    const track = captureTrack.current
    if (track === null) return
    void applyQualityToTrack(track)
  })

  useEffect(() => {
    if (!isLive) return undefined

    setError(null)
    setStep("capturing")

    // The capture is ours to prepare before it is offered: the motion hint has
    // to be on the track before the encoder negotiates, and a preset picked
    // while idle has to reach a capture that was built from an older one.
    const screen$ = slot$(screenshare.isBroadcasting$, screenshare.video.broadcastTrack$, (track) => {
      if (isPlaceholder(track)) {
        captureTrack.current = null
        setScreenTrack(null)
        return
      }
      hintMotion(track)
      captureTrack.current = track
      setScreenTrack(track)
      void applyQualityToTrack(track)
      setStep("connecting")
    })
    const camera$ = slot$(cameraOn$, cameraTrack$, (track) => {
      if (isPlaceholder(track)) {
        setCameraTrack(null)
        return
      }
      setCameraTrack(track)
      setStep("connecting")
    })

    const screenMeta$ = partyTracks.push(screen$, { sendEncodings$: videoSendEncodings$ })
    const cameraMeta$ = partyTracks.push(camera$, { sendEncodings$: cameraSendEncodings$ })

    // Audio is optional and its source is the user's to pick: the screen picker
    // only yields a track when "share audio" is ticked, and on some platforms
    // never — hence the hand-picked input. It goes out with the screen only: a
    // camera on its own carries silence, never the computer's sound.
    //
    // The `switchMap`s sit INSIDE the push on purpose. Outside it, every change
    // of source built a whole new push — a new transceiver and a renegotiation
    // with the SFU, which makes the video of everyone watching flicker. Inside,
    // `push` replaces the track on the transceiver it already has, and nobody
    // watching notices. `startWith` lets the broadcast be announced on video
    // alone, then announced again once audio shows up.
    const screenOn$ = carriesMedia$(screen$)
    const audioSource$ = screenOn$.pipe(
      switchMap((screenOn) => {
        if (!screenOn) return placeholderAudioTrack$()
        return audioSourceId$.pipe(
          distinctUntilChanged(),
          switchMap((sourceId) => audioSourceTrack$(sourceId, screenshare.audio.broadcastTrack$)),
        )
      }),
      tap((track) => setAudioTrack(isPlaceholder(track) ? null : track)),
    )
    const audio$ = partyTracks.push(audioSource$).pipe(
      startWith(null),
      catchError((audioError: unknown) => {
        setError(describeAudioError(audioError))
        return of(null)
      }),
    )

    // A failing video push is otherwise invisible: it takes the announcement
    // down with it, so the screen is captured, nobody ever receives it and the
    // room reports nothing wrong. `error$` above only covers acquiring the
    // screen, never publishing it.
    const subscription = combineLatest([
      screenMeta$,
      cameraMeta$,
      audio$,
      screenOn$,
      carriesMedia$(camera$),
    ]).subscribe({
      next: ([screenMeta, cameraMeta, audioMeta, screenOn, cameraOn]) => {
        const screen = toTrackRef(screenMeta)
        const camera = toTrackRef(cameraMeta)
        if (screen === null || camera === null) {
          setError("o SFU devolveu um endereço de trilha incompleto")
          return
        }

        // Live, yet neither carries anything: a picker or a permission prompt is
        // still open. Anything already announced would now be a placeholder,
        // which nobody may pull.
        if (!screenOn && !cameraOn) {
          if (announcement.current === null) return
          announcement.current = null
          send({ type: "broadcast-stop" })
          setStep("capturing")
          return
        }

        const message: ClientMessage = {
          type: "broadcast-start",
          screen: screenOn ? screen : null,
          camera: cameraOn ? camera : null,
          // Off with the screen, so viewers show the broadcast as silent instead
          // of a volume slider over nothing.
          audio: screenOn ? toTrackRef(audioMeta) : null,
        }
        setStep("announcing")
        announcement.current = message
        send(message)
        setStep("live")
      },
      error: (pushError: unknown) => {
        setError(describePushError(pushError))
      },
    })

    return () => {
      subscription.unsubscribe()
      announcement.current = null
      captureTrack.current = null
      setAudioTrack(null)
      setScreenTrack(null)
      setCameraTrack(null)
      send({ type: "broadcast-stop" })
    }
  }, [isLive, partyTracks, screenshare, send])

  // A dropped socket costs us our participant entry on the server, so whatever
  // we were broadcasting has to be announced again on the new one.
  useEffect(() => {
    if (!connected) return
    const message = announcement.current
    if (message === null) return
    send(message)
  }, [connected, send])

  const toggleScreen = useCallback(() => {
    screenshare.toggleBroadcasting()
  }, [screenshare])

  const stop = useCallback(() => {
    turnCameraOff()
    if (isSharingScreen) screenshare.toggleBroadcasting()
  }, [isSharingScreen, screenshare])

  return useMemo(
    () => ({
      isLive,
      isSharingScreen,
      isCameraOn,
      screenTrack,
      cameraTrack,
      error,
      step,
      audioTrack,
      toggleScreen,
      toggleCamera,
      stop,
    }),
    [
      isLive,
      isSharingScreen,
      isCameraOn,
      screenTrack,
      cameraTrack,
      error,
      step,
      audioTrack,
      toggleScreen,
      stop,
    ],
  )
}
