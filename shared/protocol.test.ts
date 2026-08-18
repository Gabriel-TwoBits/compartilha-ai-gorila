import { describe, expect, it } from "vitest"
import { MAX_NICKNAME_LENGTH, normalizeNickname, parseClientMessage, parseServerMessage } from "./protocol"

const videoRef = { sessionId: "session-a", trackName: "screen-video" }
const audioRef = { sessionId: "session-a", trackName: "screen-audio" }

describe("parseClientMessage", () => {
  it("accepts a broadcast with audio", () => {
    const raw = JSON.stringify({ type: "broadcast-start", video: videoRef, audio: audioRef })
    expect(parseClientMessage(raw)).toEqual({
      type: "broadcast-start",
      video: videoRef,
      audio: audioRef,
    })
  })

  it("accepts a broadcast without audio", () => {
    const withNull = JSON.stringify({ type: "broadcast-start", video: videoRef, audio: null })
    const withoutKey = JSON.stringify({ type: "broadcast-start", video: videoRef })
    const expected = { type: "broadcast-start", video: videoRef, audio: null }

    expect(parseClientMessage(withNull)).toEqual(expected)
    expect(parseClientMessage(withoutKey)).toEqual(expected)
  })

  it("accepts a stop", () => {
    expect(parseClientMessage(JSON.stringify({ type: "broadcast-stop" }))).toEqual({
      type: "broadcast-stop",
    })
  })

  it("drops anything that is not valid JSON", () => {
    expect(parseClientMessage("")).toBeNull()
    expect(parseClientMessage("not json")).toBeNull()
    expect(parseClientMessage("[1,2,3]")).toBeNull()
    expect(parseClientMessage("null")).toBeNull()
  })

  it("drops unknown message types", () => {
    expect(parseClientMessage(JSON.stringify({ type: "drop-tables" }))).toBeNull()
    expect(parseClientMessage(JSON.stringify({}))).toBeNull()
  })

  it("drops a broadcast whose video address is incomplete", () => {
    const cases = [
      { type: "broadcast-start" },
      { type: "broadcast-start", video: {} },
      { type: "broadcast-start", video: { sessionId: "session-a" } },
      { type: "broadcast-start", video: { sessionId: "", trackName: "screen-video" } },
      { type: "broadcast-start", video: { sessionId: 1, trackName: "screen-video" } },
    ]

    for (const value of cases) {
      expect(parseClientMessage(JSON.stringify(value)), JSON.stringify(value)).toBeNull()
    }
  })

  it("drops a broadcast whose audio address is malformed rather than treating it as absent", () => {
    const raw = JSON.stringify({ type: "broadcast-start", video: videoRef, audio: { sessionId: "x" } })
    expect(parseClientMessage(raw)).toBeNull()
  })
})

describe("parseServerMessage", () => {
  it("accepts a room snapshot", () => {
    const raw = JSON.stringify({ type: "state", you: "a", participants: [] })
    expect(parseServerMessage(raw)).toEqual({ type: "state", you: "a", participants: [] })
  })

  it("drops malformed snapshots", () => {
    expect(parseServerMessage("{")).toBeNull()
    expect(parseServerMessage(JSON.stringify({ type: "state", you: "a" }))).toBeNull()
    expect(parseServerMessage(JSON.stringify({ type: "state", participants: [] }))).toBeNull()
    expect(parseServerMessage(JSON.stringify({ type: "other", you: "a", participants: [] }))).toBeNull()
  })
})

describe("normalizeNickname", () => {
  it("keeps spaces and accents", () => {
    expect(normalizeNickname("João da Silva")).toBe("João da Silva")
  })

  it("trims surrounding whitespace", () => {
    expect(normalizeNickname("  carlinhos  ")).toBe("carlinhos")
  })

  it("strips control characters", () => {
    expect(normalizeNickname("car\u0000lin\u001Fhos\u007F")).toBe("carlinhos")
  })

  it("truncates to the maximum length", () => {
    const nickname = normalizeNickname("x".repeat(MAX_NICKNAME_LENGTH + 10))
    expect(nickname).toHaveLength(MAX_NICKNAME_LENGTH)
  })

  it("rejects anything that leaves nothing usable", () => {
    expect(normalizeNickname("")).toBeNull()
    expect(normalizeNickname("   ")).toBeNull()
    expect(normalizeNickname("\u0000")).toBeNull()
    expect(normalizeNickname(42)).toBeNull()
    expect(normalizeNickname(null)).toBeNull()
  })
})
