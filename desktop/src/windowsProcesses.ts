/**
 * Deciding which Windows processes may reach the broadcast.
 *
 * Pure functions over what PowerShell reports, free of `electron` and of any
 * spawning so the room's test suite can exercise them — which matters more here
 * than anywhere else in the project, since nobody working on this has a Windows
 * machine to try it on.
 */

/** One row of `Win32_Process`: the whole table, parents included. */
export type WindowsProcess = {
  ProcessId: number
  ParentProcessId: number
  Name: string
}

/** One row of `Get-Process`, already filtered to those showing a window. */
export type WindowsWindow = {
  Id: number
  MainWindowTitle: string
}

export type WindowsApp = {
  pid: number
  /** Executable name without its extension, for matching and for the sort. */
  binary: string
  /** The window title, which is what a person recognises. */
  name: string
}

/**
 * Discord in every flavour it ships as.
 *
 * Carrying the call is the entire problem this app exists to solve, so it never
 * appears in the list — and being absent, it cannot be ticked by accident
 * either. Every process of its tree carries the same executable name, so
 * matching the name catches the renderers and the GPU process too.
 *
 * Matched on the name rather than by walking ancestors on purpose: Discord can
 * launch a game itself, and that game would then have Discord as a parent.
 * Excluding by ancestry would quietly hide exactly the thing being broadcast.
 */
const DISCORD = /^discord(ptb|canary|development)?$/i

/** How far up a parent chain to walk before giving up. */
const MAX_TREE_DEPTH = 12

function baseName(name: string): string {
  return name.replace(/\.exe$/i, "")
}

/**
 * Every process descending from ours, our own included.
 *
 * Found by ancestry rather than by name because Electron's children — the
 * renderer, the GPU process — are named after the app on some installs and not
 * on others. Capturing ourselves while watching someone would send their own
 * audio back to them.
 */
function ourTree(procs: WindowsProcess[], ourPid: number): Set<number> {
  const byPid = new Map<number, WindowsProcess>()
  for (const process of procs) byPid.set(process.ProcessId, process)

  const ours = new Set<number>([ourPid])

  for (const process of procs) {
    let current: WindowsProcess | undefined = process
    let steps = 0
    while (current !== undefined && steps < MAX_TREE_DEPTH) {
      if (current.ProcessId === ourPid) {
        ours.add(process.ProcessId)
        break
      }
      // A recycled pid can close a loop in the chain.
      if (current.ParentProcessId === current.ProcessId) break
      current = byPid.get(current.ParentProcessId)
      steps += 1
    }
  }

  return ours
}

/**
 * The applications offered for capture.
 *
 * Only processes showing a window. That single rule is what makes "everything
 * but Discord" safe without a blocklist to maintain: audio mixers — SteelSeries
 * Sonar, VoiceMeeter and their kind — have no window, so they never appear, and
 * they are the ones measured replaying the broadcaster's own microphone into
 * the stream.
 *
 * The price is that a program with no window at all is never heard. In practice
 * that is a good trade, because the windowless category is almost entirely made
 * of things nobody wants to broadcast.
 */
export function windowsApps(
  table: { procs: WindowsProcess[]; windows: WindowsWindow[] },
  ourPid: number,
): WindowsApp[] {
  const byPid = new Map<number, WindowsProcess>()
  for (const process of table.procs) byPid.set(process.ProcessId, process)

  const ours = ourTree(table.procs, ourPid)

  const apps: WindowsApp[] = []
  const seen = new Set<number>()

  for (const window of table.windows) {
    if (seen.has(window.Id)) continue
    if (ours.has(window.Id)) continue

    // A window whose process is gone from the table cannot be captured: the
    // capture takes a pid, and this one no longer names anything.
    const process = byPid.get(window.Id)
    if (process === undefined) continue

    const binary = baseName(process.Name)
    if (DISCORD.test(binary)) continue

    seen.add(window.Id)
    apps.push({ pid: window.Id, binary, name: window.MainWindowTitle })
  }

  // Sorted by executable so the list does not reshuffle between refreshes; it
  // is re-read every few seconds while the panel is open, and entries jumping
  // under the pointer would make it unusable.
  return apps.sort((a, b) => a.binary.localeCompare(b.binary, "pt-BR"))
}

/**
 * The oldest Windows build that can capture audio per process.
 *
 * `AUDIOCLIENT_ACTIVATION_PARAMS` with `VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK`
 * arrived in build 20348, per Microsoft. The addon's own README claims Windows
 * 10 2004 (build 19041), which disagrees; warning on the stricter of the two is
 * the safe side, since below it the capture fails at runtime with nothing
 * useful to say.
 */
export const MIN_WINDOWS_BUILD = 20348

/**
 * Whether this Windows can capture per process.
 *
 * A version string we cannot read passes: refusing to run over a number we
 * failed to parse would be worse than letting the capture report the problem
 * itself.
 */
export function supportsProcessLoopback(release: string): boolean {
  const build = Number(release.split(".")[2])
  if (!Number.isInteger(build)) return true
  return build >= MIN_WINDOWS_BUILD
}
