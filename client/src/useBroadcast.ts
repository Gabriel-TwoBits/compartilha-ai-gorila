import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useObservable, useObservableAsValue } from "partytracks/react"
import { catchError, combineLatest, distinctUntilChanged, of, startWith, switchMap } from "rxjs"
import type { ClientMessage } from "@shared/protocol"
import { audioInputTrack$, audioSourceId$ } from "./audioSource"
import { getPartyTracks, getScreenshareSource, toTrackRef, videoSendEncodings } from "./tracks"
import type { Signaling } from "./useSignaling"

/** `useObservable` demands an observer; here the subscription itself is the point. */
function ignore(): void {}

/** Whatever rxjs hands the error callback, the footer needs a string. */
function describePushError(pushError: unknown): string {
  if (pushError instanceof Error) return `falha ao publicar a transmissão: ${pushError.message}`
  return "falha ao publicar a transmissão"
}

/** A failing audio source must not take the broadcast down, but silence needs a reason. */
function describeAudioError(audioError: unknown): string {
  if (audioError instanceof Error) return `transmitindo sem áudio: ${audioError.message}`
  return "transmitindo sem áudio"
}

export type Broadcasting = {
  isBroadcasting: boolean
  /** Last error while acquiring the screen, e.g. the picker being dismissed. */
  error: string | null
  toggle: () => void
}

/**
 * Publishes our screen to the SFU and announces its track addresses to the room.
 *
 * The push subscription is tied to `isBroadcasting` rather than being permanent:
 * partytracks swaps in an empty placeholder track when not broadcasting, and
 * paying to relay that through Cloudflare for every idle participant would be
 * pure waste.
 */
export function useBroadcast(signaling: Signaling): Broadcasting {
  const partyTracks = getPartyTracks()
  const screenshare = getScreenshareSource()
  const { send, connected } = signaling

  const isBroadcasting = useObservableAsValue(screenshare.isBroadcasting$, false)
  const [error, setError] = useState<string | null>(null)

  // `isBroadcasting$` is only ever fed from inside the `broadcastTrack$`
  // pipeline, and that pipeline is ref-counted: with nobody subscribed,
  // toggling flips a flag nothing reads, the screen picker never opens and the
  // effect below never runs. This keeps it warm — while idle it emits a local
  // black canvas and touches neither the capture APIs nor the network.
  useObservable(screenshare.video.broadcastTrack$, ignore)

  /** What the room was last told, so a reconnect can repeat it. */
  const announcement = useRef<ClientMessage | null>(null)

  useObservable(screenshare.video.error$, (screenError) => {
    setError(screenError.message)
  })

  useEffect(() => {
    if (!isBroadcasting) return undefined

    setError(null)

    const video$ = partyTracks.push(screenshare.video.broadcastTrack$, {
      sendEncodings$: of(videoSendEncodings),
    })
    // Audio is optional and its source is the user's to pick: the screen picker
    // only yields a track when "share audio" is ticked, and on some platforms
    // never — hence the hand-picked input, which is switched into the push
    // without disturbing the video. `startWith` lets the broadcast be announced
    // on video alone, then announced again once audio shows up.
    const audio$ = audioSourceId$.pipe(
      distinctUntilChanged(),
      switchMap((sourceId) => {
        const source$ =
          sourceId === null ? screenshare.audio.broadcastTrack$ : audioInputTrack$(sourceId)
        return partyTracks.push(source$).pipe(
          startWith(null),
          catchError((audioError: unknown) => {
            setError(describeAudioError(audioError))
            return of(null)
          }),
        )
      }),
    )

    // A failing video push is otherwise invisible: it takes the announcement
    // down with it, so the screen is captured, nobody ever receives it and the
    // room reports nothing wrong. `error$` above only covers acquiring the
    // screen, never publishing it.
    const subscription = combineLatest([video$, audio$]).subscribe({
      next: ([videoMeta, audioMeta]) => {
        const video = toTrackRef(videoMeta)
        if (video === null) {
          setError("o SFU devolveu um endereço de trilha incompleto")
          return
        }
        const message: ClientMessage = {
          type: "broadcast-start",
          video,
          audio: toTrackRef(audioMeta),
        }
        announcement.current = message
        send(message)
      },
      error: (pushError: unknown) => {
        setError(describePushError(pushError))
      },
    })

    return () => {
      subscription.unsubscribe()
      announcement.current = null
      send({ type: "broadcast-stop" })
    }
  }, [isBroadcasting, partyTracks, screenshare, send])

  // A dropped socket costs us our participant entry on the server, so whatever
  // we were broadcasting has to be announced again on the new one.
  useEffect(() => {
    if (!connected) return
    const message = announcement.current
    if (message === null) return
    send(message)
  }, [connected, send])

  const toggle = useCallback(() => {
    screenshare.toggleBroadcasting()
  }, [screenshare])

  return useMemo(() => ({ isBroadcasting, error, toggle }), [isBroadcasting, error, toggle])
}
