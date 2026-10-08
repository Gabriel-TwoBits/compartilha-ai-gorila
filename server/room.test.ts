import { beforeEach, describe, expect, it } from "vitest"
import type { Broadcast } from "@shared/protocol"
import {
  join,
  leave,
  reset,
  setWatching,
  snapshot,
  startBroadcast,
  stopBroadcast,
} from "./room"

const broadcast: Broadcast = {
  screen: { sessionId: "session-a", trackName: "screen-video" },
  camera: { sessionId: "session-a", trackName: "camera-video" },
  audio: { sessionId: "session-a", trackName: "screen-audio" },
}

const otherBroadcast: Broadcast = {
  screen: null,
  camera: { sessionId: "session-b", trackName: "camera-video" },
  audio: null,
}

beforeEach(() => {
  reset()
})

describe("presence", () => {
  it("starts empty", () => {
    expect(snapshot()).toEqual([])
  })

  it("lists one entry per nickname, not broadcasting", () => {
    join("conn-1", "carlinhos")
    join("conn-2", "mariazinha")

    expect(snapshot()).toEqual([
      { nickname: "carlinhos", broadcast: null, viewers: [] },
      { nickname: "mariazinha", broadcast: null, viewers: [] },
    ])
  })

  it("collapses several connections of the same person into one participant", () => {
    join("tab-1", "carlinhos")
    join("tab-2", "carlinhos")

    expect(snapshot()).toHaveLength(1)
  })

  it("keeps the participant until the last connection leaves", () => {
    join("tab-1", "carlinhos")
    join("tab-2", "carlinhos")

    leave("tab-1", "carlinhos")
    expect(snapshot()).toHaveLength(1)

    leave("tab-2", "carlinhos")
    expect(snapshot()).toEqual([])
  })

  it("ignores a leave for an unknown participant", () => {
    join("conn-1", "carlinhos")
    leave("conn-9", "ghost")

    expect(snapshot()).toHaveLength(1)
  })
})

describe("broadcasts", () => {
  it("records and clears a broadcast", () => {
    join("conn-1", "carlinhos")

    startBroadcast("conn-1", "carlinhos", broadcast)
    expect(snapshot()[0]?.broadcast).toEqual(broadcast)

    stopBroadcast("conn-1", "carlinhos")
    expect(snapshot()[0]?.broadcast).toBeNull()
  })

  it("accepts a broadcast without audio", () => {
    join("conn-1", "carlinhos")
    startBroadcast("conn-1", "carlinhos", otherBroadcast)

    expect(snapshot()[0]?.broadcast).toEqual(otherBroadcast)
  })

  it("lets a second connection of the same person replace the broadcast", () => {
    join("tab-1", "carlinhos")
    join("tab-2", "carlinhos")

    startBroadcast("tab-1", "carlinhos", broadcast)
    startBroadcast("tab-2", "carlinhos", otherBroadcast)

    expect(snapshot()[0]?.broadcast).toEqual(otherBroadcast)
  })

  it("only lets the publishing connection stop the broadcast", () => {
    join("tab-1", "carlinhos")
    join("tab-2", "carlinhos")
    startBroadcast("tab-1", "carlinhos", broadcast)

    stopBroadcast("tab-2", "carlinhos")
    expect(snapshot()[0]?.broadcast).toEqual(broadcast)

    stopBroadcast("tab-1", "carlinhos")
    expect(snapshot()[0]?.broadcast).toBeNull()
  })

  it("keeps the broadcast alive when an idle second tab closes", () => {
    join("tab-1", "carlinhos")
    join("tab-2", "carlinhos")
    startBroadcast("tab-1", "carlinhos", broadcast)

    leave("tab-2", "carlinhos")

    expect(snapshot()[0]?.broadcast).toEqual(broadcast)
  })

  it("drops the broadcast when the publishing connection closes", () => {
    join("tab-1", "carlinhos")
    join("tab-2", "carlinhos")
    startBroadcast("tab-1", "carlinhos", broadcast)

    leave("tab-1", "carlinhos")

    expect(snapshot()[0]?.broadcast).toBeNull()
  })

  it("ignores a broadcast from a connection that already left", () => {
    join("conn-1", "carlinhos")
    startBroadcast("stale-conn", "carlinhos", broadcast)

    expect(snapshot()[0]?.broadcast).toBeNull()
  })

  it("ignores a broadcast from a participant that already left", () => {
    startBroadcast("conn-1", "ghost", broadcast)
    stopBroadcast("conn-1", "ghost")

    expect(snapshot()).toEqual([])
  })

  it("hands out copies, so a snapshot cannot mutate the room", () => {
    join("conn-1", "carlinhos")
    startBroadcast("conn-1", "carlinhos", broadcast)

    const taken = snapshot()[0]?.broadcast
    if (taken === null || taken === undefined) throw new Error("expected a broadcast")
    if (taken.screen === null || taken.camera === null) throw new Error("expected both tracks")
    taken.screen.trackName = "tampered"
    taken.camera.trackName = "tampered"

    expect(snapshot()[0]?.broadcast).toEqual(broadcast)
  })
})

