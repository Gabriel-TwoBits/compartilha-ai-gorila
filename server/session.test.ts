import { afterEach, describe, expect, it, vi } from "vitest"
import { checkPassword, signSession, verifySession } from "./session"

const ROOM_PASSWORD = "test-room-password"

const MILLISECONDS_PER_SECOND = 1000
const SECONDS_PER_DAY = 60 * 60 * 24
const SESSION_MAX_AGE_SECONDS = 7 * SECONDS_PER_DAY

afterEach(() => {
  vi.useRealTimers()
})

describe("checkPassword", () => {
  it("accepts the configured password", () => {
    expect(checkPassword(ROOM_PASSWORD)).toBe(true)
  })

  it("rejects a wrong password", () => {
    expect(checkPassword("nope")).toBe(false)
  })

  it("rejects a password of a different length without throwing", () => {
    expect(checkPassword("")).toBe(false)
    expect(checkPassword(`${ROOM_PASSWORD}x`)).toBe(false)
  })
})

describe("verifySession", () => {
  it("round-trips a nickname", () => {
    expect(verifySession(signSession("carlinhos"))).toEqual({ nickname: "carlinhos" })
  })

  it("rejects a token with a tampered payload", () => {
    const [, signature] = signSession("carlinhos").split(".")
    const forgedPayload = Buffer.from(JSON.stringify({ n: "admin", t: Date.now() })).toString(
      "base64url",
    )
    expect(verifySession(`${forgedPayload}.${signature}`)).toBeNull()
  })

  it("rejects a token with a tampered signature", () => {
    const [payload] = signSession("carlinhos").split(".")
    expect(verifySession(`${payload}.aaaa`)).toBeNull()
  })

  it("rejects malformed and missing tokens", () => {
    expect(verifySession(undefined)).toBeNull()
    expect(verifySession("")).toBeNull()
    expect(verifySession("no-separator")).toBeNull()
    expect(verifySession("too.many.parts")).toBeNull()
  })

  it("rejects a token past its maximum age", () => {
    const token = signSession("carlinhos")
    const oneSecondAfterExpiry = (SESSION_MAX_AGE_SECONDS + 1) * MILLISECONDS_PER_SECOND

    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + oneSecondAfterExpiry)

    expect(verifySession(token)).toBeNull()
  })

  it("rejects a token issued in the future", () => {
    vi.useFakeTimers()
    const oneHourAhead = 60 * 60 * MILLISECONDS_PER_SECOND
    vi.setSystemTime(Date.now() + oneHourAhead)
    const token = signSession("carlinhos")

    vi.useRealTimers()
    expect(verifySession(token)).toBeNull()
  })
})
