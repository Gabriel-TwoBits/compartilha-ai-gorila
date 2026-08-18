import { getCookie } from "hono/cookie"
import { createMiddleware } from "hono/factory"
import { SESSION_COOKIE_NAME, verifySession } from "./session"

export type AppEnv = {
  Variables: {
    nickname: string
  }
}

/**
 * Rejects anything without a valid session cookie and exposes the nickname to
 * downstream handlers.
 *
 * This guards the `/partytracks/*` proxy as much as the room itself: without it,
 * anyone who found the URL could open SFU sessions on the account's quota.
 */
export const requireSession = createMiddleware<AppEnv>(async (c, next) => {
  const session = verifySession(getCookie(c, SESSION_COOKIE_NAME))
  if (session === null) {
    return c.json({ error: "unauthorized" }, 401)
  }
  c.set("nickname", session.nickname)
  await next()
  return
})
