import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { type TrackMetadata, createAudioSink } from "partytracks/client"
import { useObservable } from "partytracks/react"
import { type Observable, of } from "rxjs"
import type { Broadcast, Participant } from "@shared/protocol"
import { getPartyTracks, getScreenshareSource } from "../tracks"

const DEFAULT_VOLUME = 1
const VOLUME_STEP = 0.05

const videoClassName = "size-full object-contain"

function remoteTrack$(sessionId: string, trackName: string): Observable<TrackMetadata> {
  return of({ location: "remote", sessionId, trackName })
}

/**
 * Our own screen, taken straight from the local capture rather than pulled back
 * from the SFU: identical picture, none of the round trip or the egress.
 */
function LocalPreview() {
  const screenshare = getScreenshareSource()
  const videoRef = useRef<HTMLVideoElement>(null)

  useObservable(screenshare.video.broadcastTrack$, (track) => {
    const element = videoRef.current
    if (element === null) return
    element.srcObject = new MediaStream([track])
  })

  return <video ref={videoRef} autoPlay playsInline muted className={videoClassName} />
}

function RemoteBroadcast({ broadcast }: { broadcast: Broadcast }) {
  const partyTracks = getPartyTracks()
  const videoRef = useRef<HTMLVideoElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const [audioBlocked, setAudioBlocked] = useState(false)
  const [volume, setVolume] = useState(DEFAULT_VOLUME)

  // Deps are the primitive parts of the address: the objects arrive fresh from
  // JSON on every room snapshot, so memoizing on them would rebuild the pull on
  // every render.
  const { sessionId: videoSession, trackName: videoTrack } = broadcast.video
  const audioSession = broadcast.audio?.sessionId ?? null
  const audioTrack = broadcast.audio?.trackName ?? null

  const videoTrack$ = useMemo(
    () => partyTracks.pull(remoteTrack$(videoSession, videoTrack)),
    [partyTracks, videoSession, videoTrack],
  )

  const audioTrack$ = useMemo(() => {
    if (audioSession === null || audioTrack === null) return null
    return partyTracks.pull(remoteTrack$(audioSession, audioTrack))
  }, [partyTracks, audioSession, audioTrack])

  useObservable(videoTrack$, (track) => {
    const element = videoRef.current
    if (element === null) return
    element.srcObject = new MediaStream([track])
  })

  const startAudio = useCallback(() => {
    const element = audioRef.current
    if (element === null) return
    element
      .play()
      .then(() => setAudioBlocked(false))
      .catch(() => setAudioBlocked(true))
  }, [])

  useEffect(() => {
    const element = audioRef.current
    if (audioTrack$ === null || element === null) return undefined

    const sink = createAudioSink({ audioElement: element })
    const subscription = sink.attach(audioTrack$)

    // Playback can only start once the sink has attached a source, and the
    // browser refuses it outright until the page has seen a user gesture.
    element.addEventListener("loadedmetadata", startAudio)
    startAudio()

    return () => {
      element.removeEventListener("loadedmetadata", startAudio)
      subscription.unsubscribe()
      sink.cleanup()
    }
  }, [audioTrack$, startAudio])

  function handleVolume(event: ChangeEvent<HTMLInputElement>): void {
    const next = Number(event.target.value)
    setVolume(next)
    const element = audioRef.current
    if (element !== null) element.volume = next
  }

  return (
    <div className="relative size-full">
      <video ref={videoRef} autoPlay playsInline muted className={videoClassName} />
      <audio ref={audioRef} />

      {audioTrack$ === null && (
        <p className="absolute top-3 left-3 rounded-md bg-surface/80 px-2 py-1 text-xs text-ink-muted">
          sem áudio nesta transmissão
        </p>
      )}

      {audioBlocked && (
        <button
          type="button"
          onClick={startAudio}
          className="absolute top-3 left-3 rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-accent-ink"
        >
          🔊 Clique para ouvir
        </button>
      )}

      {audioTrack$ !== null && !audioBlocked && (
        <label className="absolute right-3 bottom-3 flex items-center gap-2 rounded-md bg-surface/80 px-3 py-1.5 text-xs text-ink-muted">
          🔊
          <input
            type="range"
            min={0}
            max={1}
            step={VOLUME_STEP}
            value={volume}
            onChange={handleVolume}
            aria-label="volume"
            className="accent-accent"
          />
        </label>
      )}
    </div>
  )
}

function EmptyStage() {
  return (
    <div className="flex size-full flex-col items-center justify-center gap-4 px-8 text-center">
      <span className="flex size-20 items-center justify-center rounded-2xl bg-surface-raised text-4xl">
        🖥️
      </span>
      <h2 className="text-lg font-semibold">Ninguém transmitindo agora</h2>
      <p className="max-w-md text-sm leading-relaxed text-ink-muted">
        Clique em <strong className="text-ink">Transmitir minha tela</strong> e escolha o que
        compartilhar. Pra jogo em tela cheia, compartilhe <strong className="text-ink">a tela
        inteira</strong> e marque <strong className="text-ink">"compartilhar áudio"</strong>.
      </p>
    </div>
  )
}

type Props = {
  selected: Participant | null
  you: string | null
}

export function Stage({ selected, you }: Props) {
  const border = "m-4 flex-1 overflow-hidden rounded-2xl border border-dashed border-edge"

  if (selected === null || selected.broadcast === null) {
    return (
      <section className={border}>
        <EmptyStage />
      </section>
    )
  }

  if (selected.nickname === you) {
    return (
      <section className={border}>
        <LocalPreview />
      </section>
    )
  }

  return (
    <section className={border}>
      {/* Keyed on the address so a republished track remounts with fresh pulls. */}
      <RemoteBroadcast
        key={`${selected.broadcast.video.sessionId}/${selected.broadcast.video.trackName}`}
        broadcast={selected.broadcast}
      />
    </section>
  )
}
