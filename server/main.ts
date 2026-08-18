import { serve } from "@hono/node-server"
import { serveStatic } from "@hono/node-server/serve-static"
import { Hono } from "hono"
import { deleteCookie, setCookie } from "hono/cookie"
import { routePartyTracksRequest } from "partytracks/server"
import { normalizeNickname } from "@shared/protocol"
import { env } from "./env"
import { type AppEnv, requireSession } from "./middleware"
import { SESSION_COOKIE_NAME, checkPassword, sessionCookieOptions, signSession } from "./session"
import { signalingRoute, startHeartbeat, webSocketServer } from "./signaling"

const CLIENT_BUILD_DIR = "./dist/client"

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

/**
 * Proxy to the Cloudflare Realtime SFU. This exists so `SFU_APP_TOKEN` stays on
 * the server, and it sits behind the session for the same reason.
 */
app.all("/partytracks/*", requireSession, async (c) => {
  const response = await routePartyTracksRequest({
    appId: env.sfuAppId,
    token: env.sfuAppToken,
    request: await withBufferedBody(c.req.raw),
  })

  if (!response.ok) await logUpstreamFailure(c.req.path, response)
  return withDecodedBodyHeaders(response)
})

app.get("/ws", requireSession, signalingRoute)

// In development Vite serves the UI and proxies these routes here instead.
if (env.isProduction) {
  app.use("/*", serveStatic({ root: CLIENT_BUILD_DIR }))
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
