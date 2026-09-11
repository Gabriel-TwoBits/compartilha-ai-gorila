import type { ChangeEvent } from "react"
import { useObservableAsValue } from "partytracks/react"
import { QUALITY_PRESETS, gigabytesPerHour, quality$, selectQuality } from "../quality"

const controlClassName =
  "rounded-md border border-edge bg-surface-raised px-2 py-1.5 text-xs text-ink transition hover:brightness-110"

/** One decimal is the honest precision for an estimate built on a bitrate ceiling. */
function formatCost(gigabytes: number): string {
  return gigabytes.toFixed(1).replace(".", ",")
}

/**
 * Picks the broadcast quality, with the price of each option beside it.
 *
 * The cost is not decoration. Cloudflare bills egress once per viewer, so a
 * preset costs its GB/h multiplied by everyone watching, against a free monthly
 * quota — and the person choosing is never the person who finds out. Showing the
 * number is what keeps the choice informed, and the reason the list stops at
 * 1080p30 instead of going where the hardware could.
 */
export function Quality() {
  const selected = useObservableAsValue(quality$, QUALITY_PRESETS[0])

  function handleChange(event: ChangeEvent<HTMLSelectElement>): void {
    selectQuality(event.target.value)
  }

  return (
    <label className="flex items-center gap-2 text-xs text-ink-muted">
      🎚
      <select
        value={selected?.id}
        onChange={handleChange}
        aria-label="qualidade da transmissão"
        title="Cada espectador puxa esse tanto por hora da cota da Cloudflare"
        className={controlClassName}
      >
        {QUALITY_PRESETS.map((preset) => (
          <option key={preset.id} value={preset.id}>
            {preset.label} · ~{formatCost(gigabytesPerHour(preset))} GB/h
          </option>
        ))}
      </select>
    </label>
  )
}
