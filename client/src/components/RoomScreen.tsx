import { useEffect, useState } from "react"
import type { Participant } from "@shared/protocol"
import { logout } from "../api"
import { type Broadcasting, describeStep, useBroadcast } from "../useBroadcast"
import { useRoomSounds } from "../useRoomSounds"
import { useSignaling } from "../useSignaling"
import { AudioSource } from "./AudioSource"
import { LevelMeter } from "./LevelMeter"
import { Participants } from "./Participants"
import { Quality } from "./Quality"
import { SoundToggle } from "./SoundToggle"
import { Stage } from "./Stage"

type Props = {
  nickname: string
  onLogout: () => void
}

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
 * has died.
 */
function footerLine(
  broadcast: Broadcasting,
  connected: boolean,
  broadcasterCount: number,
): string {
  if (broadcast.error !== null) return broadcast.error
  if (broadcast.isBroadcasting && broadcast.step !== "live") {
    return `${describeStep(broadcast.step)}…`
  }
  return statusLine(connected, broadcasterCount)
}

export function RoomScreen({ nickname, onLogout }: Props) {
  const signaling = useSignaling()
  const broadcast = useBroadcast(signaling)
  useRoomSounds(signaling.room)

  /** Whose broadcasts the viewer asked to open. Nothing is pulled until they do. */
  const [openedNicknames, setOpenedNicknames] = useState<string[]>([])

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
        <span className="text-lg font-semibold">
          🦍 Compartilha<span className="text-accent">AíGorila</span>
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

      <div className="flex min-h-0 flex-1">
        <Stage
          broadcasters={broadcasters}
          you={you}
          opened={openedNicknames}
          onOpen={openBroadcast}
          onClose={closeBroadcast}
        />
        <Participants participants={participants} you={you} />
      </div>

      <footer className="flex items-center justify-between gap-4 px-4 py-3">
        <p className="font-mono text-xs text-ink-muted">
          {footerLine(broadcast, signaling.connected, broadcasters.length)}
        </p>

        <div className="flex items-center gap-3">
          {broadcast.isBroadcasting && <LevelMeter track={broadcast.audioTrack} />}
          <Quality />
          <AudioSource />

          <button
            type="button"
            onClick={broadcast.toggle}
            className={[
              "rounded-lg px-4 py-2.5 text-sm font-semibold transition hover:brightness-110",
              broadcast.isBroadcasting ? "bg-red-500 text-white" : "bg-accent text-accent-ink",
            ].join(" ")}
          >
            {broadcast.isBroadcasting ? "⏹ Parar transmissão" : "🖥 Transmitir minha tela"}
          </button>
        </div>
      </footer>
    </div>
  )
}
