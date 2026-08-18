import { useEffect, useState } from "react"
import { currentNickname } from "./api"
import { LoginScreen } from "./components/LoginScreen"
import { RoomScreen } from "./components/RoomScreen"

type Session = { status: "checking" } | { status: "out" } | { status: "in"; nickname: string }

export function App() {
  const [session, setSession] = useState<Session>({ status: "checking" })

  // A valid cookie survives a reload, so the login screen is skipped when the
  // server still recognizes us.
  useEffect(() => {
    let cancelled = false

    currentNickname().then((nickname) => {
      if (cancelled) return
      setSession(nickname === null ? { status: "out" } : { status: "in", nickname })
    })

    return () => {
      cancelled = true
    }
  }, [])

  switch (session.status) {
    case "checking":
      return <div className="flex h-full items-center justify-center text-ink-muted">…</div>
    case "out":
      return <LoginScreen onLogin={(nickname) => setSession({ status: "in", nickname })} />
    case "in":
      return (
        <RoomScreen nickname={session.nickname} onLogout={() => setSession({ status: "out" })} />
      )
    default:
      // Unreachable: every Session variant is handled above.
      return null
  }
}
