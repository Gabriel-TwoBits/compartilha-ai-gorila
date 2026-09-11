import { useState } from "react"
import { playRoomSound, setSoundVolume, soundsEnabled } from "../sounds"

/** Restored when unmuting, so turning sound back on returns it to where it was. */
const DEFAULT_ON_VOLUME = 0.35

const buttonClassName =
  "rounded-md px-2 py-1 text-sm text-ink-muted transition hover:bg-surface-raised hover:text-ink"

/**
 * Mutes the room's notification sounds.
 *
 * Unmuting plays a cue on the spot. Browsers only let audio start after a user
 * gesture, so the click is both the permission and the proof that it worked —
 * without it the first real sound is also the first test of whether sound works
 * at all, and a silent failure is indistinguishable from a quiet room.
 */
export function SoundToggle() {
  const [enabled, setEnabled] = useState(soundsEnabled)

  function toggle(): void {
    const next = !enabled
    setSoundVolume(next ? DEFAULT_ON_VOLUME : 0)
    setEnabled(next)
    if (next) playRoomSound("arrived")
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={enabled}
      title={enabled ? "Desligar os avisos sonoros" : "Ligar os avisos sonoros"}
      className={buttonClassName}
    >
      {enabled ? "🔔" : "🔕"}
    </button>
  )
}
