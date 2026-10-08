import {
  type ChangeEvent,
  type PointerEvent,
  type ReactNode,
  type WheelEvent,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { type TrackMetadata, createAudioSink } from "partytracks/client"
import { type Observable, of } from "rxjs"
import type { Broadcast, Participant, TrackRef } from "@shared/protocol"
import { useFullscreen } from "../fullscreen"
import { TileChrome, usePointerIdle } from "../pointerIdle"
import {
  type Corner,
  clampOverlayWidth,
  handleCorner,
  movedEnough,
  nearestCorner,
  parseCorner,
  parseOverlayWidth,
} from "../corners"
import { getWatchTracks } from "../tracks"
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

/** Mirrors the picture horizontally, the way a person expects to see their own face. */
const mirroredClassName = "-scale-x-100"

/** A `<video>` showing one track, or black while there is none yet. */
function TrackVideo({
  track,
  mirrored,
  className,
}: {
  track: MediaStreamTrack | null
  mirrored: boolean
  className: string
}) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const element = videoRef.current
    if (element === null) return
    element.srcObject = track === null ? null : new MediaStream([track])
  }, [track])

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted
      className={mirrored ? `${className} ${mirroredClassName}` : className}
    />
  )
}

const CORNER_STORAGE_KEY = "cag:camera-corner"
const WIDTH_STORAGE_KEY = "cag:camera-width"

/** How much one notch of the wheel grows or shrinks the overlay, in % of the tile. */
const WHEEL_STEP_PERCENT = 2

/** Turns a fraction of the tile's width into the percentage the overlay is sized in. */
const PERCENT_PER_WHOLE = 100

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    // Private windows and blocked site data throw on access rather than
    // returning null.
    return null
  }
}

function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // The preference not surviving a reload is not worth failing over.
  }
}

/**
 * Clear of the floating header at the top and of the volume pill at the bottom,
 * so the overlay never sits on a control.
 */
const CORNER_CLASS_NAMES: Record<Corner, string> = {
  "bottom-right": "right-3 bottom-14",
  "bottom-left": "left-3 bottom-14",
  "top-right": "right-3 top-12",
  "top-left": "left-3 top-12",
}

const HANDLE_CLASS_NAMES: Record<Corner, string> = {
  "top-left": "top-0 left-0 cursor-nwse-resize",
  "top-right": "top-0 right-0 cursor-nesw-resize",
  "bottom-left": "bottom-0 left-0 cursor-nesw-resize",
  "bottom-right": "bottom-0 right-0 cursor-nwse-resize",
}

type Drag = {
  startX: number
  startY: number
  /** The overlay's offset inside the tile when the drag began. */
  left: number
  top: number
  moved: boolean
}

type Resize = {
  startX: number
  initialWidth: number
  tileWidth: number
}

/**
 * The camera over the screen, as in a stream.
 *
 * Dragging moves it and letting go snaps it to the nearest corner; a click with
 * no drag swaps it with the picture behind. Both gestures live on the same
 * element, and movement is what tells them apart. The corner and the size are
 * the viewer's preference and outlive the broadcast; nothing here travels over
 * the network.
 */
