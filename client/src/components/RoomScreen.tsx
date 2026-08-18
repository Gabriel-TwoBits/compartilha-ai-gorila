import { useEffect, useState } from "react"
import type { Participant } from "@shared/protocol"
import { logout } from "../api"
import { useBroadcast } from "../useBroadcast"
import { useSignaling } from "../useSignaling"
import { Participants } from "./Participants"
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

export function RoomScreen({ nickname, onLogout }: Props) {
  const signaling = useSignaling()
  const broadcast = useBroadcast(signaling)

  /** Only records an explicit pick; the fallback is derived below. */
  const [pickedNickname, setPickedNickname] = useState<string | null>(null)

  const participants: Participant[] = signaling.room?.participants ?? []
  const you = signaling.room?.you ?? null
  const broadcasters = participants.filter((participant) => participant.broadcast !== null)

  // Deriving rather than syncing with an effect: whoever was picked may have
  // stopped, in which case the first live broadcast takes over on its own.
  const selected =
    broadcasters.find((participant) => participant.nickname === pickedNickname) ??
    broadcasters[0] ??
    null

  // Feeds the viewer counts everyone else sees. Keyed on the nickname rather
  // than the participant object, which arrives fresh from JSON every snapshot.
  const selectedNickname = selected?.nickname ?? null
  const { send } = signaling
  useEffect(() => {
    send({ type: "watching", nickname: selectedNickname })
  }, [send, selectedNickname, signaling.connected])

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
        <Stage selected={selected} you={you} />
        <Participants
          participants={participants}
          you={you}
          selectedNickname={selectedNickname}
          onSelect={setPickedNickname}
        />
      </div>

      <footer className="flex items-center justify-between gap-4 px-4 py-3">
        <p className="font-mono text-xs text-ink-muted">
          {broadcast.error ?? statusLine(signaling.connected, broadcasters.length)}
        </p>

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
      </footer>
    </div>
  )
}
