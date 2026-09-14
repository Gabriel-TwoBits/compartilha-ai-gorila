import { open, stat } from "node:fs/promises"
import { basename, join, resolve } from "node:path"
import { randomUUID } from "node:crypto"
import { serve } from "@hono/node-server"
import { serveStatic } from "@hono/node-server/serve-static"
import { Hono } from "hono"
import { deleteCookie, setCookie } from "hono/cookie"
import { routePartyTracksRequest } from "partytracks/server"
import { normalizeNickname } from "@shared/protocol"
import { multipartBody, parseRangeHeader, rangeLength } from "./ranges"
import { env } from "./env"
import { pruneIceServers } from "./iceServers"
import { type AppEnv, requireSession } from "./middleware"
import { SESSION_COOKIE_NAME, checkPassword, sessionCookieOptions, signSession } from "./session"
import { signalingRoute, startHeartbeat, webSocketServer } from "./signaling"

const CLIENT_BUILD_DIR = "./dist/client"

/** Vite writes every hashed asset under this name. */
const ASSETS_SEGMENT = "/assets/"

const SECONDS_PER_YEAR = 60 * 60 * 24 * 365

/**
 * How the client is cached, which is what decides whether a deploy is ever seen.
 *
 * Vite stamps a content hash into each asset's file name, so those can be kept
 * for good: changed content arrives under a different name and the old one is
 * simply never asked for again. `index.html` is the one that cannot be kept —
 * it is what says which names are current.
 *
 * Saying nothing is not neutral. A response carrying no `Cache-Control` is
 * cached on a heuristic instead: a tenth of the age since it was last modified,
 * which for a build a few days old is hours of serving the previous room to
 * everyone who already had it, with no reload short of a forced one able to ask
 * for the new one.
 */
const IMMUTABLE_CACHE = `public, max-age=${SECONDS_PER_YEAR}, immutable`
const REVALIDATE_CACHE = "no-cache"

/**
 * Where the desktop app's installers live, and the update feed with them.
 *
 * Outside `dist/` on purpose: Vite builds the client with `emptyOutDir`, so
 * anything dropped in there disappears at the next build — including the
 * installers a release just published.
 */
const RELEASE_DIR = "./release"

/** Public path for the same. Both the first download and every update use it. */
const RELEASE_ROUTE = "/atualiza"

/** What the installers are: opaque bytes, whatever their extension. */
const RELEASE_CONTENT_TYPE = "application/octet-stream"

/** Enough of an upstream error body to identify it, without flooding the log. */
const MAX_LOGGED_BODY_CHARS = 500

const app = new Hono<AppEnv>()

app.post("/api/login", async (c) => {
  const body: unknown = await c.req.json().catch(() => null)
  if (typeof body !== "object" || body === null) {
    return c.json({ error: "invalid_body" }, 400)
  }

  const { nickname: rawNickname, password } = body as Record<string, unknown>

  const nickname = normalizeNickname(rawNickname)
  if (nickname === null) {
    return c.json({ error: "invalid_nickname" }, 400)
  }

  // The type check has to come first: hashing a non-string would throw.
  if (typeof password !== "string" || !checkPassword(password)) {
    return c.json({ error: "invalid_password" }, 401)
  }

  setCookie(c, SESSION_COOKIE_NAME, signSession(nickname), sessionCookieOptions)
  return c.json({ nickname })
})

app.post("/api/logout", (c) => {
  deleteCookie(c, SESSION_COOKIE_NAME, { path: "/" })
  return c.json({ ok: true })
})

/** Lets the client skip the login screen when a valid cookie is already present. */
app.get("/api/me", requireSession, (c) => c.json({ nickname: c.get("nickname") }))

/**
 * Replaces the streaming request body with the bytes it carries.
 *
 * `routePartyTracksRequest` hands `request.body` straight to `fetch`. On Node
 * that body is a `ReadableStream`, and undici rejects a streaming body unless
 * `duplex: "half"` is set — a flag the helper never sets, because it is written
 * against Cloudflare Workers, where streaming a body needs none. Every proxied
 * call that carries a payload would otherwise fail with a `TypeError` before
 * reaching the SFU: `/sessions/new` has no body and succeeds, `/tracks/new`
 * does and does not, which reads as a broadcast that publishes nothing.
 *
 * Only the properties the helper reads are supplied. `headers` is the real one,
 * so the session cookie lookup it performs in production still sees it.
 */
async function withBufferedBody(request: Request): Promise<Request> {
  if (request.body === null) return request

  const body = new Uint8Array(await request.arrayBuffer())

  // The helper forwards the body only when it can see a length, and a buffered
  // body is no longer chunked.
  const headers = new Headers(request.headers)
  headers.set("Content-Length", String(body.byteLength))
  headers.delete("Transfer-Encoding")

  const buffered = { url: request.url, method: request.method, headers, body }
  return buffered as unknown as Request
}

/**
 * Reports an SFU call the SFU itself rejected.
 *
 * Nothing else does: the client retries a failed push with backoff rather than
 * failing it, so a track the SFU refuses surfaces as a broadcast that quietly
 * never starts. The body carries the reason.
 */
async function logUpstreamFailure(path: string, response: Response): Promise<void> {
  const body = await response
    .clone()
    .text()
    .catch(() => "<unreadable body>")

  console.error(
    `SFU ${path} -> ${response.status} ${response.statusText}: ` +
      body.slice(0, MAX_LOGGED_BODY_CHARS),
  )
}

/**
 * Drops the encoding headers from a proxied SFU response.
 *
 * `fetch` decompresses an upstream body transparently but leaves
 * `Content-Encoding` on the response, so relaying it verbatim hands the browser
 * plain JSON still labelled as gzip. The browser fails to decode it, partytracks
 * retries the offer against a session that already has one, and the SFU answers
 * "Session is not ready yet" — a broadcast that captures the screen and
 * publishes nothing. `Content-Length` goes too: it counted compressed bytes.
 */