function CameraOverlay({
  track,
  mirrored,
  onSwap,
}: {
  track: MediaStreamTrack
  mirrored: boolean
  onSwap: () => void
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  const resize = useRef<Resize | null>(null)
  const [corner, setCorner] = useState<Corner>(() => parseCorner(readStored(CORNER_STORAGE_KEY)))
  const [width, setWidth] = useState(() => parseOverlayWidth(readStored(WIDTH_STORAGE_KEY)))
  /** Where the overlay is while being dragged, in px from the tile's corner. */
  const [dragged, setDragged] = useState<{ left: number; top: number } | null>(null)

  /** Functional, since wheel notches arrive faster than renders. */
  function changeWidth(update: (current: number) => number): void {
    setWidth((current) => {
      const clamped = clampOverlayWidth(update(current))
      writeStored(WIDTH_STORAGE_KEY, String(clamped))
      return clamped
    })
  }

  function tileRect(): DOMRect | null {
    return boxRef.current?.parentElement?.getBoundingClientRect() ?? null
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>): void {
    const box = boxRef.current?.getBoundingClientRect()
    const tile = tileRect()
    if (box === undefined || tile === null) return
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = {
      startX: event.clientX,
      startY: event.clientY,
      left: box.left - tile.left,
      top: box.top - tile.top,
      moved: false,
    }
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>): void {
    const current = drag.current
    if (current === null) return
    const dx = event.clientX - current.startX
    const dy = event.clientY - current.startY
    if (movedEnough(dx, dy)) current.moved = true
    if (current.moved) setDragged({ left: current.left + dx, top: current.top + dy })
  }

  function handlePointerUp(): void {
    const current = drag.current
    drag.current = null
    setDragged(null)
    if (current === null) return
    if (!current.moved) {
      onSwap()
      return
    }

    const box = boxRef.current?.getBoundingClientRect()
    const tile = tileRect()
    if (box === undefined || tile === null) return
    const next = nearestCorner(
      { x: box.left + box.width / 2, y: box.top + box.height / 2 },
      { left: tile.left, top: tile.top, width: tile.width, height: tile.height },
    )
    setCorner(next)
    writeStored(CORNER_STORAGE_KEY, next)
  }

  // The handle's gestures stop at the handle: a resize must never also be read
  // as a drag, nor end as a click that swaps the pictures.
  function handleResizeDown(event: PointerEvent<HTMLSpanElement>): void {
    event.stopPropagation()
    const tile = tileRect()
    if (tile === null) return
    event.currentTarget.setPointerCapture(event.pointerId)
    resize.current = { startX: event.clientX, initialWidth: width, tileWidth: tile.width }
  }

  function handleResizeMove(event: PointerEvent<HTMLSpanElement>): void {
    const current = resize.current
    if (current === null) return
    event.stopPropagation()
    // On the right-hand corners the handle faces left, so pulling left grows
    // the overlay; without the flip the gesture runs backwards on two corners.
    const direction = corner.endsWith("right") ? -1 : 1
    const dx = direction * (event.clientX - current.startX)
    changeWidth(() => current.initialWidth + (dx / current.tileWidth) * PERCENT_PER_WHOLE)
  }

  function handleResizeUp(event: PointerEvent<HTMLSpanElement>): void {
    event.stopPropagation()
    resize.current = null
  }

  function handleWheel(event: WheelEvent<HTMLDivElement>): void {
    const step = Math.sign(event.deltaY) * WHEEL_STEP_PERCENT
    changeWidth((current) => current - step)
  }

  const position = dragged === null ? CORNER_CLASS_NAMES[corner] : ""
  const style = dragged === null ? { width: `${width}%` } : { width: `${width}%`, ...dragged }

  return (
    <div
      ref={boxRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onWheel={handleWheel}
      title="Arraste para mover · clique para inverter · role para redimensionar"
      style={style}
      className={[
        "group absolute z-[5] aspect-video touch-none overflow-hidden rounded-lg border border-edge bg-black shadow-xl",
        dragged === null ? "cursor-grab" : "cursor-grabbing",
        position,
      ].join(" ")}
    >
      <TrackVideo track={track} mirrored={mirrored} className="size-full object-cover" />
      <span
        onPointerDown={handleResizeDown}
        onPointerMove={handleResizeMove}
        onPointerUp={handleResizeUp}
        onPointerCancel={handleResizeUp}
        title="Puxe para mudar o tamanho"
        className={[
          "absolute size-4 opacity-0 transition-opacity group-hover:opacity-100",
          "bg-ink/60",
          HANDLE_CLASS_NAMES[handleCorner(corner)],
        ].join(" ")}
      />
    </div>
  )
}

/**
 * A broadcast's pictures: the screen in the back with the camera over it, or
 * whichever of the two exists on its own.
 *
 * Swapping puts the camera in the back, the way a streamer does when the face
 * starts to matter more than the game. It is a choice of the moment and is not
 * remembered. Only the broadcaster sees their own camera mirrored; everyone
 * else gets the real picture.
 */
function BroadcastView({
  screen,
  camera,
  mirrorCamera,
}: {
  screen: MediaStreamTrack | null
  camera: MediaStreamTrack | null
  mirrorCamera: boolean
}) {
  const [swapped, setSwapped] = useState(false)

  let background: MediaStreamTrack | null = screen
  let overlay: MediaStreamTrack | null = null
  if (screen === null) {
    background = camera
  } else if (camera !== null) {
    background = swapped ? camera : screen
    overlay = swapped ? screen : camera
  } else {
    // Screen alone: nothing to put over it, nothing to swap.
  }

  const mirrorBackground = mirrorCamera && background !== null && background === camera
  const mirrorOverlay = mirrorCamera && overlay !== null && overlay === camera

  return (
    <>
      <TrackVideo track={background} mirrored={mirrorBackground} className={videoClassName} />
      {overlay !== null && (
        <CameraOverlay
          track={overlay}
          mirrored={mirrorOverlay}
          onSwap={() => setSwapped((current) => !current)}
        />
      )}
    </>
  )
}

/**
 * One remote track, pulled while its address is known and dropped when it goes.
 *
 * Deps are the primitive parts of the address: the objects arrive fresh from
 * JSON on every room snapshot, so memoizing on them would rebuild the pull on
 * every render.
 */
function usePulledTrack(ref: TrackRef | null): MediaStreamTrack | null {
  const partyTracks = getWatchTracks()
  const sessionId = ref?.sessionId ?? null
  const trackName = ref?.trackName ?? null
  const [track, setTrack] = useState<MediaStreamTrack | null>(null)

  useEffect(() => {
    if (sessionId === null || trackName === null) return undefined
    const subscription = partyTracks
      .pull(remoteTrack$(sessionId, trackName))
      .subscribe((pulled) => setTrack(pulled))
    return () => {
      subscription.unsubscribe()
      setTrack(null)
    }
  }, [partyTracks, sessionId, trackName])

  return track
}

/**
 * The last address a track was announced at, kept while it is announced off.
 *
 * Turning the camera or the screen off only swaps the publisher's track for a
 * placeholder; the address stays the same. Closing the pull there and pulling
 * again when it comes back renegotiates the viewer's session, which freezes the
 * other picture, and the SFU then refuses the second pull with 410 Gone. So a
 * track, once pulled, stays pulled for the whole broadcast and is merely hidden
 * while off.
 */
function useStickyTrackRef(ref: TrackRef | null): TrackRef | null {
  const [sticky, setSticky] = useState<TrackRef | null>(ref)
  const sessionId = ref?.sessionId ?? null
  const trackName = ref?.trackName ?? null

  useEffect(() => {
    if (sessionId === null || trackName === null) return
    setSticky((current) => {
      if (current?.sessionId === sessionId && current.trackName === trackName) return current
      return { sessionId, trackName }
    })
  }, [sessionId, trackName])

  return sticky
}

/**
 * Our own broadcast, taken straight from the local captures rather than pulled
 * back from the SFU: identical picture, none of the round trip or the egress.
 */
function LocalBroadcast({ screen, camera }: { screen: MediaStreamTrack | null; camera: MediaStreamTrack | null }) {
  return (
    <div className="relative size-full">
      <BroadcastView screen={screen} camera={camera} mirrorCamera />
    </div>
  )
}

function RemoteBroadcast({ broadcast }: { broadcast: Broadcast }) {
  const partyTracks = getWatchTracks()
  const audioRef = useRef<HTMLAudioElement>(null)
  const [audioBlocked, setAudioBlocked] = useState(false)
  const [volume, setVolume] = useState(DEFAULT_VOLUME)
  const [muted, setMuted] = useState(false)
  const chrome = useContext(TileChrome)

  /** The slider at the bottom is silence too, and the icon has to say so. */
  const silent = muted || volume === 0

  // Nothing is pulled before its address is announced: until then the track
  // carries the placeholder, which the SFU would never finish delivering.
  const screenTrack = usePulledTrack(useStickyTrackRef(broadcast.screen))
  const cameraTrack = usePulledTrack(useStickyTrackRef(broadcast.camera))

  // Sticky for the same reason as the video: the audio is announced off while the
  // screen is, and pulling it again when the screen comes back draws 410 Gone.
  const audioAddress = useStickyTrackRef(broadcast.audio)
  const audioOn = broadcast.audio !== null
  const audioSession = audioAddress?.sessionId ?? null
  const audioTrack = audioAddress?.trackName ?? null

  const audioTrack$ = useMemo(() => {
    if (audioSession === null || audioTrack === null) return null
    return partyTracks.pull(remoteTrack$(audioSession, audioTrack))
  }, [partyTracks, audioSession, audioTrack])

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
      <BroadcastView
        screen={broadcast.screen === null ? null : screenTrack}
        camera={broadcast.camera === null ? null : cameraTrack}
        mirrorCamera={false}
      />
      <audio ref={audioRef} />

      {!audioOn && (
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
      {audioOn && audioBlocked && (
        <button
          type="button"
          onClick={startAudio}
          className="absolute top-12 left-3 flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-accent-ink"
        >
          <SpeakerIcon />
          Clique para ouvir
        </button>
      )}

      {audioOn && !audioBlocked && (
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

function EmptyStage({ canShareScreen }: { canShareScreen: boolean }) {
  if (!canShareScreen) {
    return (
      <div className="flex size-full flex-col items-center justify-center gap-4 px-8 text-center">
        <span className="flex size-20 items-center justify-center rounded-2xl bg-surface-raised text-4xl">
          📷
        </span>
        <h2 className="text-lg font-semibold">Ninguém transmitindo agora</h2>
        <p className="max-w-md text-sm leading-relaxed text-ink-muted">
          Este aparelho não compartilha a tela, mas pode mostrar a câmera: toque no botão da
          câmera ali embaixo.
        </p>
      </div>
    )
  }

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
  /** Our own captures, shown in our tile instead of a copy pulled back from the SFU. */
  localScreen: MediaStreamTrack | null
  localCamera: MediaStreamTrack | null
  /** False on a phone, whose browser cannot share its screen. */
  canShareScreen: boolean
}

export function Stage({
  broadcasters,
  you,
  opened,
  onOpen,
  onClose,
  localScreen,
  localCamera,
  canShareScreen,
}: Props) {
  if (broadcasters.length === 0) {
    return (
      <section className={`m-4 flex-1 ${frameClassName}`}>
        <EmptyStage canShareScreen={canShareScreen} />
      </section>
    )
  }

  return (
    <section className={gridClassName}>
      {broadcasters.map((participant) => {
        const { nickname, broadcast } = participant

        // The caller filters these out; the type still admits one.
        if (broadcast === null) return null

        // Our own broadcast comes from the local captures, so there is nothing
        // to open and nothing to stop paying for.
        if (nickname === you) {
          return (
            <Tile
              key={nickname}
              label={broadcast.screen === null ? "Sua câmera" : "Sua tela"}
              action={null}
              fullscreenable
            >
              <LocalBroadcast screen={localScreen} camera={localCamera} />
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
            <RemoteBroadcast broadcast={broadcast} />
          </Tile>
        )
      })}
    </section>
  )
}
