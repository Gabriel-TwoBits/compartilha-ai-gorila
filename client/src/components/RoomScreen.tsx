import { type ReactNode, useEffect, useState } from "react"
import type { Participant } from "@shared/protocol"
import { logout } from "../api"
import { type DesktopSource, desktopBridge } from "../desktop"
import { chooseSource } from "../desktopScreenshare"
import { type Broadcasting, describeStep, useBroadcast } from "../useBroadcast"
import { useRoomSounds } from "../useRoomSounds"
import { useSignaling } from "../useSignaling"
import { AudioModes } from "./AudioModes"
import { CameraPanel } from "./CameraPanel"
import { Download, hasDownload } from "./Download"
import {
  CameraIcon,
  CameraOffIcon,
  DownloadIcon,
  ScreenIcon,
  SpeakerIcon,
  SpinnerIcon,
  StopIcon,
} from "./Icons"
import { AudioSource } from "./AudioSource"
import { LevelMeter } from "./LevelMeter"
import { Participants } from "./Participants"
import { Quality } from "./Quality"
import { SourcePicker } from "./SourcePicker"
import { SoundToggle } from "./SoundToggle"
import { Stage } from "./Stage"

type Props = {
  nickname: string
  onLogout: () => void
}

/** The panels that open above the footer, one at a time. */
type Panel = "audio" | "camera" | "download"

/** Shared by the toggles that open a panel above the footer. */
const panelButtonClassName =
  "flex items-center gap-1.5 rounded-md border border-edge bg-surface-raised px-2 py-1.5 text-xs text-ink transition hover:brightness-110"

function statusLine(connected: boolean, broadcasterCount: number): string {
  if (!connected) return "reconectando…"
  if (broadcasterCount === 0) return "aguardando alguém transmitir"
  if (broadcasterCount === 1) return "1 transmissão no ar"
  return `${broadcasterCount} transmissões no ar`
}

/**
 * What the footer says, in priority order: a failure, then our own broadcast
 * still assembling, then the room at large.
 *
 * The middle case exists because the handshake takes seconds a person cannot
 * account for. Without it the only sign anything is happening is the button
 * label, which says the same thing whether the SFU is slow or the whole attempt
 * has died. The spinner belongs to that case alone: a step that names itself
 * still reads as frozen next to text that never moves.
 */
function footerLine(
  broadcast: Broadcasting,
  connected: boolean,
  broadcasterCount: number,
): ReactNode {
  if (broadcast.error !== null) return broadcast.error
  if (broadcast.isLive && broadcast.step !== "live") {
    return (
      <>
        <SpinnerIcon />
        {`${describeStep(broadcast.step)}…`}
      </>
    )
  }
  return statusLine(connected, broadcasterCount)
}

