import { describe, expect, it } from "vitest"
import {
  type AudioApp,
  type PipewireObject,
  appsForMode,
  audioApps,
  isExcludedFromBroadcast,
  linksInto,
  nodeIdByName,
  pairPorts,
  portsOf,
  wiringFor,
} from "./pipewireGraph"

function node(id: number, props: Record<string, unknown>): PipewireObject {
  return { id, type: "PipeWire:Interface:Node", info: { props } }
}

function client(id: number, props: Record<string, unknown>): PipewireObject {
  return { id, type: "PipeWire:Interface:Client", info: { props } }
}

function port(id: number, props: Record<string, unknown>): PipewireObject {
  return { id, type: "PipeWire:Interface:Port", info: { props } }
}

function link(id: number, output: number, input: number): PipewireObject {
  return {
    id,
    type: "PipeWire:Interface:Link",
    info: { props: { "link.output.port": output, "link.input.port": input } },
  }
}

/** Shaped after a real `pw-dump`: a player, its client, a sink, and their ports. */
function graph(): PipewireObject[] {
  return [
    client(92, {
      "application.name": "Firefox",
      "application.process.id": 16766,
      "application.process.binary": "firefox-esr",
    }),
    client(120, {
      "application.name": "Discord",
      "application.process.id": 2222,
      "application.process.binary": "Discord",
    }),
    client(47, { "application.name": "WirePlumber" }),
    node(103, {
      "media.class": "Stream/Output/Audio",
      "node.name": "Firefox",
      "application.name": "Firefox",
      "client.id": 92,
    }),
    node(210, {
      "media.class": "Stream/Output/Audio",
      "node.name": "Discord",
      "application.name": "Discord",
      "client.id": 120,
    }),
    // A recorder, not a player: it must never appear in the list.
    node(88, { "media.class": "Stream/Input/Audio", "node.name": "", "client.id": 74 }),
    node(46, { "media.class": "Audio/Sink", "node.name": "alsa_output.analog", "client.id": 47 }),
    node(500, { "media.class": "Audio/Sink", "node.name": "gorila", "client.id": 47 }),
    // Deliberately FR before FL: pw-dump does not order ports by channel.
    port(131, { "node.id": 103, "port.direction": "out", "audio.channel": "FR" }),
    port(167, { "node.id": 103, "port.direction": "out", "audio.channel": "FL" }),
    port(62, { "node.id": 46, "port.direction": "in", "audio.channel": "FL" }),
    port(64, { "node.id": 46, "port.direction": "in", "audio.channel": "FR" }),
    port(63, { "node.id": 46, "port.direction": "out", "audio.channel": "FL" }),
    port(501, { "node.id": 500, "port.direction": "in", "audio.channel": "FL" }),
    port(502, { "node.id": 500, "port.direction": "in", "audio.channel": "FR" }),
  ]
}

const firefox: AudioApp = {
  nodeId: 103,
  pid: 16766,
  binary: "firefox-esr",
  name: "Firefox",
}
const discord: AudioApp = { nodeId: 210, pid: 2222, binary: "Discord", name: "Discord" }

describe("audioApps", () => {
  it("lists what is playing sound", () => {
    expect(audioApps(graph())).toEqual([firefox, discord])
  })

  // The pid is not on the Node. Reading it there yields nothing, silently, and
  // every application collapses into the same unknown one.
  it("reads the pid off the Client, not the Node", () => {
    const [found] = audioApps(graph())
    expect(found?.pid).toBe(16766)
    expect(found?.binary).toBe("firefox-esr")
  })

  it("ignores recorders, sinks and sources", () => {
    const names = audioApps(graph()).map((app) => app.name)
    expect(names).not.toContain("alsa_output.analog")
    expect(names).not.toContain("gorila")
  })

  it("skips a node whose client is gone", () => {
    const orphan = [
      node(300, { "media.class": "Stream/Output/Audio", "node.name": "Zumbi", "client.id": 999 }),
    ]
    expect(audioApps(orphan)).toEqual([])
  })

  it("survives an empty graph", () => {
    expect(audioApps([])).toEqual([])
  })
})

describe("nodeIdByName", () => {
  it("finds our own sink", () => {
    expect(nodeIdByName(graph(), "gorila")).toBe(500)
  })

  it("returns null when it is not there yet", () => {
    expect(nodeIdByName(graph(), "ainda-nao-existe")).toBeNull()
  })
})

describe("portsOf", () => {
  it("returns the ports of one node in one direction", () => {
    expect(portsOf(graph(), 103, "out")).toEqual([
      { id: 131, channel: "FR" },
      { id: 167, channel: "FL" },
    ])
  })

  it("separates the sink's inputs from its monitor outputs", () => {
    expect(portsOf(graph(), 46, "in").map((p) => p.id)).toEqual([62, 64])
    expect(portsOf(graph(), 46, "out").map((p) => p.id)).toEqual([63])
  })

  // A node that has not been given ports yet is the common case right after it
  // appears: the ports are negotiated after the node itself.
  it("returns nothing for a node with no ports", () => {
    expect(portsOf(graph(), 88, "out")).toEqual([])
  })

  it("returns nothing for a node that does not exist", () => {
    expect(portsOf(graph(), null, "out")).toEqual([])
  })
})

