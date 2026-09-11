import { describe, expect, it } from "vitest"
import { detectTarget, downloadsFor, pitchFor } from "./downloads"

/** Real strings, because the whole point of this module is matching real ones. */
const WINDOWS_11 =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
const LINUX_DESKTOP =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
const ANDROID =
  "Mozilla/5.0 (Linux; Android 15; moto g34 5G) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36"
const CHROMEBOOK =
  "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
const MACOS =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"

describe("detectTarget", () => {
  it("recognises Windows", () => {
    expect(detectTarget("Win32", WINDOWS_11)).toBe("windows")
  })

  it("recognises a Linux desktop", () => {
    expect(detectTarget("Linux x86_64", LINUX_DESKTOP)).toBe("linux")
  })

  /**
   * Android says "Linux" in `navigator.platform`, so platform alone would hand
   * a phone an AppImage that cannot run — and a phone has no use for the app
   * anyway, since it is there to watch.
   */
  it("does not offer a build to an Android phone", () => {
    expect(detectTarget("Linux armv8l", ANDROID)).toBe("unsupported")
  })

  it("does not offer a build to a Chromebook", () => {
    expect(detectTarget("Linux x86_64", CHROMEBOOK)).toBe("unsupported")
  })

  it("does not offer a build to an iPhone", () => {
    expect(detectTarget("iPhone", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)")).toBe(
      "unsupported",
    )
  })

  // There is no macOS build. Saying so beats offering something that will not
  // run.
  it("does not offer a build on macOS", () => {
    expect(detectTarget("MacIntel", MACOS)).toBe("unsupported")
  })

  it("says nothing useful for an empty platform", () => {
    expect(detectTarget("", "")).toBe("unsupported")
  })
})

describe("downloadsFor", () => {
  it("offers one installer on Windows", () => {
    const [first, ...rest] = downloadsFor("windows")
    expect(first?.url).toContain(".exe")
    expect(rest).toEqual([])
  })

  // The AppImage updates itself but needs libfuse2; the .deb needs nothing but
  // never updates. Both cases exist in the room, so both are offered.
  it("offers the AppImage first and the .deb beside it on Linux", () => {
    const links = downloadsFor("linux")
    expect(links.map((link) => link.url)).toEqual([
      "/atualiza/CompartilhaAiGorila.AppImage",
      "/atualiza/CompartilhaAiGorila.deb",
    ])
    expect(links[0]?.note).toMatch(/libfuse2/)
    expect(links[1]?.note).toMatch(/não se atualiza/)
  })

  it("offers nothing where there is nothing to offer", () => {
    expect(downloadsFor("unsupported")).toEqual([])
  })

  // A link handed out once has to keep working: the versioned artifacts change
  // name at every release, these do not.
  it("points at names that never change", () => {
    for (const target of ["windows", "linux"] as const) {
      for (const link of downloadsFor(target)) {
        expect(link.url).not.toMatch(/\d+\.\d+\.\d+/)
      }
    }
  })
})

describe("pitchFor", () => {
  it("promises to keep the call out on Windows", () => {
    expect(pitchFor("windows")).toMatch(/Discord/)
  })

  // On Linux the browser hands over no screen audio at all, so promising to
  // keep the call out would describe the wrong problem entirely.
  it("says what the app is actually for on Linux", () => {
    expect(pitchFor("linux")).toMatch(/não manda áudio nenhum/)
  })

  it("promises nothing where there is no build", () => {
    expect(pitchFor("unsupported")).toBeNull()
  })
})
