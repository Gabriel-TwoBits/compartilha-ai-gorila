import { BehaviorSubject, type Observable } from "rxjs"
import type { AudioMode } from "./desktop"

/**
 * Which applications the broadcast carries, inside the desktop app.
 *
 * Held here rather than in the panel's own state so that starting a broadcast
 * can wire the audio without the panel having ever been opened. Left to the
 * component, the default would be a label and nothing else: the room would go
 * out silent, and the only sign would be a friend saying they hear nothing.
 */

/**
 * Everything on the list, which is everything making sound except Discord and
 * ourselves — the list never contains those.
 *
 * The default because it is the one that is right without being told anything:
 * it picks up applications opened later, so a game started after the broadcast
 * is audible without anybody going back to tick it.
 */
const DEFAULT_MODE: AudioMode = { kind: "everything" }

const selected = new BehaviorSubject<AudioMode>(DEFAULT_MODE)

export const audioMode$: Observable<AudioMode> = selected.asObservable()

export function currentAudioMode(): AudioMode {
  return selected.value
}

export function selectAudioMode(mode: AudioMode): void {
  selected.next(mode)
}