describe("pairPorts", () => {
  // pw-dump listed FR first. Pairing by position would send the right channel
  // to the left, which nobody spots until the audio simply feels wrong.
  it("matches channel to channel, not position to position", () => {
    const outputs = portsOf(graph(), 103, "out")
    const inputs = portsOf(graph(), 500, "in")

    expect(pairPorts(outputs, inputs)).toEqual([
      [131, 502],
      [167, 501],
    ])
  })

  it("falls back to position when channels are missing", () => {
    const outputs = [{ id: 1, channel: null }]
    const inputs = [
      { id: 10, channel: "FL" },
      { id: 11, channel: "FR" },
    ]
    expect(pairPorts(outputs, inputs)).toEqual([[1, 10]])
  })

  it("pairs a mono source to the first input", () => {
    const outputs = [{ id: 1, channel: "MONO" }]
    const inputs = [
      { id: 10, channel: "FL" },
      { id: 11, channel: "FR" },
    ]
    expect(pairPorts(outputs, inputs)).toEqual([[1, 10]])
  })

  it("pairs nothing when either side is empty", () => {
    expect(pairPorts([], [{ id: 10, channel: "FL" }])).toEqual([])
    expect(pairPorts([{ id: 1, channel: "FL" }], [])).toEqual([])
  })
})

describe("isExcludedFromBroadcast", () => {
  it("keeps Discord out, whatever the flavour", () => {
    for (const binary of ["Discord", "discord", "DiscordCanary", "discordptb"]) {
      expect(isExcludedFromBroadcast({ ...discord, binary })).toBe(true)
    }
  })

  // Capturing our own output while watching someone sends their audio back to
  // them.
  it("keeps ourselves out", () => {
    expect(isExcludedFromBroadcast({ ...firefox, binary: "compartilha-ai-gorila" })).toBe(true)
  })

  it("lets an ordinary application through", () => {
    expect(isExcludedFromBroadcast(firefox)).toBe(false)
  })
})

describe("appsForMode", () => {
  const apps = [firefox, discord]

  it("wires nothing at all in 'none'", () => {
    expect(appsForMode(apps, { kind: "none" })).toEqual([])
  })

  // The device monitor carries everything by itself; there is nothing per
  // application to wire.
  it("wires nothing per application in 'system'", () => {
    expect(appsForMode(apps, { kind: "system" })).toEqual([])
  })

  it("wires only the ticked pids", () => {
    expect(appsForMode(apps, { kind: "include", pids: [16766] })).toEqual([firefox])
  })

  it("wires nothing when nothing is ticked", () => {
    expect(appsForMode(apps, { kind: "include", pids: [] })).toEqual([])
  })

  // "Everything but Discord" is an inclusion of the whole list, never the
  // native exclusion: that one takes a single process tree, and more than one
  // thing has to stay out.
  it("wires the whole list in 'everything', minus what must never go out", () => {
    expect(appsForMode(apps, { kind: "everything" })).toEqual([firefox])
  })

  it("never lets Discord through, even when its pid is ticked", () => {
    expect(appsForMode(apps, { kind: "include", pids: [2222] })).toEqual([])
  })
})

describe("linksInto", () => {
  it("reads the links landing on the node, as the pairs that made them", () => {
    const wired = [...graph(), link(700, 167, 501), link(701, 131, 502)]
    expect(linksInto(wired, 500)).toEqual([
      [167, 501],
      [131, 502],
    ])
  })

  // The recorder's link leaves the sink's monitor and lands on the recorder,
  // and a pass that mistook it for an application's would tear out the capture.
  it("ignores links that only leave the node", () => {
    const wired = [
      ...graph(),
      port(900, { "node.id": 500, "port.direction": "out" }),
      link(702, 900, 62),
    ]
    expect(linksInto(wired, 500)).toEqual([])
  })

  it("has nothing to say about a node that is not there", () => {
    expect(linksInto(graph(), null)).toEqual([])
  })
})

describe("wiringFor", () => {
  it("wires nothing in 'none'", () => {
    expect(wiringFor(graph(), { kind: "none" }, "gorila", null)).toEqual([])
  })

  it("wires the default sink's monitor in 'system'", () => {
    expect(wiringFor(graph(), { kind: "system" }, "gorila", "alsa_output.analog")).toEqual([
      [63, 501],
    ])
  })

  // Without the name there is no monitor to take, and wiring the wrong device
  // would broadcast a silent one.
  it("wires nothing in 'system' when the default sink is unknown", () => {
    expect(wiringFor(graph(), { kind: "system" }, "gorila", null)).toEqual([])
  })

  it("wires each playing application, channel by channel", () => {
    expect(wiringFor(graph(), { kind: "everything" }, "gorila", null)).toEqual([
      [131, 502],
      [167, 501],
    ])
  })

  it("never wires what must stay out", () => {
    expect(wiringFor(graph(), { kind: "include", pids: [2222] }, "gorila", null)).toEqual([])
  })

  // Our sink is loaded before anything is wired to it; asking too early has to
  // come back empty rather than pair against whatever else is in the graph.
  it("wires nothing when our sink is not in the graph", () => {
    expect(wiringFor(graph(), { kind: "everything" }, "outro", null)).toEqual([])
  })
})
