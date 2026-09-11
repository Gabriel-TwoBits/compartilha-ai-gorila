import { describe, expect, it } from "vitest"
import type { Broadcast, Participant } from "@shared/protocol"
import { type RoomSnapshot, roomEvents } from "./roomEvents"

const SOME_BROADCAST: Broadcast = {
  video: { sessionId: "session", trackName: "video" },
  audio: null,
}

function person(
  nickname: string,
  options: { live?: boolean; viewers?: string[] } = {},
): Participant {
  return {
    nickname,
    broadcast: options.live === true ? SOME_BROADCAST : null,
    viewers: options.viewers ?? [],
  }
}

function room(you: string, ...participants: Participant[]): RoomSnapshot {
  return { you, participants }
}

describe("roomEvents", () => {
  // Walking into a room that already has people in it would otherwise fire an
  // arrival for every one of them, all at once.
  it("says nothing about the first snapshot", () => {
    const first = room("eu", person("eu"), person("ana"), person("bia"))
    expect(roomEvents(null, first)).toEqual([])
  })

  it("reports an arrival", () => {
    const before = room("eu", person("eu"))
    const after = room("eu", person("eu"), person("ana"))
    expect(roomEvents(before, after)).toEqual(["arrived"])
  })

  it("reports a departure", () => {
    const before = room("eu", person("eu"), person("ana"))
    const after = room("eu", person("eu"))
    expect(roomEvents(before, after)).toEqual(["left"])
  })

  // Three people arriving between two snapshots is one sound, not three.
  it("collapses several arrivals into one event", () => {
    const before = room("eu", person("eu"))
    const after = room("eu", person("eu"), person("ana"), person("bia"), person("caio"))
    expect(roomEvents(before, after)).toEqual(["arrived"])
  })

  it("reports an arrival and a departure in the same tick", () => {
    const before = room("eu", person("eu"), person("ana"))
    const after = room("eu", person("eu"), person("bia"))
    expect(roomEvents(before, after)).toEqual(["arrived", "left"])
  })

  it("reports a broadcast starting and stopping", () => {
    const idle = room("eu", person("eu"), person("ana"))
    const live = room("eu", person("eu"), person("ana", { live: true }))

    expect(roomEvents(idle, live)).toEqual(["broadcastStarted"])
    expect(roomEvents(live, idle)).toEqual(["broadcastStopped"])
  })

  it("says nothing when nothing changed", () => {
    const snapshot = room("eu", person("eu"), person("ana", { live: true }))
    expect(roomEvents(snapshot, snapshot)).toEqual([])
  })

  describe("viewers", () => {
    it("reports someone opening our broadcast", () => {
      const before = room("eu", person("eu", { live: true }), person("ana"))
      const after = room("eu", person("eu", { live: true, viewers: ["ana"] }), person("ana"))
      expect(roomEvents(before, after)).toEqual(["viewerArrived"])
    })

    it("reports someone closing it", () => {
      const before = room("eu", person("eu", { live: true, viewers: ["ana"] }), person("ana"))
      const after = room("eu", person("eu", { live: true }), person("ana"))
      expect(roomEvents(before, after)).toEqual(["viewerLeft"])
    })

    // Stopping empties the audience in a single snapshot. Without the guard that
    // is one departure sound per viewer, on top of the stop sound itself.
    it("does not mourn the audience when we stop broadcasting", () => {
      const before = room(
        "eu",
        person("eu", { live: true, viewers: ["ana", "bia", "caio"] }),
        person("ana"),
      )
      const after = room("eu", person("eu"), person("ana"))
      expect(roomEvents(before, after)).toEqual(["broadcastStopped"])
    })

    it("ignores who is watching someone else", () => {
      const before = room("eu", person("eu"), person("ana", { live: true }))
      const after = room("eu", person("eu"), person("ana", { live: true, viewers: ["bia"] }))
      expect(roomEvents(before, after)).toEqual([])
    })

    it("says nothing about viewers while we are not broadcasting", () => {
      const before = room("eu", person("eu", { viewers: ["ana"] }))
      const after = room("eu", person("eu", { viewers: [] }))
      expect(roomEvents(before, after)).toEqual([])
    })
  })
})
