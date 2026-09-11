/**
 * Bundles the main and preload entry points.
 *
 * CommonJS, not ESM: `await app.whenReady()` at the top level of an ESM main
 * process deadlocks, because `ready` only fires once the module has finished
 * evaluating and the module is waiting on `ready`. CJS sidesteps the whole
 * class of problem, and nothing here needs ESM.
 *
 * `electron` stays external — it is resolved from the runtime, not bundled.
 */

import { copyFile, mkdir } from "node:fs/promises"
import { build } from "esbuild"

const shared = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["electron"],
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
