import { createHash, createHmac, timingSafeEqual } from "node:crypto"
import { env } from "./env"

/**
 * Password check and session cookie for the single shared room.
 *
 * The room has one password and no user accounts, so a session only ever needs
 * to carry a nickname. It is signed rather than stored: with no server-side
 * session table there is nothing to expire, evict or keep in sync.
 */

export const SESSION_COOKIE_NAME = "cag_session"

const MILLISECONDS_PER_SECOND = 1000
const SECONDS_PER_DAY = 60 * 60 * 24
const SESSION_MAX_AGE_SECONDS = 7 * SECONDS_PER_DAY

const TOKEN_SEPARATOR = "."

const expectedPasswordDigest = createHash("sha256").update(env.roomPassword).digest()

/**
 * Compares SHA-256 digests rather than the raw bytes: `timingSafeEqual` throws
 * on a length mismatch, and that throw would itself leak the password length.
 */
export function checkPassword(candidate: string): boolean {
  const candidateDigest = createHash("sha256").update(candidate).digest()
  return timingSafeEqual(candidateDigest, expectedPasswordDigest)
}

type Payload = {
  /** nickname */
  n: string
  /** issued at, in milliseconds since the epoch */
  t: number
}

function sign(encodedPayload: string): string {
  return createHmac("sha256", env.sessionSecret).update(encodedPayload).digest("base64url")
}

export function signSession(nickname: string): string {
  const payload: Payload = { n: nickname, t: Date.now() }
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")
  return `${encodedPayload}${TOKEN_SEPARATOR}${sign(encodedPayload)}`
}

function signatureMatches(encodedPayload: string, signature: string): boolean {
  const expected = Buffer.from(sign(encodedPayload), "utf8")
  const actual = Buffer.from(signature, "utf8")
  if (expected.length !== actual.length) return false
  return timingSafeEqual(expected, actual)
}

/**
 * Returns the nickname carried by a valid, unexpired token, or `null`. Every
 * failure mode collapses to `null` — a caller should never have to tell a forged
 * token from a malformed one.
 */
export function verifySession(token: string | undefined): { nickname: string } | null {
  if (token === undefined) return null

  const parts = token.split(TOKEN_SEPARATOR)
  if (parts.length !== 2) return null
  const [encodedPayload, signature] = parts
  if (encodedPayload === undefined || signature === undefined) return null
  if (!signatureMatches(encodedPayload, signature)) return null

  let payload: unknown
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"))
  } catch {
    return null
  }

  if (typeof payload !== "object" || payload === null) return null
  const { n, t } = payload as Partial<Payload>
  if (typeof n !== "string" || n.length === 0) return null
  if (typeof t !== "number" || !Number.isFinite(t)) return null

  const ageSeconds = (Date.now() - t) / MILLISECONDS_PER_SECOND
  if (ageSeconds < 0 || ageSeconds > SESSION_MAX_AGE_SECONDS) return null

  return { nickname: n }
}

/**
 * Cookie attributes. `Secure` is tied to production because the browser drops a
 * `Secure` cookie served over plain http, which is exactly how this runs on
 * localhost during development.
 */
export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "Lax",
  path: "/",
  maxAge: SESSION_MAX_AGE_SECONDS,
  secure: env.isProduction,
} as const

/**
 * Reads the session cookie straight off a raw `Cookie` header. The WebSocket
 * upgrade never reaches Hono, so it cannot use Hono's cookie helpers.
 */
export function readSessionCookie(cookieHeader: string | undefined): string | undefined {
  if (cookieHeader === undefined) return undefined

  for (const pair of cookieHeader.split(";")) {
    const separatorIndex = pair.indexOf("=")
    if (separatorIndex === -1) continue
    const name = pair.slice(0, separatorIndex).trim()
    if (name !== SESSION_COOKIE_NAME) continue
    return decodeURIComponent(pair.slice(separatorIndex + 1).trim())
  }

  return undefined
}
