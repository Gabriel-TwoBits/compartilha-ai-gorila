/** Thin wrapper over the session endpoints on our own server. */

export type LoginFailure = "invalid_nickname" | "invalid_password" | "unavailable"

export type LoginResult = { ok: true; nickname: string } | { ok: false; reason: LoginFailure }

function isKnownFailure(value: unknown): value is Exclude<LoginFailure, "unavailable"> {
  return value === "invalid_nickname" || value === "invalid_password"
}

export async function login(nickname: string, password: string): Promise<LoginResult> {
  let response: Response
  try {
    response = await fetch("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nickname, password }),
    })
  } catch {
    return { ok: false, reason: "unavailable" }
  }

  const body: unknown = await response.json().catch(() => null)

  if (response.ok) {
    const returned = (body as { nickname?: unknown } | null)?.nickname
    // The server normalizes the nickname, so its answer wins over what was typed.
    if (typeof returned !== "string") return { ok: false, reason: "unavailable" }
    return { ok: true, nickname: returned }
  }

  const error = (body as { error?: unknown } | null)?.error
  if (isKnownFailure(error)) return { ok: false, reason: error }
  return { ok: false, reason: "unavailable" }
}

export async function logout(): Promise<void> {
  await fetch("/api/logout", { method: "POST" }).catch(() => undefined)
}

/** Returns the nickname of an existing session, or `null` if there is none. */
export async function currentNickname(): Promise<string | null> {
  try {
    const response = await fetch("/api/me")
    if (!response.ok) return null
    const body: unknown = await response.json()
    const nickname = (body as { nickname?: unknown }).nickname
    return typeof nickname === "string" ? nickname : null
  } catch {
    return null
  }
}
