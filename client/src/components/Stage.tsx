import {
  type ChangeEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { type TrackMetadata, createAudioSink } from "partytracks/client"
import { useObservable } from "partytracks/react"
import { type Observable, of } from "rxjs"
import type { Broadcast, Participant } from "@shared/protocol"
import { useFullscreen } from "../fullscreen"
import { TileChrome, usePointerIdle } from "../pointerIdle"
import { getScreenshareSource, getWatchTracks } from "../tracks"
import {
  CloseIcon,
  EnterFullscreenIcon,
  ExitFullscreenIcon,
  PlayIcon,
  SpeakerIcon,
  SpeakerOffIcon,
} from "./Icons"

const DEFAULT_VOLUME = 1
const VOLUME_STEP = 0.05

const videoClassName = "size-full object-contain"

const frameClassName = "overflow-hidden rounded-2xl border border-dashed border-edge"

/**
 * The tile while it owns the whole screen.
 *
 * The card looks go: a dashed border along the screen edges and rounded corners
 * over the black backdrop read as a rendering fault rather than as decoration.
 * Leaving the grid's flow is what the desktop app needs — there the window goes
 * fullscreen natively and nothing would move the tile on its own — and in a
 * browser it only repeats what the fullscreen element already is.
 */
const fullscreenFrameClassName = "fixed inset-0 z-50 rounded-none border-none bg-surface"

/**
 * Anything drawn over the picture, while the pointer is quiet and after it
 * moves. Shared so that the header and the controls in the corner of the video
 * fade as one thing rather than as several.
 */
function chromeClassName(hidden: boolean): string {
  return [
    "transition-opacity duration-300",
    hidden ? "pointer-events-none opacity-0" : "opacity-100",
  ].join(" ")
}

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
  const partyTracks = getWatchTracks()
  const videoRef = useRef<HTMLVideoElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const [audioBlocked, setAudioBlocked] = useState(false)
  const [volume, setVolume] = useState(DEFAULT_VOLUME)
  const [muted, setMuted] = useState(false)
  const chrome = useContext(TileChrome)

  /** The slider at the bottom is silence too, and the icon has to say so. */
  const silent = muted || volume === 0

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
    // Reaching for the slider is asking to hear something, so it lifts a mute
    // rather than fighting it.
    setMuted(false)
    const element = audioRef.current
    if (element === null) return
    element.volume = next
    element.muted = false
  }

  function toggleMuted(): void {
    const next = !silent
    // Leaving mute with the slider at the bottom would be silence again, under
    // an icon claiming otherwise.
    const restored = !next && volume === 0 ? DEFAULT_VOLUME : volume

    setMuted(next)
    setVolume(restored)

    const element = audioRef.current
    if (element === null) return
    element.muted = next
    element.volume = restored
  }

  return (
    <div className="relative size-full">
      <video ref={videoRef} autoPlay playsInline muted className={videoClassName} />
      <audio ref={audioRef} />

      {audioTrack$ === null && (
        <p
          className={[
            // Below the header, which floats over the top of the picture.
            "absolute top-12 left-3 rounded-md bg-surface/80 px-2 py-1 text-xs text-ink-muted",
            chromeClassName(chrome.idle),
          ].join(" ")}
        >
          sem áudio nesta transmissão
        </p>
      )}

      {/* Never hidden with the rest: it is not decoration but the one thing
          standing between the viewer and any sound at all. */}
      {audioBlocked && (
        <button
          type="button"
          onClick={startAudio}
          className="absolute top-12 left-3 flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-accent-ink"
        >
          <SpeakerIcon />
          Clique para ouvir
        </button>
      )}

      {audioTrack$ !== null && !audioBlocked && (
        <div
          {...chrome.holdProps}
          className={[
            "absolute right-3 bottom-3 flex items-center gap-2 rounded-md bg-surface/80 px-3 py-1.5 text-xs text-ink-muted",
            chromeClassName(chrome.idle),
          ].join(" ")}
        >
          <button
            type="button"
            onClick={toggleMuted}
            aria-pressed={silent}
            aria-label={silent ? "Ouvir a transmissão" : "Silenciar a transmissão"}
            title={silent ? "Ouvir a transmissão" : "Silenciar a transmissão"}
            className="transition hover:text-ink"
          >
            {silent ? <SpeakerOffIcon /> : <SpeakerIcon />}
          </button>
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
        </div>
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
        className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink transition hover:brightness-110"
      >
        <PlayIcon />
        Assistir transmissão
      </button>
    </div>
  )
}

/**
 * The whole tile goes fullscreen, header included, rather than the video alone:
 * the button that got us here is the one that has to take us back, and it can
 * only do that while it is still on screen. The volume slider comes along for
 * the same reason.
 *
 * The header floats over the picture rather than standing above it. Hiding one
 * that holds its own space leaves a band of empty interface across the top of
 * the screen, which reads as a fault rather than as the picture being left
 * alone.
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
  const { isFullscreen, toggle } = useFullscreen(frameRef)
  const { idle, holdProps } = usePointerIdle(frameRef, isFullscreen)

  // A tile with no picture has nothing to uncover, and taking the name away
  // from under a cursor aiming at the button below it helps nobody.
  const hidden = fullscreenable && idle

  const fullscreenLabel = isFullscreen ? "Sair da tela cheia" : "Tela cheia"

  return (
    <TileChrome.Provider value={{ idle: hidden, holdProps }}>
      <div
        ref={frameRef}
        className={[
          "flex min-h-0 flex-col",
          frameClassName,
          // Never `relative` alongside the fullscreen class: both set
          // `position`, and Tailwind emits `.relative` after `.fixed`, so the
          // tile would win its own way back into the grid while the window
          // alone filled the screen. `fixed` anchors the floating header just
          // as well.
          isFullscreen ? fullscreenFrameClassName : "relative",
          hidden ? "cursor-none" : "",
        ].join(" ")}
      >
        <div
          {...holdProps}
          className={[
            "absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-2 px-3 py-2",
            "bg-surface/70 backdrop-blur-sm",
            chromeClassName(hidden),
          ].join(" ")}
        >
          <span className="truncate text-sm font-medium">{label}</span>
          <div className="flex shrink-0 items-center gap-1">
            {action}
            {fullscreenable && (
              <button
                type="button"
                onClick={toggle}
                aria-label={fullscreenLabel}
                title={fullscreenLabel}
                className={headerButtonClassName}
              >
                {isFullscreen ? <ExitFullscreenIcon /> : <EnterFullscreenIcon />}
              </button>
            )}
          </div>
        </div>
        <div className="min-h-0 flex-1">{children}</div>
      </div>
    </TileChrome.Provider>
  )
}

function StopWatchingButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label="Parar de assistir"
      title="Parar de assistir"
      className={headerButtonClassName}
    >
      <CloseIcon />
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
