/**
 * Opens the packaged app and checks that it reaches the room.
 *
 * This exists because of a release that was published broken: the bundle threw
 * on the very first line of the main process, so the window never appeared. In
 * development nothing showed it — the failing module only loads in a packaged
 * app — and the auto-updater could not rescue anybody either, since an app that
 * dies at startup never gets far enough to look for a new version. Whoever
 * downloaded it was stuck until they fetched a new file by hand.
 *
 * So: run this before copying anything into ../release/.
 *
 * The AppImage is extracted rather than executed directly, so the check does
 * not depend on libfuse2 being installed.
 */

import { spawn } from "node:child_process"
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const ARTIFACT_DIR = "dist-app"

/** Unlikely to collide with a browser or another run. */
const DEBUG_PORT = 9333

const STARTUP_TIMEOUT_MS = 60_000
const POLL_MS = 500

/** Electron prints exactly this when the main process throws during load. */
const MAIN_PROCESS_CRASH = "A JavaScript error occurred in the main process"

function fail(message) {
  process.stderr.write(`\nFALHOU: ${message}\n`)
  process.exitCode = 1
}

/**
 * The build about to be released, picked by version rather than by whatever
 * turns up first.
 *
 * Artifacts of every version that was ever built pile up in `dist-app/`, and
 * taking any `.AppImage` from there means the check can pass on a release that
 * was cut months ago while the one being published was never opened — the exact
 * failure this script exists to catch, reported as a success.
 *
 * Absolute, because the extraction runs with a temporary directory as its cwd.
 */
async function findAppImage() {
  const fromArgument = process.argv[2]
  if (fromArgument !== undefined) return resolve(fromArgument)

  const { version } = JSON.parse(await readFile("package.json", "utf8"))
  const entries = await readdir(ARTIFACT_DIR).catch(() => [])
  const appImage = entries.find((entry) => entry.endsWith(`-${version}.AppImage`))
  if (appImage === undefined) {
    throw new Error(
      `no ${version} .AppImage in ${ARTIFACT_DIR}/ — run \`npm run dist\` first. ` +
        `Another version sitting there is not a substitute.`,
    )
  }
  return resolve(ARTIFACT_DIR, appImage)
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", ...options })
    child.on("error", reject)
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`))))
  })
}

/**
 * Waits for the window that matters.
 *
 * Polling for "any page" is not enough: the splash that looks for an update
 * opens first and lives in `file://`, so an early look finds it and mistakes it
 * for the offline page. Only two things end the wait — the room, or the offline
 * page, which is a real failure worth naming.
 */
async function waitForRoom() {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS

  while (Date.now() < deadline) {
    const targets = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)
      .then((response) => response.json())
      .catch(() => null)

    if (Array.isArray(targets)) {
      const pages = targets.filter((target) => target.type === "page")
      const room = pages.find((page) => page.url.startsWith("http"))
      if (room !== undefined) return { url: room.url }

      const offline = pages.find((page) => page.url.includes("offline.html"))
      if (offline !== undefined) return { offline: true }
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }

  return null
}

const appImage = await findAppImage()
const workDir = await mkdtemp(join(tmpdir(), "gorila-smoke-"))

try {
  process.stdout.write(`abrindo ${appImage}\n`)
  await run(appImage, ["--appimage-extract"], { cwd: workDir, stdio: "ignore" })

  let output = ""
  const app = spawn(join(workDir, "squashfs-root", "AppRun"), [
    "--no-sandbox",
    `--remote-debugging-port=${DEBUG_PORT}`,
  ])
  app.stdout.on("data", (chunk) => (output += chunk))
  app.stderr.on("data", (chunk) => (output += chunk))

  try {
    const result = await waitForRoom()

    if (output.includes(MAIN_PROCESS_CRASH)) {
      fail(`the main process threw on startup:\n${output.slice(0, 1200)}`)
    } else if (result === null) {
      fail(`no window after ${STARTUP_TIMEOUT_MS / 1000}s:\n${output.slice(0, 1200)}`)
    } else if (result.offline === true) {
      // A working app that could not reach the server — worth telling apart
      // from one that crashed.
      fail("the app opened its offline page: the room did not answer")
    } else {
      process.stdout.write(`OK: a janela abriu em ${result.url}\n`)
    }
  } finally {
    app.kill()
  }
} catch (cause) {
  fail(cause instanceof Error ? cause.message : String(cause))
} finally {
  await rm(workDir, { recursive: true, force: true })
}