describe("viewers", () => {
  it("attributes a watcher to the broadcaster", () => {
    join("conn-1", "carlinhos")
    join("conn-2", "mariazinha")
    startBroadcast("conn-1", "carlinhos", broadcast)

    setWatching("mariazinha", ["carlinhos"])

    expect(snapshot()[0]?.viewers).toEqual(["mariazinha"])
    expect(snapshot()[1]?.viewers).toEqual([])
  })

  it("does not count broadcasters as their own viewers", () => {
    join("conn-1", "carlinhos")
    startBroadcast("conn-1", "carlinhos", broadcast)

    setWatching("carlinhos", ["carlinhos"])

    expect(snapshot()[0]?.viewers).toEqual([])
  })

  it("clears the attribution when a watcher looks away", () => {
    join("conn-1", "carlinhos")
    join("conn-2", "mariazinha")
    startBroadcast("conn-1", "carlinhos", broadcast)
    setWatching("mariazinha", ["carlinhos"])

    setWatching("mariazinha", [])

    expect(snapshot()[0]?.viewers).toEqual([])
  })

  it("drops a watcher from the count once they leave", () => {
    join("conn-1", "carlinhos")
    join("conn-2", "mariazinha")
    startBroadcast("conn-1", "carlinhos", broadcast)
    setWatching("mariazinha", ["carlinhos"])

    leave("conn-2", "mariazinha")

    expect(snapshot()[0]?.viewers).toEqual([])
  })

  it("attributes a watcher to every broadcast they have open", () => {
    join("conn-1", "carlinhos")
    join("conn-2", "mariazinha")
    join("conn-3", "zezinho")
    startBroadcast("conn-1", "carlinhos", broadcast)
    startBroadcast("conn-2", "mariazinha", broadcast)

    setWatching("zezinho", ["carlinhos", "mariazinha"])

    expect(snapshot()[0]?.viewers).toEqual(["zezinho"])
    expect(snapshot()[1]?.viewers).toEqual(["zezinho"])
  })

  it("counts a broadcaster watching someone else without counting themselves", () => {
    join("conn-1", "carlinhos")
    join("conn-2", "mariazinha")
    startBroadcast("conn-1", "carlinhos", broadcast)
    startBroadcast("conn-2", "mariazinha", broadcast)

    setWatching("mariazinha", ["carlinhos", "mariazinha"])

    expect(snapshot()[0]?.viewers).toEqual(["mariazinha"])
    expect(snapshot()[1]?.viewers).toEqual([])
  })

  it("ignores a watch report from a participant that already left", () => {
    setWatching("ghost", ["carlinhos"])

    expect(snapshot()).toEqual([])
  })
})
