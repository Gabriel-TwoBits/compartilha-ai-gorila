/**
 * Environment, read and validated once at boot.
 *
 * Every consumer imports the frozen object below instead of reaching into
 * `process.env`, so a missing variable is a startup failure with a clear message
 * rather than an `undefined` that surfaces as a confusing 500 an hour later.
 */

const DEFAULT_PORT = 8787
const MIN_PORT = 1
const MAX_PORT = 65535

const REQUIRED_KEYS = ["SFU_APP_ID", "SFU_APP_TOKEN", "ROOM_PASSWORD", "SESSION_SECRET"] as const

type RequiredKey = (typeof REQUIRED_KEYS)[number]

function readRequired(): Record<RequiredKey, string> {
  const values: Partial<Record<RequiredKey, string>> = {}
  const missing: string[] = []

  for (const key of REQUIRED_KEYS) {
    const value = process.env[key]?.trim()
    if (value === undefined || value.length === 0) {
      missing.push(key)
      continue
    }
    values[key] = value
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}. ` +
        `Copy .env.example to .env and fill them in.`,
    )
  }

  return values as Record<RequiredKey, string>
}

/**
 * Cloudflare TURN credentials, or `null` when TURN is not set up.
 *
 * Without them the browser is handed STUN only, which is enough whenever a
 * direct path to the SFU exists and useless when it does not — a symmetric NAT
 * or a network that drops outbound UDP leaves the peer connection stuck in
 * `failed`. They are a separate Realtime product from the SFU app, hence a
 * second pair of credentials.
 */
function readTurn(): { appId: string; appToken: string } | null {
  const appId = process.env.TURN_APP_ID?.trim()
  const appToken = process.env.TURN_APP_TOKEN?.trim()

  if (appId === undefined || appId.length === 0) {
    if (appToken !== undefined && appToken.length > 0) {
      throw new Error("TURN_APP_TOKEN is set without TURN_APP_ID; set both or neither.")
    }
    return null
  }

  if (appToken === undefined || appToken.length === 0) {
    throw new Error("TURN_APP_ID is set without TURN_APP_TOKEN; set both or neither.")
  }

  return { appId, appToken }
}

function readPort(): number {
  const raw = process.env.PORT?.trim()
  if (raw === undefined || raw.length === 0) return DEFAULT_PORT

  const port = Number(raw)
  if (!Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) {
    throw new Error(`PORT must be an integer between ${MIN_PORT} and ${MAX_PORT}, got "${raw}".`)
  }
  return port
}

/**
 * Whether the session cookie is marked `Secure`.
 *
 * It has to follow the transport, not the build: a browser silently drops a
 * `Secure` cookie served over plain http, so a production build exercised on
 * localhost would appear to accept the password and then never log anyone in.
 * Defaults to on in production, which is where the app is behind TLS.
 */
function readSecureCookies(isProduction: boolean): boolean {
  const raw = process.env.SECURE_COOKIES?.trim().toLowerCase()
  if (raw === undefined || raw.length === 0) return isProduction
  if (raw === "true") return true
  if (raw === "false") return false
  throw new Error(`SECURE_COOKIES must be "true" or "false", got "${raw}".`)
}

const required = readRequired()
const isProduction = process.env.NODE_ENV === "production"

export const env = Object.freeze({
  port: readPort(),
  sfuAppId: required.SFU_APP_ID,
  sfuAppToken: required.SFU_APP_TOKEN,
  turn: readTurn(),
  roomPassword: required.ROOM_PASSWORD,
  sessionSecret: required.SESSION_SECRET,
  isProduction,
  secureCookies: readSecureCookies(isProduction),
})