export function RoomScreen({ nickname, onLogout }: Props) {
  const signaling = useSignaling()
  const broadcast = useBroadcast(signaling)
  useRoomSounds(signaling.room)

  /** Whose broadcasts the viewer asked to open. Nothing is pulled until they do. */
  const [openedNicknames, setOpenedNicknames] = useState<string[]>([])

  /**
   * Our own picker, open only in the desktop app where a list exists.
   *
   * Under the Wayland portal, and in a browser, the capture call raises a
   * picker of its own — opening one here first would be two pickers for one
   * choice.
   */
  const [pickerOpen, setPickerOpen] = useState(false)

  /**
   * Which panel is open above the footer, if any. One at a time: they share
   * the strip, and stacking them would push the stage around.
   */
  const [panel, setPanel] = useState<Panel | null>(null)
  const bridge = desktopBridge()
  const picksOwnSource = bridge !== null && !bridge.usesPortal

  function togglePanel(which: Panel): void {
    setPanel((open) => (open === which ? null : which))
  }

  /** Stopping takes the camera down too: "stop" means off the air, not "less". */
  function handleBroadcastClick(): void {
    if (broadcast.isSharingScreen) {
      broadcast.stop()
      return
    }
    if (!picksOwnSource) {
      broadcast.toggleScreen()
      return
    }
    setPickerOpen(true)
  }

  function startWith(source: DesktopSource): void {
    chooseSource(source)
    setPickerOpen(false)
    broadcast.toggleScreen()
  }

  /** Asked for and not yet open: the permission prompt or the device is slow. */
  const cameraOpening = broadcast.isCameraOn && broadcast.cameraTrack === null
  const cameraLabel = broadcast.isCameraOn ? "Desligar a câmera" : "Mostrar a câmera"

  const participants: Participant[] = signaling.room?.participants ?? []
  const you = signaling.room?.you ?? null
  const broadcasters = participants.filter((participant) => participant.broadcast !== null)

  // Derived rather than synced with an effect: whoever was opened may since have
  // stopped, which drops them from the count without any bookkeeping. Our own
  // screen never counts — it comes from the local capture, not from the SFU.
  const watching = broadcasters
    .filter(
      (participant) =>
        participant.nickname !== you && openedNicknames.includes(participant.nickname),
    )
    .map((participant) => participant.nickname)

  // Feeds the viewer counts everyone else sees, and reports only what is
  // actually being pulled. Nicknames are stripped of control characters, so a
  // newline cannot appear inside one and joins them into a stable effect key —
  // the array itself is rebuilt on every render.
  const watchingKey = watching.join("\n")
  const { send } = signaling
  useEffect(() => {
    const nicknames = watchingKey === "" ? [] : watchingKey.split("\n")
    send({ type: "watching", nicknames })
  }, [send, watchingKey, signaling.connected])

  function openBroadcast(nickname: string): void {
    setOpenedNicknames((current) => {
      if (current.includes(nickname)) return current
      return [...current, nickname]
    })
  }

  function closeBroadcast(nickname: string): void {
    setOpenedNicknames((current) => current.filter((opened) => opened !== nickname))
  }

  async function handleLogout(): Promise<void> {
    await logout()
    onLogout()
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-edge px-4 py-3">
        <span className="flex items-center gap-2 text-lg font-semibold">
          <img src="/icon.png" alt="" className="size-6" />
          {/* The whole name is one flex item: loose, the row's gap opens inside it. */}
          <span>
            Compartilha<span className="text-accent">AíGorila</span>
          </span>
        </span>

        <div className="flex items-center gap-3">
          <SoundToggle />
          <span className="text-sm text-ink-muted">{nickname}</span>
          <button
            type="button"
            onClick={handleLogout}
            className="rounded-md px-2 py-1 text-sm text-ink-muted transition hover:bg-surface-raised hover:text-ink"
          >
            Sair
          </button>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        {pickerOpen && (
          <SourcePicker onChoose={startWith} onCancel={() => setPickerOpen(false)} />
        )}
        <Stage
          broadcasters={broadcasters}
          you={you}
          opened={openedNicknames}
          onOpen={openBroadcast}
          onClose={closeBroadcast}
          localScreen={broadcast.screenTrack}
          localCamera={broadcast.cameraTrack}
        />
        <Participants participants={participants} you={you} />
      </div>

      {panel === "audio" && bridge !== null && (
        <div className="border-t border-edge px-4 py-3">
          <AudioModes />
        </div>
      )}

      {panel === "camera" && (
        <div className="border-t border-edge px-4 py-3">
          <CameraPanel />
        </div>
      )}

      {panel === "download" && (
        <div className="border-t border-edge px-4 py-3">
          <Download />
        </div>
      )}

      <footer className="flex items-center justify-between gap-4 px-4 py-3">
        <p className="flex items-center gap-2 font-mono text-xs text-ink-muted">
          {footerLine(broadcast, signaling.connected, broadcasters.length)}
        </p>

        <div className="flex items-center gap-3">
          {broadcast.isLive && <LevelMeter track={broadcast.audioTrack} />}
          <Quality />
          {bridge === null ? (
            <AudioSource />
          ) : (
            <button
              type="button"
              onClick={() => togglePanel("audio")}
              aria-expanded={panel === "audio"}
              className={panelButtonClassName}
            >
              <SpeakerIcon />
              Áudio
            </button>
          )}

          {/* Where the need actually shows up: somebody goes to broadcast
              and finds the browser will not carry the game's sound. */}
          {hasDownload() && (
            <button
              type="button"
              onClick={() => togglePanel("download")}
              aria-expanded={panel === "download"}
              className={panelButtonClassName}
            >
              <DownloadIcon />
              Baixar o app
            </button>
          )}

          <button
            type="button"
            onClick={() => togglePanel("camera")}
            aria-expanded={panel === "camera"}
            className={panelButtonClassName}
          >
            <CameraIcon />
            Câmera
          </button>

          {/* Apart from the screen button on purpose: the camera can go on
              with the screen, on its own, or mid-broadcast. */}
          <button
            type="button"
            onClick={broadcast.toggleCamera}
            disabled={cameraOpening}
            aria-pressed={broadcast.isCameraOn}
            aria-label={cameraLabel}
            title={cameraLabel}
            className={[
              "flex items-center rounded-lg p-2.5 text-sm transition hover:brightness-110 disabled:opacity-60",
              broadcast.isCameraOn ? "bg-accent text-accent-ink" : "border border-edge bg-surface-raised text-ink",
            ].join(" ")}
          >
            {cameraOpening && <SpinnerIcon />}
            {!cameraOpening && broadcast.isCameraOn && <CameraIcon />}
            {!broadcast.isCameraOn && <CameraOffIcon />}
          </button>

          <button
            type="button"
            onClick={handleBroadcastClick}
            className={[
              "flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition",
              "hover:brightness-110",
              broadcast.isSharingScreen ? "bg-red-500 text-white" : "bg-accent text-accent-ink",
            ].join(" ")}
          >
            {broadcast.isSharingScreen ? <StopIcon /> : <ScreenIcon />}
            {broadcast.isSharingScreen ? "Parar transmissão" : "Transmitir minha tela"}
          </button>
        </div>
      </footer>
    </div>
  )
}
