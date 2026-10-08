import { BehaviorSubject, type Observable } from "rxjs"

/**
 * What the broadcaster sends, and what it costs everyone else.
 *
 * Cloudflare bills egress once per viewer, so the price of a preset multiplies
 * by the size of the room. That is the whole reason this list is short and
 * stops where it does: 1080p60 (9 Mbps) and 1440p60 (16 Mbps) would burn the
 * free monthly quota in a couple of weekends, so they are not offered at all.
 */
export type QualityPreset = {
  id: string
  label: string
  width: number
  height: number
  frameRate: number
  /**
   * Encoder ceiling, in bits per second.
   *
   * Capture constraints bound the picture, not the bitrate: a busy screen
   * pushes well past this if the encoder is left to decide on its own. This is
   * the number that actually bounds the bill.
   *
   * The values are measured for VP8 carrying game footage — heavy motion. Below
   * them the encoder cannot fit the ceiling and, since we ask it to keep the
   * frame rate, it pays by dropping resolution instead.
   */
  maxBitrate: number
}

/**
 * Gigabytes per hour one viewer pulls from Cloudflare, per Mbps of bitrate.
 * 1 Mbps for 3600 s is 450 MB, so a megabit costs each viewer ~0.45 GB/h.
 */
const GIGABYTES_PER_HOUR_PER_MBPS = 0.45

const BITS_PER_MEGABIT = 1_000_000

export const QUALITY_PRESETS: QualityPreset[] = [
  { id: "720p30", label: "720p 30fps", width: 1280, height: 720, frameRate: 30, maxBitrate: 2_500_000 },
  { id: "720p60", label: "720p 60fps", width: 1280, height: 720, frameRate: 60, maxBitrate: 4_500_000 },
  {
    id: "1080p30",
    label: "1080p 30fps",
    width: 1920,
    height: 1080,
    frameRate: 30,
    maxBitrate: 5_000_000,
  },
]

/**
 * The camera's fixed ceiling, with no picker of its own.
 *
 * A face needs far less than a game, and every viewer of a broadcast pulls the
 * camera on top of the screen: at 540p30 and 1 Mbps it adds under half of the
 * cheapest screen preset to the bill, where 720p would nearly double it.
 */
export const CAMERA_PRESET: QualityPreset = {
  id: "camera",
  label: "540p 30fps",
  width: 960,
  height: 540,
  frameRate: 30,
  maxBitrate: 1_000_000,
}

/**
 * The cheapest preset, and plenty for watching someone play. Raising it is one
 * click, and the estimate beside each option is what makes that an informed one.
 */
const DEFAULT_PRESET = QUALITY_PRESETS[0] as QualityPreset

/** What one viewer costs per hour on this preset, for the label beside it. */
export function gigabytesPerHour(preset: QualityPreset): number {
  return (preset.maxBitrate / BITS_PER_MEGABIT) * GIGABYTES_PER_HOUR_PER_MBPS
}

/** Falls back to the default rather than failing: an unknown id is not worth a crash. */
export function presetById(id: string): QualityPreset {
  return QUALITY_PRESETS.find((preset) => preset.id === id) ?? DEFAULT_PRESET
}

const selectedPreset = new BehaviorSubject<QualityPreset>(DEFAULT_PRESET)

export const quality$: Observable<QualityPreset> = selectedPreset.asObservable()

export function selectQuality(id: string): void {
  selectedPreset.next(presetById(id))
}

/** The current preset, for the capture constraints a fresh capture is built with. */
export function currentQuality(): QualityPreset {
  return selectedPreset.value
}

/** Capture ceiling handed to `getDisplayMedia`, which caps the source itself. */
export function captureConstraints(preset: QualityPreset): MediaTrackConstraints {
  return {
    width: { max: preset.width },
    height: { max: preset.height },
    frameRate: { max: preset.frameRate },
  }
}

/** Encoder ceiling handed to `PartyTracks.push`. */
export function sendEncodings(preset: QualityPreset): RTCRtpEncodingParameters[] {
  return [{ maxBitrate: preset.maxBitrate, maxFramerate: preset.frameRate }]
}
