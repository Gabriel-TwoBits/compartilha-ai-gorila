import type { RoomEvent } from "./roomEvents"

/**
 * The room's notification sounds, synthesized rather than played from files.
 *
 * Two reasons to generate them. The bundle carries no audio assets, and the
 * shape of each cue stays adjustable — a pair of frequencies and a duration,
 * rather than something recorded once and never revisited.
 *
 * The person these are for is usually looking at a game, not at the room.
 */

const SAMPLE_ATTACK_SECONDS = 0.012
const RELEASE_SECONDS = 0.09

/** The stored preference, and the fallback when storage is unavailable. */
const STORAGE_KEY = "cag:sounds"
const DEFAULT_VOLUME = 0.35

type Cue = {
  /** Rising for an arrival, falling for a departure. */
  from: number
  to: number
  seconds: number
  /**
   * Relative loudness.
   *
   * Broadcasts start and stop are the cues that have to reach someone with
   * their back turned, so they sit well above the rest. A viewer opening or
   * closing a stream happens constantly in a busy room and is nearly a whisper.
   */
  gain: number
}

const CUES: Record<RoomEvent, Cue> = {
  arrived: { from: 520, to: 780, seconds: 0.16, gain: 1 },
  left: { from: 780, to: 520, seconds: 0.16, gain: 1 },
  broadcastStarted: { from: 440, to: 880, seconds: 0.22, gain: 1.8 },
  broadcastStopped: { from: 880, to: 440, seconds: 0.22, gain: 1.8 },
  viewerArrived: { from: 900, to: 1150, seconds: 0.1, gain: 0.55 },
  viewerLeft: { from: 1150, to: 900, seconds: 0.1, gain: 0.55 },
}

/**
 * One context for the whole page, created on the first sound.
 *
 * Browsers refuse to start an AudioContext before the first user gesture, and
 * one created too early lands in `suspended` and stays there — silence with
 * nothing in the console. Building it lazily means the first sound comes after
 * someone has typed a password and clicked a button.
 */
let context: AudioContext | null = null

function audioContext(): AudioContext | null {
  if (context !== null) return context
  try {
    context = new AudioContext()
    return context
  } catch {
    // An environment without Web Audio loses the cues and keeps the room.
    return null
  }
}

function readStoredVolume(): number {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored === null) return DEFAULT_VOLUME
    const parsed = Number(stored)
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) return DEFAULT_VOLUME
    return parsed
  } catch {
    // Private windows and blocked site data throw on access rather than
    // returning null.
    return DEFAULT_VOLUME
  }
}

let volume = readStoredVolume()

export function soundVolume(): number {
  return volume
}

export function setSoundVolume(next: number): void {
  volume = Math.min(Math.max(next, 0), 1)
  try {
    window.localStorage.setItem(STORAGE_KEY, String(volume))
  } catch {
    // The preference not surviving a reload is not worth failing over.
  }
}

export function soundsEnabled(): boolean {
  return volume > 0
}

/**
 * Plays one cue. Silent when muted, and never throws: a failed sound must not
 * take down whatever was rendering the room.
 */
export function playRoomSound(event: RoomEvent): void {
  if (volume === 0) return

  const ctx = audioContext()
  if (ctx === null) return

  // A context built before the first gesture, or suspended when the tab went to
  // the background, resumes here rather than failing silently.
  if (ctx.state === "suspended") void ctx.resume().catch(() => undefined)

  const cue = CUES[event]
  const start = ctx.currentTime
  const end = start + cue.seconds

  const oscillator = ctx.createOscillator()
  oscillator.type = "sine"
  oscillator.frequency.setValueAtTime(cue.from, start)
  oscillator.frequency.exponentialRampToValueAtTime(cue.to, end)

  // Without the attack the waveform starts at full amplitude and the speaker
  // clicks; the same at the tail. Both ramps are why this is an envelope rather
  // than a bare gain.
  const envelope = ctx.createGain()
  const peak = Math.min(volume * cue.gain, 1)
  envelope.gain.setValueAtTime(0, start)
  envelope.gain.linearRampToValueAtTime(peak, start + SAMPLE_ATTACK_SECONDS)
  envelope.gain.setValueAtTime(peak, Math.max(end - RELEASE_SECONDS, start + SAMPLE_ATTACK_SECONDS))
  envelope.gain.linearRampToValueAtTime(0, end)

  oscillator.connect(envelope)
  envelope.connect(ctx.destination)
  oscillator.start(start)
  oscillator.stop(end)
  oscillator.addEventListener("ended", () => {
    oscillator.disconnect()
    envelope.disconnect()
  })
}
