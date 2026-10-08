import { describe, expect, it } from "vitest"
import { MAX_NICKNAME_LENGTH, normalizeNickname, parseClientMessage, parseServerMessage } from "./protocol"

const screenRef = { sessionId: "session-a", trackName: "screen-video" }
const cameraRef = { sessionId: "session-a", trackName: "camera-video" }
const audioRef = { sessionId: "session-a", trackName: "screen-audio" }

describe("parseClientMessage", () => {
  it("accepts a broadcast with screen, camera and audio", () => {
    const raw = JSON.stringify({
      type: "broadcast-start",
      screen: screenRef,
      camera: cameraRef,
      audio: audioRef,
    })
    expect(parseClientMessage(raw)).toEqual({
      type: "broadcast-start",
      screen: screenRef,
      camera: cameraRef,
      audio: audioRef,
    })
  })

  it("treats a missing address the same as a null one", () => {
    const withNull = JSON.stringify({
      type: "broadcast-start",
      screen: screenRef,
      camera: null,
      audio: null,
    })
    const withoutKey = JSON.stringify({ type: "broadcast-start", screen: screenRef })
    const expected = { type: "broadcast-start", screen: screenRef, camera: null, audio: null }

    expect(parseClientMessage(withNull)).toEqual(expected)
    expect(parseClientMessage(withoutKey)).toEqual(expected)
  })

  it("accepts a broadcast of the camera alone", () => {
    const raw = JSON.stringify({ type: "broadcast-start", camera: cameraRef, audio: audioRef })
    expect(parseClientMessage(raw)).toEqual({
      type: "broadcast-start",
      screen: null,
      camera: cameraRef,
      audio: audioRef,
    })
  })

  it("drops a broadcast with nothing to watch", () => {
    const cases = [
      { type: "broadcast-start" },
      { type: "broadcast-start", screen: null, camera: null },
      { type: "broadcast-start", audio: audioRef },
    ]

    for (const value of cases) {
      expect(parseClientMessage(JSON.stringify(value)), JSON.stringify(value)).toBeNull()
    }
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

  it("drops a broadcast with any malformed address rather than treating it as absent", () => {
    const malformed = [
      {},
      { sessionId: "session-a" },
      { sessionId: "", trackName: "screen-video" },
      { sessionId: 1, trackName: "screen-video" },
    ]

    for (const bad of malformed) {
      const cases = [
        { type: "broadcast-start", screen: bad, camera: cameraRef },
        { type: "broadcast-start", screen: screenRef, camera: bad },
        { type: "broadcast-start", screen: screenRef, audio: bad },
      ]
      for (const value of cases) {
        expect(parseClientMessage(JSON.stringify(value)), JSON.stringify(value)).toBeNull()
      }
    }
  })

  it("accepts a watch report naming several broadcasters", () => {
    const raw = JSON.stringify({ type: "watching", nicknames: ["carlinhos", "mariazinha"] })
    expect(parseClientMessage(raw)).toEqual({
      type: "watching",
      nicknames: ["carlinhos", "mariazinha"],
    })
  })

  it("accepts a watch report naming nobody", () => {
    const expected = { type: "watching", nicknames: [] }
    expect(parseClientMessage(JSON.stringify({ type: "watching", nicknames: [] }))).toEqual(expected)
    expect(parseClientMessage(JSON.stringify({ type: "watching", nicknames: null }))).toEqual(expected)
    expect(parseClientMessage(JSON.stringify({ type: "watching" }))).toEqual(expected)
  })

  it("drops a watch report whose list holds anything but names", () => {
    expect(parseClientMessage(JSON.stringify({ type: "watching", nicknames: [""] }))).toBeNull()
    expect(parseClientMessage(JSON.stringify({ type: "watching", nicknames: [7] }))).toBeNull()
    expect(parseClientMessage(JSON.stringify({ type: "watching", nicknames: [null] }))).toBeNull()
    expect(parseClientMessage(JSON.stringify({ type: "watching", nicknames: ["ok", 7] }))).toBeNull()
  })

  it("drops a watch report whose list is not a list", () => {
    expect(parseClientMessage(JSON.stringify({ type: "watching", nicknames: "carlinhos" }))).toBeNull()
    expect(parseClientMessage(JSON.stringify({ type: "watching", nicknames: {} }))).toBeNull()
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
