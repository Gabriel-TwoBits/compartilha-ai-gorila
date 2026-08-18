import type { Participant } from "@shared/protocol"

const INITIALS_LENGTH = 2

function initials(nickname: string): string {
  return nickname.slice(0, INITIALS_LENGTH).toUpperCase()
}

type Props = {
  participants: Participant[]
  youId: string | null
  selectedId: string | null
  onSelect: (id: string) => void
}

export function Participants({ participants, youId, selectedId, onSelect }: Props) {
  return (
    <aside className="flex w-64 shrink-0 flex-col gap-1 border-l border-edge p-4">
      <h2 className="mb-3 text-xs font-medium tracking-widest text-ink-muted uppercase">
        Na sala — {participants.length}
      </h2>

      {participants.map((participant) => {
        const isBroadcasting = participant.broadcast !== null
        const isSelected = participant.id === selectedId

        return (
          <button
            key={participant.id}
            type="button"
            disabled={!isBroadcasting}
            onClick={() => onSelect(participant.id)}
            className={[
              "flex items-center gap-3 rounded-lg px-2 py-2 text-left transition",
              isBroadcasting ? "cursor-pointer hover:bg-surface-raised" : "cursor-default",
              isSelected ? "bg-surface-raised" : "",
            ].join(" ")}
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-sky-500/80 text-[0.65rem] font-bold text-white">
              {initials(participant.nickname)}
            </span>

            <span className="min-w-0 flex-1 truncate text-sm">
              {participant.nickname}
              {participant.id === youId && <span className="text-ink-muted"> (você)</span>}
            </span>

            {isBroadcasting && (
              <span
                title="transmitindo"
                aria-label="transmitindo"
                className="size-2 shrink-0 rounded-full bg-accent"
              />
            )}
          </button>
        )
      })}
    </aside>
  )
}
