/**
 * Bundles the main and preload entry points.
 *
 * CommonJS, not ESM: `await app.whenReady()` at the top level of an ESM main
 * process deadlocks, because `ready` only fires once the module has finished
 * evaluating and the module is waiting on `ready`. CJS sidesteps the whole
 * class of problem, and nothing here needs ESM.
 *
 * `electron` stays external — it is resolved from the runtime, not bundled.
 * So does `electron-updater`, a CommonJS package whose exports change shape
 * when bundled: the packaged app died on start with `autoUpdater` undefined.
 * So does the audio addon: `audioWasapi.ts` resolves it by path at run time, and
 * bundling it would break the `app.asar.unpacked` rewrite that finds the `.node`
 * inside a packaged app.
 */

import { copyFile, mkdir, readFile } from "node:fs/promises"
import { build } from "esbuild"

/**
 * The room's address, baked into the bundle.
 *
 * Kept out of the repository because this one is public: anybody holding the
 * address lands on the login screen, and the password is the gate, but there is
 * no reason to publish where the room lives.
 *
 * Baked at build time rather than read at run time because the packaged app
 * cannot ask a friend to configure anything — it has to know where to connect
 * the first time it opens.
 */
async function roomUrl() {
  const fromEnvironment = process.env.GORILA_URL?.trim()
  if (fromEnvironment !== undefined && fromEnvironment.length > 0) {
    return fromEnvironment.replace(/\/$/, "")
  }

  const file = await readFile(".env", "utf8").catch(() => null)
  const match = file?.match(/^\s*GORILA_URL\s*=\s*(\S+)/m)
  if (match?.[1] !== undefined) return match[1].replace(/\/$/, "")

  // Loudly, and naming the fix: a placeholder here would ship an app that
  // silently points nowhere.
  throw new Error(
    "GORILA_URL is not set. Copy desktop/.env.example to desktop/.env and put the room's address in it.",
  )
}

const ROOM_URL = await roomUrl()

const shared = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  define: { __ROOM_URL__: JSON.stringify(ROOM_URL) },
  external: ["electron", "electron-updater", "loopback-capture"],
  sourcemap: true,
}

await mkdir("dist", { recursive: true })

await Promise.all([
  build({ ...shared, entryPoints: ["src/main.ts"], outfile: "dist/main.cjs" }),
  build({ ...shared, entryPoints: ["src/preload.ts"], outfile: "dist/preload.cjs" }),
  // The main process loads this one relative to itself, so it has to land
  // beside the bundles rather than stay in src.
  copyFile("src/offline.html", "dist/offline.html"),
])
