/**
 * Pruning the ICE server list the SFU hands out.
 *
 * Cloudflare offers its STUN server on two ports, 3478 and 53, the second being
 * a way through networks that block the first. Chromium never gets an answer
 * from the one on port 53 — and, worse, a URL that hangs stops the whole
 * gathering rather than being skipped, so no public candidate is ever found and
 * every connection ends in `ICE failed`.
 *
 * Measured on Linux with Electron 44 and with the browser, against
 * `stun.cloudflare.com`:
 *
 *   port 3478 alone .................. srflx candidate in under a second
 *   port 53 alone .................... nothing, gathering never completes
 *   both in one entry ................ nothing
 *   both as two separate entries ..... nothing
 *
 * Raw UDP to that same host and port answers in 21 ms from the same machine, so
 * the network delivers it and the browser is what declines to use it.
 *
 * The cost of dropping it is the fallback it was there for: someone behind a
 * network that blocks 3478 now needs TURN, which is the answer for that case
 * anyway.
 */

/** Ports whose STUN URLs never produce a candidate, and poison the ones that would. */
const UNUSABLE_PORTS = [53]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Whether a URL should be handed to the browser.
 *
 * Parsed by hand rather than with `URL`: the `stun:` and `turn:` schemes are
 * not special-cased by it, so the port lands in the pathname and there is
 * nothing to read `port` from.
 *
 * The query has to come off first. A TURN URL carries one —
 * `turn:host:3478?transport=udp` — and reading the last colon-separated piece
 * whole yields `3478?transport=udp`, which is not a number, so every TURN URL
 * would pass unexamined. Including one on port 53, which is the case this
 * module exists for.
 */
function isUsableUrl(url: unknown): boolean {
  if (typeof url !== "string") return false

  const withoutQuery = url.split("?")[0] ?? url
  const port = Number(withoutQuery.split(":").pop())
  if (!Number.isInteger(port)) return true

  return !UNUSABLE_PORTS.includes(port)
}

function pruneServer(server: unknown): Record<string, unknown> | null {
  if (!isRecord(server)) return null

  const { urls } = server

  if (typeof urls === "string") {
    return isUsableUrl(urls) ? server : null
  }

  if (!Array.isArray(urls)) return server

  const usable = urls.filter(isUsableUrl)
  if (usable.length === 0) return null

  return { ...server, urls: usable }
}

/**
 * Returns the body with every unusable URL removed, leaving anything it does
 * not recognise untouched. This sits in front of a response the browser is
 * about to act on, so a shape we cannot parse has to pass through rather than
 * become an empty list.
 */
export function pruneIceServers(body: unknown): unknown {
  if (!isRecord(body)) return body

  const { iceServers } = body
  if (!Array.isArray(iceServers)) return body

  const pruned = iceServers
    .map(pruneServer)
    .filter((server): server is Record<string, unknown> => server !== null)

  return { ...body, iceServers: pruned }
}
