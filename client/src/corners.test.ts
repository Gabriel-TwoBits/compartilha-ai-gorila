import { describe, expect, it } from "vitest"
import {
  CORNERS,
  DEFAULT_CORNER,
  OVERLAY_WIDTH_PERCENT,
  clampOverlayWidth,
  handleCorner,
  movedEnough,
  nearestCorner,
  parseCorner,
  parseOverlayWidth,
} from "./corners"

const tile = { left: 100, top: 50, width: 800, height: 400 }

describe("nearestCorner", () => {
  it("picks the quadrant the centre falls in", () => {
    expect(nearestCorner({ x: 150, y: 80 }, tile)).toBe("top-left")
    expect(nearestCorner({ x: 850, y: 80 }, tile)).toBe("top-right")
    expect(nearestCorner({ x: 150, y: 420 }, tile)).toBe("bottom-left")
    expect(nearestCorner({ x: 850, y: 420 }, tile)).toBe("bottom-right")
  })

  it("never answers anything but a corner, even dead centre or outside the tile", () => {
    const points = [
      { x: 500, y: 250 },
      { x: -1000, y: -1000 },
      { x: 5000, y: 5000 },
      { x: 500, y: -50 },
    ]
    for (const point of points) {
      expect(CORNERS).toContain(nearestCorner(point, tile))
    }
  })
})

describe("movedEnough", () => {
  it("treats a trembling click as a click", () => {
    expect(movedEnough(0, 0)).toBe(false)
    expect(movedEnough(3, -4)).toBe(false)
  })

  it("treats real movement on either axis as a drag", () => {
    expect(movedEnough(5, 0)).toBe(true)
    expect(movedEnough(0, -5)).toBe(true)
  })
})

describe("clampOverlayWidth", () => {
  it("keeps the width between the bounds", () => {
    expect(clampOverlayWidth(1)).toBe(OVERLAY_WIDTH_PERCENT.min)
    expect(clampOverlayWidth(99)).toBe(OVERLAY_WIDTH_PERCENT.max)
    expect(clampOverlayWidth(30.4)).toBe(30)
  })

  it("falls back to the initial width for anything that is not a number", () => {
    expect(clampOverlayWidth(Number.NaN)).toBe(OVERLAY_WIDTH_PERCENT.initial)
    expect(clampOverlayWidth(Number.POSITIVE_INFINITY)).toBe(OVERLAY_WIDTH_PERCENT.initial)
  })
})

describe("parseOverlayWidth", () => {
  it("starts at the initial width when nothing was stored", () => {
    expect(parseOverlayWidth(null)).toBe(OVERLAY_WIDTH_PERCENT.initial)
    expect(parseOverlayWidth("")).toBe(OVERLAY_WIDTH_PERCENT.initial)
  })

  it("keeps a stored width within the bounds", () => {
    expect(parseOverlayWidth("30")).toBe(30)
    expect(parseOverlayWidth("0")).toBe(OVERLAY_WIDTH_PERCENT.min)
    expect(parseOverlayWidth("junk")).toBe(OVERLAY_WIDTH_PERCENT.initial)
  })
})

describe("handleCorner", () => {
  it("faces the middle of the tile from every corner", () => {
    expect(handleCorner("bottom-right")).toBe("top-left")
    expect(handleCorner("bottom-left")).toBe("top-right")
    expect(handleCorner("top-right")).toBe("bottom-left")
    expect(handleCorner("top-left")).toBe("bottom-right")
  })
})

describe("parseCorner", () => {
  it("accepts every known corner", () => {
    for (const corner of CORNERS) {
      expect(parseCorner(corner)).toBe(corner)
    }
  })

  it("falls back to the default for anything else", () => {
    expect(parseCorner(null)).toBe(DEFAULT_CORNER)
    expect(parseCorner("middle")).toBe(DEFAULT_CORNER)
    expect(parseCorner("")).toBe(DEFAULT_CORNER)
  })
})
