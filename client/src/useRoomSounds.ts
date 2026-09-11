import { useEffect, useRef } from "react"
import { type RoomSnapshot, roomEvents } from "./roomEvents"
import { playRoomSound } from "./sounds"

/**
 * Turns each new room snapshot into the sounds for what changed since the last.
 *
 * The previous snapshot lives in a ref rather than in state: comparing two
 * renders is the whole job, and storing it in state would schedule a render of
 * its own for every message the socket delivers.
 *
 * A dropped socket clears the room, and the reconnect delivers a fresh first
 * snapshot. Resetting the reference on the way down is what stops that from
 * sounding like everyone leaving and then arriving again.
 */
export function useRoomSounds(room: RoomSnapshot | null): void {
  const previous = useRef<RoomSnapshot | null>(null)

  useEffect(() => {
    if (room === null) {
      previous.current = null
      return
    }

    for (const event of roomEvents(previous.current, room)) {
      playRoomSound(event)
    }
    previous.current = room
  }, [room])
}
