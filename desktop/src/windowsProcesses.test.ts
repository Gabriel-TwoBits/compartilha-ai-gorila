import { describe, expect, it } from "vitest"
import {
  MIN_WINDOWS_BUILD,
  type WindowsProcess,
  type WindowsWindow,
  supportsProcessLoopback,
  windowsApps,
} from "./windowsProcesses"

/**
 * Nobody working on this has a Windows machine, so these tests are the only
 * thing standing between a rule and a broadcast that carries the call.
 */

function process(
  ProcessId: number,
  Name: string,
  ParentProcessId = 1,
): WindowsProcess {
  return { ProcessId, ParentProcessId, Name }
}

function window(Id: number, MainWindowTitle: string): WindowsWindow {
  return { Id, MainWindowTitle }
}

const OUR_PID = 500

/** A plausible snapshot: a game, a browser, Discord's tree, and ourselves. */
function table() {
  return {
    procs: [
      process(100, "Rocket League.exe"),
      process(200, "firefox.exe"),
      process(300, "Discord.exe"),
      process(301, "Discord.exe", 300),
      process(302, "Discord.exe", 300),
      process(400, "SteelSeriesSonar.exe"),
      process(OUR_PID, "CompartilhaAiGorila.exe"),
      process(501, "conhost.exe", OUR_PID),
      process(502, "chrome_gpu.exe", 501),
    ],
    windows: [
      window(100, "Rocket League (64-bit, DX11)"),
      window(200, "Codeberg — Mozilla Firefox"),
      window(300, "Discord"),
      window(301, "#geral - Discord"),
      window(OUR_PID, "CompartilhaAíGorila"),
      window(502, "CompartilhaAíGorila"),
    ],
  }
}

describe("windowsApps", () => {
  it("offers the game and the browser", () => {
    const names = windowsApps(table(), OUR_PID).map((app) => app.name)
    expect(names).toContain("Rocket League (64-bit, DX11)")
    expect(names).toContain("Codeberg — Mozilla Firefox")
  })

  // The whole point of the app. Every process of Discord's tree carries the
  // same executable name, renderers included.
  it("never offers Discord, in any of its processes", () => {
    const binaries = windowsApps(table(), OUR_PID).map((app) => app.binary)
    expect(binaries).not.toContain("Discord")
  })

  it("keeps out every flavour of Discord", () => {
    for (const name of ["DiscordPTB.exe", "DiscordCanary.exe", "discord.exe"]) {
      const apps = windowsApps(
        { procs: [process(900, name)], windows: [window(900, "conversa")] },
        OUR_PID,
      )
      expect(apps).toEqual([])
    }
  })

  // Discord can launch a game itself. Excluding by ancestry instead of by name
  // would quietly hide exactly the thing being broadcast.
  it("still offers a game that Discord launched", () => {
    const apps = windowsApps(
      {
        procs: [process(300, "Discord.exe"), process(100, "Rocket League.exe", 300)],
        windows: [window(100, "Rocket League")],
      },
      OUR_PID,
    )
    expect(apps.map((app) => app.binary)).toEqual(["Rocket League"])
  })

  // Capturing ourselves while watching someone sends their audio back to them.
  it("never offers us, nor anything we spawned", () => {
    const pids = windowsApps(table(), OUR_PID).map((app) => app.pid)
    expect(pids).not.toContain(OUR_PID)
    expect(pids).not.toContain(502)
  })

  /**
   * An audio mixer has no window, so it never reaches the list — and that is
   * what makes "everything but Discord" safe without a blocklist. Sonar was
   * measured replaying the broadcaster's own voice into the stream.
   */
  it("never offers a process without a window", () => {
    const binaries = windowsApps(table(), OUR_PID).map((app) => app.binary)
    expect(binaries).not.toContain("SteelSeriesSonar")
  })

  it("skips a window whose process is already gone", () => {
    const apps = windowsApps({ procs: [], windows: [window(100, "fantasma")] }, OUR_PID)
    expect(apps).toEqual([])
  })

  // The list is re-read every few seconds while the panel is open; entries
  // jumping around under the pointer would make it unusable.
  it("sorts by executable so the list holds still", () => {
    const apps = windowsApps(
      {
        procs: [process(1, "zoom.exe"), process(2, "anki.exe"), process(3, "mpv.exe")],
        windows: [window(1, "Zoom"), window(2, "Anki"), window(3, "mpv")],
      },
      OUR_PID,
    )
    expect(apps.map((app) => app.binary)).toEqual(["anki", "mpv", "zoom"])
  })

  it("survives an empty machine", () => {
    expect(windowsApps({ procs: [], windows: [] }, OUR_PID)).toEqual([])
  })

  it("does not loop on a parent chain that points at itself", () => {
    const apps = windowsApps(
      {
        procs: [process(700, "estranho.exe", 700)],
        windows: [window(700, "Estranho")],
      },
      OUR_PID,
    )
    expect(apps.map((app) => app.pid)).toEqual([700])
  })
})

describe("supportsProcessLoopback", () => {
  it("accepts Windows 11", () => {
    expect(supportsProcessLoopback("10.0.26200")).toBe(true)
  })

  it("accepts exactly the documented minimum", () => {
    expect(supportsProcessLoopback(`10.0.${MIN_WINDOWS_BUILD}`)).toBe(true)
  })

  it("rejects a Windows 10 older than process loopback", () => {
    expect(supportsProcessLoopback("10.0.19045")).toBe(false)
  })

  // Refusing to run over a number we failed to read would be worse than letting
  // the capture itself report the problem.
  it("gives the benefit of the doubt to anything unreadable", () => {
    expect(supportsProcessLoopback("")).toBe(true)
    expect(supportsProcessLoopback("sei la")).toBe(true)
    expect(supportsProcessLoopback("6.1")).toBe(true)
  })
})
