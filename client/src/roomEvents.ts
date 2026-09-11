import type { Participant } from "@shared/protocol"

/**
 * What changed between two room snapshots, reduced to the handful of things
 * worth a sound.
 *
 * The server resends the whole room on every change, so "someone arrived" only
 * exists as the difference between two of those snapshots. Computing it here,
 * away from any audio API, is what makes the rules testable — and the rules are
 * where every mistake in this feature lives.
 */
export type RoomEvent = "arrived" | "left" | "broadcastStarted" | "broadcastStopped" | "viewerArrived" | "viewerLeft"

export type RoomSnapshot = {
  you: string
  participants: Participant[]
}

function nicknames(snapshot: RoomSnapshot): Set<string> {
  return new Set(snapshot.participants.map((participant) => participant.nickname))
}

function broadcasters(snapshot: RoomSnapshot): Set<string> {
  return new Set(
    snapshot.participants
      .filter((participant) => participant.broadcast !== null)
      .map((participant) => participant.nickname),
  )
}

function viewersOf(snapshot: RoomSnapshot, nickname: string): Set<string> {
  const self = snapshot.participants.find((participant) => participant.nickname === nickname)
  return new Set(self?.viewers ?? [])
}

/** True when `candidates` holds anything absent from `known`. */
function hasNewEntry(candidates: Set<string>, known: Set<string>): boolean {
  for (const candidate of candidates) {
    if (!known.has(candidate)) return true
  }
  return false
}

/**
 * The events between two snapshots, at most one per kind.
 *
 * Capping each kind is deliberate: five people arriving in the same tick is one
 * arrival sound, not five overlapping ones. `previous` being `null` is the first
 * snapshot after connecting, and yields nothing at all — walking into a room
 * that already has five people in it must not fire five sounds.
 *
 * Viewer events are reported only while we are broadcasting. Otherwise stopping
 * a broadcast — which empties our audience in one snapshot — would fire a
 * departure for every viewer at once.
 */
export function roomEvents(previous: RoomSnapshot | null, current: RoomSnapshot): RoomEvent[] {
  if (previous === null) return []

  const events: RoomEvent[] = []

  const before = nicknames(previous)
  const now = nicknames(current)
  if (hasNewEntry(now, before)) events.push("arrived")
  if (hasNewEntry(before, now)) events.push("left")

  const broadcastingBefore = broadcasters(previous)
  const broadcastingNow = broadcasters(current)
  if (hasNewEntry(broadcastingNow, broadcastingBefore)) events.push("broadcastStarted")
  if (hasNewEntry(broadcastingBefore, broadcastingNow)) events.push("broadcastStopped")

  // Our own audience, and only while there is one to have. `current.you` rather
  // than `previous.you`: the nickname is the identity and cannot change under a
  // live session, but the newer snapshot is the one being described.
  const weAreLive = broadcastingNow.has(current.you)
  if (weAreLive && broadcastingBefore.has(previous.you)) {
    const viewersBefore = viewersOf(previous, previous.you)
    const viewersNow = viewersOf(current, current.you)
    if (hasNewEntry(viewersNow, viewersBefore)) events.push("viewerArrived")
    if (hasNewEntry(viewersBefore, viewersNow)) events.push("viewerLeft")
  }

  return events
}