function withDecodedBodyHeaders(response: Response): Response {
  if (!response.headers.has("Content-Encoding")) return response

  const headers = new Headers(response.headers)
  headers.delete("Content-Encoding")
  headers.delete("Content-Length")

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

/** The only SFU route whose body this server rewrites. See `iceServers.ts`. */
const ICE_SERVERS_PATH = "/partytracks/generate-ice-servers"

/**
 * Removes the ICE servers the browser cannot use from a proxied answer.
 *
 * A single STUN URL that never answers stops the whole gathering rather than
 * being skipped, so one unusable entry costs every candidate — and every
 * broadcast with it. A body that cannot be parsed is relayed untouched: it is
 * about to be handed to the browser, and a guess would be worse than the
 * original.
 */
async function withUsableIceServers(response: Response): Promise<Response> {
  if (!response.ok) return response

  const original = await response.clone().text()

  let parsed: unknown
  try {
    parsed = JSON.parse(original)
  } catch {
    return response
  }

  const headers = new Headers(response.headers)
  headers.delete("Content-Length")

  return new Response(JSON.stringify(pruneIceServers(parsed)), {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

/**
 * Proxy to the Cloudflare Realtime SFU. This exists so `SFU_APP_TOKEN` stays on
 * the server, and it sits behind the session for the same reason.
 */
app.all("/partytracks/*", requireSession, async (c) => {
  // Spread rather than passed as `undefined`: `exactOptionalPropertyTypes`
  // treats an explicit `undefined` as a different thing from an absent key, and
  // the helper falls back to STUN only on the absent one.
  const turn =
    env.turn === null
      ? {}
      : { turnServerAppId: env.turn.appId, turnServerAppToken: env.turn.appToken }

  const response = await routePartyTracksRequest({
    appId: env.sfuAppId,
    token: env.sfuAppToken,
    ...turn,
    request: await withBufferedBody(c.req.raw),
  })

  if (!response.ok) await logUpstreamFailure(c.req.path, response)

  const decoded = withDecodedBodyHeaders(response)
  if (c.req.path === ICE_SERVERS_PATH) return withUsableIceServers(decoded)
  return decoded
})

app.get("/ws", requireSession, signalingRoute)

/**
 * Serves a request asking for several byte ranges at once.
 *
 * The desktop updater fetches a new version differentially: it reads the
 * `.blockmap`, works out which blocks changed, and asks for exactly those in
 * one request. `@hono/node-server`'s static handler answers that with the whole
 * file under a `206` status, the updater rejects the shape, and a 165 KB update
 * becomes a 122 MB one — per person, every release, across a tunnel that asks
 * for moderation with heavy traffic.
 *
 * Only multi-range requests come through here. A single range the static
 * handler already gets right, and everything else is a plain download.
 */
async function serveMultiRange(path: string, rangeHeader: string): Promise<Response | null> {
  // The route is public, so the path is untrusted: resolve it and refuse
  // anything that climbs out of the release directory.
  const root = resolve(RELEASE_DIR)
  const file = resolve(join(root, basename(path)))
  if (!file.startsWith(root)) return null

  const info = await stat(file).catch(() => null)
  if (info === null || !info.isFile()) return null

  const ranges = parseRangeHeader(rangeHeader, info.size)
  if (ranges === null || ranges.length < 2) return null

  const handle = await open(file, "r").catch(() => null)
  if (handle === null) return null

  try {
    const parts = []
    for (const range of ranges) {
      const bytes = new Uint8Array(rangeLength(range))
      await handle.read(bytes, 0, bytes.byteLength, range.start)
      parts.push({ range, bytes })
    }

    const boundary = randomUUID()
    const body = multipartBody(parts, info.size, RELEASE_CONTENT_TYPE, boundary)

    return new Response(body, {
      status: 206,
      headers: {
        "Content-Type": `multipart/byteranges; boundary=${boundary}`,
        "Content-Length": String(body.byteLength),
        "Accept-Ranges": "bytes",
      },
    })
  } finally {
    await handle.close()
  }
}

/**
 * Installers and the update feed, served to anyone.
 *
 * No session in front: the first download happens before anybody has an
 * account of any kind, and what is behind it is a binary the whole room is
 * meant to have. The room itself stays gated by the password.
 */
app.use(`${RELEASE_ROUTE}/*`, async (c, next) => {
  const rangeHeader = c.req.header("Range")
  if (rangeHeader === undefined) return next()

  const response = await serveMultiRange(c.req.path.slice(RELEASE_ROUTE.length), rangeHeader)
  // Anything this cannot answer falls through to the static handler, which
  // covers a single range and the plain download.
  if (response === null) return next()
  return response
})

app.use(
  `${RELEASE_ROUTE}/*`,
  serveStatic({
    root: RELEASE_DIR,
    rewriteRequestPath: (path) => path.slice(RELEASE_ROUTE.length),
  }),
)

// In development Vite serves the UI and proxies these routes here instead.
if (env.isProduction) {
  app.use(
    "/*",
    serveStatic({
      root: CLIENT_BUILD_DIR,
      onFound: (path, c) => {
        c.header("Cache-Control", path.includes(ASSETS_SEGMENT) ? IMMUTABLE_CACHE : REVALIDATE_CACHE)
      },
    }),
  )
}

serve(
  {
    fetch: app.fetch,
    port: env.port,
    websocket: { server: webSocketServer },
  },
  (info) => {
    console.log(`CompartilhaAiGorila server listening on http://localhost:${info.port}`)
  },
)

startHeartbeat()
