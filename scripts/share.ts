/**
 * Builds, serves and tunnels the app with a single command.
 *
 * Screen capture only works in a secure context, so nobody outside this machine
 * can broadcast over plain http. A Cloudflare quick tunnel supplies the TLS;
 * doing the three steps here keeps the public URL one command away instead of
 * three terminals and a log to grep.
 */

import { type ChildProcess, spawn } from "node:child_process"
import { fileURLToPath } from "node:url"

/** Must track the PORT default in server/env.ts. */
const DEFAULT_PORT = "8787"

/** Quick tunnels are handed a random name under this domain. */
const QUICK_TUNNEL_URL = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/

const EXIT_FAILURE = 1

const CLOUDFLARED_DOWNLOAD = "https://github.com/cloudflare/cloudflared/releases/latest"

const projectRoot = fileURLToPath(new URL("..", import.meta.url))

const children = new Set<ChildProcess>()
let shuttingDown = false

function readPort(): string {
  const raw = process.env.PORT?.trim()
  if (raw === undefined || raw.length === 0) return DEFAULT_PORT
  return raw
}

/** Ctrl+C reaches the whole process group, so a signalled child is not a failure. */
function exitCodeFor(code: number | null, signal: NodeJS.Signals | null): number {
  if (code !== null) return code
  if (signal !== null) return 0
  return EXIT_FAILURE
}

/**
 * Signals the child's whole process group. Both children are launchers that run
 * the real work in a grandchild, and a signal delivered to the launcher alone
 * leaves a Node process behind, still holding the port.
 */
function stop(child: ChildProcess): void {
  const { pid } = child
  if (pid === undefined) return

  try {
    process.kill(-pid, "SIGTERM")
  } catch {
    child.kill("SIGTERM")
  }
}

function shutdown(exitCode: number): void {
  if (shuttingDown) return
  shuttingDown = true
  process.exitCode = exitCode
  for (const child of children) {
    stop(child)
  }
}

function build(): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("pnpm", ["build"], { cwd: projectRoot, stdio: "inherit" })
    child.on("error", reject)
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve()
      } else if (signal !== null) {
        reject(new Error(`pnpm build was killed by ${signal}`))
      } else {
        reject(new Error(`pnpm build exited with code ${String(code)}`))
      }
    })
  })
}

/**
 * The server is spawned directly rather than through `pnpm start`: a signal sent
 * to the package-manager wrapper does not reach Node, which stays up holding the
 * port.
 */
function startServer(): ChildProcess {
  return spawn("./node_modules/.bin/tsx", ["--env-file=.env", "server/main.ts"], {
    cwd: projectRoot,
    stdio: "inherit",
    detached: true,
    env: { ...process.env, NODE_ENV: "production" },
  })
}

/** Echoes cloudflared's log and calls out the public URL the first time it appears. */
function makeTunnelLogReader(): (chunk: Buffer) => void {
  let announced = false

  return (chunk) => {
    const text = chunk.toString()
    process.stderr.write(text)

    if (announced) return
    const match = QUICK_TUNNEL_URL.exec(text)
    if (match === null) return

    announced = true
    process.stdout.write(
      `\n  Room reachable at ${match[0]}\n` +
        `  Hand it out with the ROOM_PASSWORD. The address dies with this command.\n\n`,
    )
  }
}

try {
  await build()
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(EXIT_FAILURE)
}

const server = startServer()
children.add(server)

const tunnel = spawn("cloudflared", ["tunnel", "--url", `http://localhost:${readPort()}`], {
  cwd: projectRoot,
  stdio: ["ignore", "pipe", "pipe"],
  detached: true,
})
children.add(tunnel)

if (tunnel.stdout === null || tunnel.stderr === null) {
  shutdown(EXIT_FAILURE)
  throw new Error("cloudflared was spawned without pipes, so its URL cannot be read")
}

const readTunnelLog = makeTunnelLogReader()
tunnel.stdout.on("data", readTunnelLog)
tunnel.stderr.on("data", readTunnelLog)

server.on("error", (error) => {
  process.stderr.write(`the server failed to start: ${error.message}\n`)
  shutdown(EXIT_FAILURE)
})

tunnel.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "ENOENT") {
    process.stderr.write(`cloudflared is not installed. Get it at ${CLOUDFLARED_DOWNLOAD}\n`)
  } else {
    process.stderr.write(`cloudflared failed to start: ${error.message}\n`)
  }
  shutdown(EXIT_FAILURE)
})

// Half of the pair is useless on its own: a live tunnel in front of a dead
// server serves 502s, and a server with no tunnel is unreachable.
server.on("exit", (code, signal) => shutdown(exitCodeFor(code, signal)))
tunnel.on("exit", (code, signal) => shutdown(exitCodeFor(code, signal)))

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => shutdown(0))
}
