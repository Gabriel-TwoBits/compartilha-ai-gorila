import {
  type ChangeEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { type TrackMetadata, createAudioSink } from "partytracks/client"
import { useObservable } from "partytracks/react"
import { type Observable, of } from "rxjs"
import type { Broadcast, Participant } from "@shared/protocol"
import { getPartyTracks, getScreenshareSource } from "../tracks"

const DEFAULT_VOLUME = 1
const VOLUME_STEP = 0.05

const videoClassName = "size-full object-contain"

const frameClassName = "overflow-hidden rounded-2xl border border-dashed border-edge"

/**
 * The tile drops its card looks once it owns the whole screen: a dashed border
 * along the screen edges and rounded corners over the black backdrop read as a
 * rendering fault rather than as decoration.
 */
const fullscreenFrameClassName =
  "[&:fullscreen]:rounded-none [&:fullscreen]:border-none [&:fullscreen]:bg-surface"

const headerButtonClassName =
  "shrink-0 rounded-md px-2 py-1 text-xs text-ink-muted transition hover:bg-surface-raised hover:text-ink"

/**
 * One tile per broadcast, reflowing as people start and stop. Rows never fall
 * below a readable height, so a busy room scrolls rather than shrinking every
 * screen into a thumbnail.
 */
const gridClassName = [
  "m-4 grid min-h-0 flex-1 gap-4 overflow-y-auto",
  "[grid-template-columns:repeat(auto-fit,minmax(20rem,1fr))]",
  "auto-rows-[minmax(12rem,1fr)]",
].join(" ")

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

/**
 * Gate in front of someone else's broadcast. Pulling a track is what costs
 * egress, so it waits for the viewer to ask for it rather than opening on its
 * own — and the room reports nobody as watching until they do.
 */
function WatchGate({ nickname, onWatch }: { nickname: string; onWatch: () => void }) {
  return (
    <div className="flex size-full flex-col items-center justify-center gap-3 px-6 text-center">
      <span className="text-4xl">📡</span>
      <p className="text-sm text-ink-muted">
        <strong className="text-ink">{nickname}</strong> está transmitindo
      </p>
      <button
        type="button"
        onClick={onWatch}
        className="rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink transition hover:brightness-110"
      >
        ▶ Assistir transmissão
      </button>
    </div>
  )
}

/** The browser refusing fullscreen leaves nothing to recover from or report. */
function ignoreRejection(): void {}

/**
 * Whether `element` is the one currently filling the screen. The event fires on
 * the document for every tile at once, so each has to check for itself.
 */
function useIsFullscreen(element: RefObject<HTMLElement | null>): boolean {
  const [isFullscreen, setIsFullscreen] = useState(false)

  useEffect(() => {
    function handleChange(): void {
      setIsFullscreen(document.fullscreenElement === element.current)
    }

    document.addEventListener("fullscreenchange", handleChange)
    return () => document.removeEventListener("fullscreenchange", handleChange)
  }, [element])

  return isFullscreen
}

/**
 * The whole tile goes fullscreen, header included, rather than the video alone:
 * the button that got us here is the one that has to take us back, and it can
 * only do that while it is still on screen. The volume slider comes along for
 * the same reason.
 */
function Tile({
  label,
  action,
  fullscreenable,
  children,
}: {
  label: string
  action: ReactNode
  /** False for a tile showing no video, where filling the screen achieves nothing. */
  fullscreenable: boolean
  children: ReactNode
}) {
  const frameRef = useRef<HTMLDivElement>(null)
  const isFullscreen = useIsFullscreen(frameRef)

  function toggleFullscreen(): void {
    const element = frameRef.current
    if (element === null) return
    if (document.fullscreenElement === element) {
      void document.exitFullscreen().catch(ignoreRejection)
      return
    }
    // Another tile holding fullscreen is simply replaced by this one.
    void element.requestFullscreen().catch(ignoreRejection)
  }

  return (
    <div
      ref={frameRef}
      className={`flex min-h-0 flex-col ${frameClassName} ${fullscreenFrameClassName}`}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-edge px-3 py-2">
        <span className="truncate text-sm font-medium">{label}</span>
        <div className="flex shrink-0 items-center gap-1">
          {action}
          {fullscreenable && (
            <button type="button" onClick={toggleFullscreen} className={headerButtonClassName}>
              {isFullscreen ? "⤡ Sair da tela cheia" : "⤢ Tela cheia"}
            </button>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  )
}

function StopWatchingButton({ onClose }: { onClose: () => void }) {
  return (
    <button type="button" onClick={onClose} className={headerButtonClassName}>
      ✕ Parar de assistir
    </button>
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
        compartilhar. Pra jogo em tela cheia, compartilhe{" "}
        <strong className="text-ink">a tela inteira</strong> e marque{" "}
        <strong className="text-ink">"compartilhar áudio"</strong>. No Linux o navegador não
        oferece essa opção fora de uma aba: escolha ali embaixo a entrada de áudio{" "}
        <strong className="text-ink">Monitor of…</strong> pra levar o som junto.
      </p>
    </div>
  )
}

type Props = {
  /** Everyone currently broadcasting, our own broadcast included. */
  broadcasters: Participant[]
  you: string | null
  /** Whose broadcasts the viewer has opened. */
  opened: string[]
  onOpen: (nickname: string) => void
  onClose: (nickname: string) => void
}

export function Stage({ broadcasters, you, opened, onOpen, onClose }: Props) {
  if (broadcasters.length === 0) {
    return (
      <section className={`m-4 flex-1 ${frameClassName}`}>
        <EmptyStage />
      </section>
    )
  }

  return (
    <section className={gridClassName}>
      {broadcasters.map((participant) => {
        const { nickname, broadcast } = participant

        // The caller filters these out; the type still admits one.
        if (broadcast === null) return null

        // Our own screen comes from the local capture, so there is nothing to
        // open and nothing to stop paying for.
        if (nickname === you) {
          return (
            <Tile key={nickname} label="Sua tela" action={null} fullscreenable>
              <LocalPreview />
            </Tile>
          )
        }

        if (!opened.includes(nickname)) {
          return (
            <Tile key={nickname} label={nickname} action={null} fullscreenable={false}>
              <WatchGate nickname={nickname} onWatch={() => onOpen(nickname)} />
            </Tile>
          )
        }

        return (
          <Tile
            key={nickname}
            label={nickname}
            action={<StopWatchingButton onClose={() => onClose(nickname)} />}
            fullscreenable
          >
            {/* Keyed on the address so a republished track remounts with fresh pulls. */}
            <RemoteBroadcast
              key={`${broadcast.video.sessionId}/${broadcast.video.trackName}`}
              broadcast={broadcast}
            />
          </Tile>
        )
      })}
    </section>
  )
}
