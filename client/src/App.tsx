import { useEffect, useState } from "react"
import { currentNickname } from "./api"
import { LoginScreen } from "./components/LoginScreen"
import { UpdateBanner } from "./components/UpdateBanner"
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

  // The banner sits outside the switch on purpose: whoever cannot get in is
  // exactly who most needs the new version.
  return (
    <div className="flex h-full flex-col">
      <UpdateBanner />
      <div className="min-h-0 flex-1">{screen(session, setSession)}</div>
    </div>
  )
}

function screen(session: Session, setSession: (next: Session) => void) {
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
