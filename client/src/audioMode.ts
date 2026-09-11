import { BehaviorSubject, type Observable } from "rxjs"
import { type AudioMode, desktopBridge } from "./desktop"

/**
 * Which applications the broadcast carries, inside the desktop app.
 *
 * Held here rather than in the panel's own state so that starting a broadcast
 * can wire the audio without the panel having ever been opened. Left to the
 * component, the default would be a label and nothing else: the room would go
 * out silent, and the only sign would be a friend saying they hear nothing.
 */

/**
 * What a broadcast carries when nobody has said otherwise.
 *
 * Everything on the list, which is everything making sound except Discord and
 * ourselves — the list never contains those. It is the right answer without
 * being told anything, because it picks up applications opened later: a game
 * started mid-broadcast is audible without anybody going back to tick it.
 *
 * The exception is a Windows too old for process loopback. Neither
 * per-application mode works there, so the honest default is the whole device —
 * the same thing the browser offers, Discord and all. Deciding it here rather
 * than in the panel is what makes it hold for a broadcast started without the
 * panel ever being opened.
 */
function defaultMode(): AudioMode {
  const bridge = desktopBridge()
  if (bridge !== null && !bridge.canCapturePerProcess) return { kind: "system" }
  return { kind: "everything" }
}

const selected = new BehaviorSubject<AudioMode>(defaultMode())

export const audioMode$: Observable<AudioMode> = selected.asObservable()

export function currentAudioMode(): AudioMode {
  return selected.value
}

export function selectAudioMode(mode: AudioMode): void {
  selected.next(mode)
}
