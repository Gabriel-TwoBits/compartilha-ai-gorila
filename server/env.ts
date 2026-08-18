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

function readPort(): number {
  const raw = process.env.PORT?.trim()
  if (raw === undefined || raw.length === 0) return DEFAULT_PORT

  const port = Number(raw)
  if (!Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) {
    throw new Error(`PORT must be an integer between ${MIN_PORT} and ${MAX_PORT}, got "${raw}".`)
  }
  return port
}

const required = readRequired()

export const env = Object.freeze({
  port: readPort(),
  sfuAppId: required.SFU_APP_ID,
  sfuAppToken: required.SFU_APP_TOKEN,
  roomPassword: required.ROOM_PASSWORD,
  sessionSecret: required.SESSION_SECRET,
  isProduction: process.env.NODE_ENV === "production",
})
