import { beforeEach, describe, expect, it } from "vitest"
import type { Broadcast } from "@shared/protocol"
import { join, leave, reset, snapshot, startBroadcast, stopBroadcast } from "./room"

const broadcast: Broadcast = {
  video: { sessionId: "session-a", trackName: "screen-video" },
  audio: { sessionId: "session-a", trackName: "screen-audio" },
}

beforeEach(() => {
  reset()
})

describe("room", () => {
  it("starts empty", () => {
    expect(snapshot()).toEqual([])
  })

  it("lists participants in join order, not broadcasting", () => {
    join("a", "carlinhos")
    join("b", "mariazinha")

    expect(snapshot()).toEqual([
      { id: "a", nickname: "carlinhos", broadcast: null },
      { id: "b", nickname: "mariazinha", broadcast: null },
    ])
  })

  it("records and clears a broadcast", () => {
    join("a", "carlinhos")

    startBroadcast("a", broadcast)
    expect(snapshot()[0]?.broadcast).toEqual(broadcast)

    stopBroadcast("a")
    expect(snapshot()[0]?.broadcast).toBeNull()
  })

  it("accepts a broadcast without audio", () => {
    join("a", "carlinhos")
    startBroadcast("a", { video: broadcast.video, audio: null })

    expect(snapshot()[0]?.broadcast).toEqual({ video: broadcast.video, audio: null })
  })

  it("drops the broadcast when the broadcaster leaves", () => {
    join("a", "carlinhos")
    join("b", "mariazinha")
    startBroadcast("a", broadcast)

    leave("a")

    expect(snapshot()).toEqual([{ id: "b", nickname: "mariazinha", broadcast: null }])
  })

  it("ignores broadcasts from participants that already left", () => {
    startBroadcast("ghost", broadcast)
    stopBroadcast("ghost")

    expect(snapshot()).toEqual([])
  })

  it("hands out copies, so a snapshot cannot mutate the room", () => {
    join("a", "carlinhos")
    startBroadcast("a", broadcast)

    const taken = snapshot()
    const takenBroadcast = taken[0]?.broadcast
    if (takenBroadcast === null || takenBroadcast === undefined) throw new Error("expected a broadcast")
    takenBroadcast.video.trackName = "tampered"

    expect(snapshot()[0]?.broadcast?.video.trackName).toBe("screen-video")
  })
})
