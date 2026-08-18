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
 * Proxy to the Cloudflare Realtime SFU. This exists so `SFU_APP_TOKEN` stays on
 * the server, and it sits behind the session for the same reason.
 */
app.all("/partytracks/*", requireSession, (c) =>
  routePartyTracksRequest({
    appId: env.sfuAppId,
    token: env.sfuAppToken,
    request: c.req.raw,
  }),
)

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
