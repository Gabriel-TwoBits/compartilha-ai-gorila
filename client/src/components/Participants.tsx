import type { Participant } from "@shared/protocol"

const INITIALS_LENGTH = 2

function initials(nickname: string): string {
  return nickname.slice(0, INITIALS_LENGTH).toUpperCase()
}

function viewerLabel(count: number): string {
  if (count === 1) return "1 assistindo"
  return `${count} assistindo`
}

type Props = {
  participants: Participant[]
  you: string | null
}

/** Presence only: opening and closing a broadcast happens on the stage tiles. */
export function Participants({ participants, you }: Props) {
  return (
    <aside className="flex max-h-40 shrink-0 flex-col gap-1 overflow-y-auto border-t border-edge p-4 md:max-h-none md:w-64 md:border-t-0 md:border-l">
      <h2 className="mb-3 text-xs font-medium tracking-widest text-ink-muted uppercase">
        Na sala — {participants.length}
      </h2>

      {participants.map((participant) => {
        const isBroadcasting = participant.broadcast !== null

        return (
          <div
            key={participant.nickname}
            className="flex items-center gap-3 rounded-lg px-2 py-2 text-left"
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-sky-500/80 text-[0.65rem] font-bold text-white">
              {initials(participant.nickname)}
            </span>

            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">
                {participant.nickname}
                {participant.nickname === you && <span className="text-ink-muted"> (você)</span>}
              </span>

              {isBroadcasting && participant.viewers.length > 0 && (
                <span
                  title={participant.viewers.join(", ")}
                  className="block truncate text-[0.7rem] text-ink-muted"
                >
                  {viewerLabel(participant.viewers.length)}
                </span>
              )}
            </span>

            {isBroadcasting && (
              <span
                title="transmitindo"
                aria-label="transmitindo"
                className="size-2 shrink-0 rounded-full bg-accent"
              />
            )}
          </div>
        )
      })}
    </aside>
  )
}
