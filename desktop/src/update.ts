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
export function start(): void {
  if (!app.isPackaged) return

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
