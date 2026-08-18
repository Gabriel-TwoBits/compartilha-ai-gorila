import type { Broadcast, Participant } from "@shared/protocol"

/**
 * The single room, held in memory.
 *
 * There is no persistence on purpose: a room with nobody in it carries no state
 * worth keeping, and a restart of the server invalidates every SFU track anyway.
 */

type Entry = {
  id: string
  nickname: string
  broadcast: Broadcast | null
}

const participants = new Map<string, Entry>()

export function join(id: string, nickname: string): void {
  participants.set(id, { id, nickname, broadcast: null })
}

export function leave(id: string): void {
  participants.delete(id)
}

/**
 * Records that a participant started broadcasting. A participant that vanished
 * between the message being sent and handled is ignored rather than resurrected.
 */
export function startBroadcast(id: string, broadcast: Broadcast): void {
  const entry = participants.get(id)
  if (entry === undefined) return
  entry.broadcast = broadcast
}

export function stopBroadcast(id: string): void {
  const entry = participants.get(id)
  if (entry === undefined) return
  entry.broadcast = null
}

function copyBroadcast(broadcast: Broadcast | null): Broadcast | null {
  if (broadcast === null) return null
  if (broadcast.audio === null) {
    return { video: { ...broadcast.video }, audio: null }
  }
  return { video: { ...broadcast.video }, audio: { ...broadcast.audio } }
}

/** Deep copy, so callers cannot mutate the room by holding on to the snapshot. */
export function snapshot(): Participant[] {
  return [...participants.values()].map((entry) => ({
    id: entry.id,
    nickname: entry.nickname,
    broadcast: copyBroadcast(entry.broadcast),
  }))
}

/** Test seam: the room is module state, and tests need a clean one per case. */
export function reset(): void {
  participants.clear()
}
