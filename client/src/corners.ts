/**
 * Where the camera overlay settles when it is let go.
 *
 * Kept apart from the component so the rules can be tested: the overlay NEVER
 * rests in the middle, where it would cover exactly what is being shown and
 * nobody would know where to find it next time.
 */

export const CORNERS = ["bottom-right", "bottom-left", "top-right", "top-left"] as const

export type Corner = (typeof CORNERS)[number]

export const DEFAULT_CORNER: Corner = "bottom-right"

type Point = { x: number; y: number }
type Area = { left: number; top: number; width: number; height: number }

/**
 * The corner nearest to where the overlay was dropped.
 *
 * Decided per axis from the overlay's CENTRE rather than from the pointer: a
 * hand drags by some point on it, and what the eye judges is the whole box.
 */
export function nearestCorner(center: Point, area: Area): Corner {
  const top = center.y < area.top + area.height / 2
  const left = center.x < area.left + area.width / 2
  if (top && left) return "top-left"
  if (top) return "top-right"
  if (left) return "bottom-left"
  return "bottom-right"
}

/** Slack for a trembling hand, so a click is not mistaken for a drag. */
const DRAG_THRESHOLD_PX = 4

/**
 * A short drag is a click. Both gestures live on the same element — dragging
 * moves the overlay, clicking swaps it with the background — and movement is
 * the only thing telling them apart.
 */
export function movedEnough(dx: number, dy: number): boolean {
  return Math.abs(dx) > DRAG_THRESHOLD_PX || Math.abs(dy) > DRAG_THRESHOLD_PX
}

/**
 * The overlay's width, as a percentage of the tile's.
 *
 * Below the minimum a face is no longer recognisable; above the maximum it
 * stops being an overlay and becomes the broadcast — which is what the click
 * that swaps the two is for.
 */
export const OVERLAY_WIDTH_PERCENT = { min: 12, max: 45, initial: 26 } as const

export function clampOverlayWidth(percent: number): number {
  if (!Number.isFinite(percent)) return OVERLAY_WIDTH_PERCENT.initial
  return Math.min(OVERLAY_WIDTH_PERCENT.max, Math.max(OVERLAY_WIDTH_PERCENT.min, Math.round(percent)))
}

/**
 * A stored width, or the initial one when nothing usable was stored. The null
 * check matters: `Number(null)` is 0, which would clamp a first visit down to
 * the smallest overlay.
 */
export function parseOverlayWidth(value: string | null): number {
  if (value === null || value.trim() === "") return OVERLAY_WIDTH_PERCENT.initial
  return clampOverlayWidth(Number(value))
}

/**
 * The corner of the overlay holding the resize handle: always the one facing
 * the middle of the tile, or pulling it would drag the overlay off screen.
 */
export function handleCorner(corner: Corner): Corner {
  switch (corner) {
    case "bottom-right":
      return "top-left"
    case "bottom-left":
      return "top-right"
    case "top-right":
      return "bottom-left"
    case "top-left":
      return "bottom-right"
    default:
      return corner satisfies never
  }
}

/** Anything that is not a known corner — a stale or tampered preference — is the default. */
export function parseCorner(value: string | null): Corner {
  const known = CORNERS.find((corner) => corner === value)
  return known ?? DEFAULT_CORNER
}
