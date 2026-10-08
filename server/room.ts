import type { Broadcast, Participant, TrackRef } from "@shared/protocol"

/**
 * The single room, held in memory, keyed by nickname.
 *
 * There is no persistence on purpose: a room with nobody in it carries no state
 * worth keeping, and a restart of the server invalidates every SFU track anyway.
 *
 * A participant can hold several connections at once — a second tab, or the old
 * socket of a reconnect that has not timed out yet. They only leave the room
 * when the last one goes.
 */

type Entry = {
  nickname: string
  /** Connection ids currently held by this participant. */
  connections: Set<string>
  broadcast: Broadcast | null
  /** Which connection published the broadcast, so only it can retract it. */
  broadcastOwner: string | null
  /** Whose broadcasts this participant currently has open. */
  watching: Set<string>
}

const participants = new Map<string, Entry>()

function entryFor(nickname: string): Entry {
  const existing = participants.get(nickname)
  if (existing !== undefined) return existing

  const created: Entry = {
    nickname,
    connections: new Set(),
    broadcast: null,
    broadcastOwner: null,
    watching: new Set(),
  }
  participants.set(nickname, created)
  return created
}

export function join(connectionId: string, nickname: string): void {
  entryFor(nickname).connections.add(connectionId)
}

export function leave(connectionId: string, nickname: string): void {
  const entry = participants.get(nickname)
  if (entry === undefined) return

  entry.connections.delete(connectionId)

  // The broadcast belongs to the connection that published it. A second tab
  // closing must not take down the tab that is actually sharing a screen.
  if (entry.broadcastOwner === connectionId) {
    entry.broadcast = null
    entry.broadcastOwner = null
  }

  if (entry.connections.size === 0) {
    participants.delete(nickname)
  }
}

/**
 * Records a broadcast, or its update when the camera or the screen turns on or
 * off mid-broadcast. A participant broadcasting from a second connection
 * replaces the first, matching what a viewer would see anyway: one broadcast
 * per person.
 */
export function startBroadcast(connectionId: string, nickname: string, broadcast: Broadcast): void {
  const entry = participants.get(nickname)
  if (entry === undefined) return
  if (!entry.connections.has(connectionId)) return

  entry.broadcast = broadcast
  entry.broadcastOwner = connectionId
}

export function stopBroadcast(connectionId: string, nickname: string): void {
  const entry = participants.get(nickname)
  if (entry === undefined) return
  if (entry.broadcastOwner !== connectionId) return

  entry.broadcast = null
  entry.broadcastOwner = null
}

/** Records whose broadcasts a participant is showing, for the viewer counts. */
export function setWatching(nickname: string, watching: string[]): void {
  const entry = participants.get(nickname)
  if (entry === undefined) return
  entry.watching = new Set(watching)
}

function copyTrackRef(ref: TrackRef | null): TrackRef | null {
  if (ref === null) return null
  return { ...ref }
}

function copyBroadcast(broadcast: Broadcast | null): Broadcast | null {
  if (broadcast === null) return null
  return {
    screen: copyTrackRef(broadcast.screen),
    camera: copyTrackRef(broadcast.camera),
    audio: copyTrackRef(broadcast.audio),
  }
}

/**
 * Viewers per broadcaster, built in one pass. Watching your own screen shows the
 * local capture rather than a pull from the SFU, so it is not an audience.
 */
function viewersByBroadcaster(): Map<string, string[]> {
  const viewers = new Map<string, string[]>()

  for (const entry of participants.values()) {
    for (const broadcaster of entry.watching) {
      if (broadcaster === entry.nickname) continue

      const existing = viewers.get(broadcaster)
      if (existing === undefined) {
        viewers.set(broadcaster, [entry.nickname])
        continue
      }
      existing.push(entry.nickname)
    }
  }

  return viewers
}

/** Deep copy, so callers cannot mutate the room by holding on to the snapshot. */
export function snapshot(): Participant[] {
  const viewers = viewersByBroadcaster()

  return [...participants.values()].map((entry) => ({
    nickname: entry.nickname,
    broadcast: copyBroadcast(entry.broadcast),
    viewers: viewers.get(entry.nickname) ?? [],
  }))
}

/** Test seam: the room is module state, and tests need a clean one per case. */
export function reset(): void {
  participants.clear()
}
