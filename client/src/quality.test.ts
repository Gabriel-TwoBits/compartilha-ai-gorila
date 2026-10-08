import { describe, expect, it } from "vitest"
import {
  CAMERA_PRESET,
  QUALITY_PRESETS,
  captureConstraints,
  currentQuality,
  gigabytesPerHour,
  presetById,
  selectQuality,
  sendEncodings,
} from "./quality"

/**
 * The ceiling is a cost decision, not a taste one: Cloudflare bills egress per
 * viewer against a free monthly quota, and 1080p60 or 1440p would spend it in a
 * couple of weekends. A preset added past this line costs real money, so the
 * list is pinned by a test rather than by a comment.
 */
const HIGHEST_ALLOWED_BITRATE = 5_000_000
const HIGHEST_ALLOWED_PIXELS = 1920 * 1080
const HIGHEST_ALLOWED_FRAMERATE = 60

describe("quality presets", () => {
  it("offers nothing above 1080p30 or 720p60", () => {
    for (const preset of QUALITY_PRESETS) {
      expect(preset.maxBitrate).toBeLessThanOrEqual(HIGHEST_ALLOWED_BITRATE)
      expect(preset.width * preset.height).toBeLessThanOrEqual(HIGHEST_ALLOWED_PIXELS)
      expect(preset.frameRate).toBeLessThanOrEqual(HIGHEST_ALLOWED_FRAMERATE)
    }
  })

  it("keeps the camera under half of the cheapest screen preset", () => {
    const cheapest = Math.min(...QUALITY_PRESETS.map((preset) => preset.maxBitrate))
    expect(CAMERA_PRESET.maxBitrate * 2).toBeLessThanOrEqual(cheapest)
  })

  it("never offers 1080p60 or anything at 1440p", () => {
    const forbidden = QUALITY_PRESETS.filter(
      (preset) => preset.height > 1080 || (preset.height === 1080 && preset.frameRate > 30),
    )
    expect(forbidden).toEqual([])
  })

  it("defaults to the cheapest preset", () => {
    const cheapest = [...QUALITY_PRESETS].sort((a, b) => a.maxBitrate - b.maxBitrate)[0]
    expect(currentQuality()).toBe(cheapest)
  })

  it("gives every preset a distinct id", () => {
    const ids = QUALITY_PRESETS.map((preset) => preset.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe("gigabytesPerHour", () => {
  // The figure the README quotes, and the one the picker shows beside each
  // option. A change here changes what the room is told its bill will be.
  it("costs a viewer about 1.1 GB/h at 2.5 Mbps", () => {
    const preset = presetById("720p30")
    expect(gigabytesPerHour(preset)).toBeCloseTo(1.125, 3)
  })

  it("grows with the bitrate", () => {
    const cheap = gigabytesPerHour(presetById("720p30"))
    const dear = gigabytesPerHour(presetById("1080p30"))
    expect(dear).toBeGreaterThan(cheap)
  })
})

describe("presetById", () => {
  it("finds a preset by its id", () => {
    expect(presetById("720p60").frameRate).toBe(60)
  })

  // A stale id must not take the broadcast down: an unusable preset is worse
  // than a cheap one.
  it("falls back to the default for an unknown id", () => {
    expect(presetById("4k120")).toBe(presetById("720p30"))
  })
})

describe("selectQuality", () => {
  it("changes what the capture and the encoder are built from", () => {
    selectQuality("1080p30")
    expect(currentQuality().id).toBe("1080p30")

    selectQuality("720p30")
    expect(currentQuality().id).toBe("720p30")
  })

  it("ignores an id nobody offers", () => {
    selectQuality("720p60")
    selectQuality("nonsense")
    expect(currentQuality().id).toBe("720p30")
  })
})

describe("constraints and encodings", () => {
  it("caps the capture at the preset's own numbers", () => {
    const preset = presetById("720p60")
    expect(captureConstraints(preset)).toEqual({
      width: { max: 1280 },
      height: { max: 720 },
      frameRate: { max: 60 },
    })
  })

  it("caps the encoder at the preset's bitrate and frame rate", () => {
    const preset = presetById("1080p30")
    expect(sendEncodings(preset)).toEqual([{ maxBitrate: 5_000_000, maxFramerate: 30 }])
  })
})
