import { app } from "electron"
import { autoUpdater } from "electron-updater"

/**
 * Keeps the app up to date on its own.
 *
 * The only download anybody does by hand is the first one. After that the app
 * looks for a new version shortly after opening and every few hours, fetches it
 * in the background, and offers to restart — and whoever ignores the offer gets
 * the new version the next time they close the app anyway.
 */

/** Late enough not to compete with the window opening for bandwidth. */
const FIRST_CHECK_MS = 15_000

/**
 * Ceilings for the check done before the window opens.
 *
 * Two of them, because the wait changes nature: first we are asking whether
 * anything is there, then we are fetching it. A server that is down must not
 * stop anybody from opening the app, and a slow download must not either — past
 * the ceiling the app opens and the download carries on behind it, ending in the
 * banner.
 */
const STARTUP_CHECK_MS = 10_000
const STARTUP_DOWNLOAD_MS = 90_000

/** Long enough for the splash to show "restarting" before the app quits. */
const SETTLE_BEFORE_INSTALL_MS = 700

const MILLISECONDS_PER_HOUR = 60 * 60 * 1000
const CHECK_EVERY_MS = 4 * MILLISECONDS_PER_HOUR

/**
 * What the app knows about updating, at this moment.
 *
 * `idle` and `current` are different things on purpose: "have not looked yet"
 * and "looked, and there is nothing" both leave the button quiet, and telling
 * them apart is the only way to answer a click honestly.
 */
export type UpdateState = {
  phase: "idle" | "checking" | "current" | "downloading" | "ready" | "failed"
  /** 0 to 100 while downloading. */
  percent: number
  version: string | null
  /**
   * The last failure, kept even when nothing shows it.
   *
   * A server that is down is an ordinary event and does not deserve a fright,
   * but "it does not update and I have no idea why" has nowhere to start
   * without this.
   */
  error: string | null
}

let state: UpdateState = { phase: "idle", percent: 0, version: null, error: null }

/**
 * Who to tell when the state changes.
 *
 * Module-level, not a parameter of `start`: as an argument it would be captured
 * by whoever called first, and every later change — a manual check, a download
 * finishing — would update the state with nobody listening. The button would
 * then do nothing visible, which is precisely the complaint it causes.
 */
let notify: ((next: UpdateState) => void) | null = null

function change(patch: Partial<UpdateState>): void {
  state = { ...state, ...patch }
  notify?.(state)
}

export function currentUpdateState(): UpdateState {
  return state
}

export function onUpdateState(listener: (next: UpdateState) => void): void {
  notify = listener
}

/**
 * Looks for a new version before the main window exists, and installs one if it
 * finds it.
 *
 * Nobody should walk into a version that is about to be replaced a minute
 * later — and an update that only ever arrives as a banner is one most people
 * never click. Resolves `"installing"` when the app is about to restart, and
 * `"continue"` in every other case, failures included.
 */
export async function checkOnStartup(
  feedUrl: string,
  onProgress: (state: UpdateState) => void,
): Promise<"continue" | "installing"> {
  // The splash can be forced outside a packaged app to look at it; the updater
  // itself refuses to run there, so nothing else happens.
  if (!app.isPackaged) return "continue"

  autoUpdater.setFeedURL({ provider: "generic", url: feedUrl })

  return new Promise((resolve) => {
    let settled = false
    let timer: NodeJS.Timeout

    const finish = (outcome: "continue" | "installing"): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      autoUpdater.removeListener("update-available", found)
      autoUpdater.removeListener("update-not-available", nothing)
      autoUpdater.removeListener("download-progress", progressed)
      autoUpdater.removeListener("update-downloaded", downloaded)
      autoUpdater.removeListener("error", failed)
      resolve(outcome)
    }

    const found = (info: { version: string }): void => {
      // Found: the ceiling becomes the download's, which is a longer wait of a
      // different kind.
      clearTimeout(timer)
      timer = setTimeout(() => finish("continue"), STARTUP_DOWNLOAD_MS)
      change({ phase: "downloading", percent: 0, version: info.version, error: null })
      onProgress(state)
    }

    const progressed = (progress: { percent: number }): void => {
      change({ percent: Math.round(progress.percent) })
      onProgress(state)
    }

    const downloaded = (info: { version: string }): void => {
      change({ phase: "ready", percent: 100, version: info.version, error: null })
      onProgress(state)
      // A breath, so the splash can change its sentence before the app vanishes.
      setTimeout(() => {
        finish("installing")
        autoUpdater.quitAndInstall()
      }, SETTLE_BEFORE_INSTALL_MS)
    }

    const nothing = (): void => {
      change({ phase: "current" })
      finish("continue")
    }

    // A server that is down is an ordinary event, and never a reason to keep
    // somebody out of their own app.
    const failed = (cause: Error): void => {
      change({ phase: "failed", error: cause.message })
      finish("continue")
    }

    autoUpdater.on("update-available", found)
    autoUpdater.on("update-not-available", nothing)
    autoUpdater.on("download-progress", progressed)
    autoUpdater.on("update-downloaded", downloaded)
    autoUpdater.on("error", failed)

    timer = setTimeout(() => finish("continue"), STARTUP_CHECK_MS)
    change({ phase: "checking", error: null })
    void autoUpdater.checkForUpdates().catch(() => finish("continue"))
  })
}

/** Asks now, whatever the schedule says. */
export async function checkNow(): Promise<UpdateState> {
  if (!app.isPackaged) return state

  change({ phase: "checking", error: null })
  await autoUpdater.checkForUpdates().catch((cause: unknown) => {
    change({
      phase: "failed",
      error: cause instanceof Error ? cause.message : "não consegui checar",
    })
  })
  return state
}

/** Restarts into the version already downloaded. */
export function installNow(): void {
  if (state.phase !== "ready") return
  autoUpdater.quitAndInstall()
}

/**
 * Wires the updater up and starts the schedule.
 *
 * Only ever runs from a packaged app: electron-updater refuses to work outside
 * one, and without this guard `npm start` throws "application is not packaged"
 * every single time.
 */
export function start(feedUrl: string): void {
  if (!app.isPackaged) return

  // Overrides whatever electron-builder stamped into app-update.yml. The
  // address is not in the repository, so the packaged default is a placeholder
  // and this is the real one.
  autoUpdater.setFeedURL({ provider: "generic", url: feedUrl })

  autoUpdater.autoDownload = true
  // Installing behind someone's back on quit is the difference between an
  // update they chose and one that surprises them mid-session.
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on("checking-for-update", () => change({ phase: "checking" }))
  autoUpdater.on("update-not-available", () => change({ phase: "current", percent: 0 }))
  autoUpdater.on("update-available", (info: { version: string }) =>
    change({ phase: "downloading", percent: 0, version: info.version }),
  )
  autoUpdater.on("download-progress", (progress: { percent: number }) =>
    change({ percent: Math.round(progress.percent) }),
  )
  autoUpdater.on("update-downloaded", (info: { version: string }) =>
    change({ phase: "ready", percent: 100, version: info.version }),
  )
  autoUpdater.on("error", (cause: Error) =>
    change({ phase: "failed", error: cause.message }),
  )

  setTimeout(() => void checkNow(), FIRST_CHECK_MS)
  setInterval(() => void checkNow(), CHECK_EVERY_MS)
}
