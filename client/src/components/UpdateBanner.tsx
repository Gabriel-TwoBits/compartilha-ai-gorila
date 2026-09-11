import { useEffect, useState } from "react"
import { type UpdateState, desktopBridge } from "../desktop"

/**
 * Offers the version already downloaded, inside the app.
 *
 * Rendered above everything, logged in or not: whoever cannot get in — the
 * address moved, the password changed — is exactly who most needs the new
 * version, and a banner only visible inside the room would never reach them.
 *
 * Nothing shows while the download is still running. An update nobody asked for
 * should not take attention until there is something to decide.
 */
export function UpdateBanner() {
  const [state, setState] = useState<UpdateState | null>(null)

  useEffect(() => {
    const bridge = desktopBridge()
    if (bridge === null) return undefined

    let cancelled = false
    bridge
      .updateState()
      .then((current) => {
        if (!cancelled) setState(current)
      })
      .catch(() => undefined)

    const unsubscribe = bridge.onUpdateState((next) => {
      if (!cancelled) setState(next)
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  if (state === null || state.phase !== "ready") return null

  return (
    <div className="flex items-center justify-between gap-4 border-b border-edge bg-surface-raised px-4 py-2">
      <span className="text-sm">
        Saiu a versão {state.version ?? "nova"}. Ela entra ao reiniciar — ou sozinha, da próxima
        vez que você fechar o app.
      </span>
      <button
        type="button"
        onClick={() => desktopBridge()?.installUpdate()}
        className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-accent-ink transition hover:brightness-110"
      >
        Reiniciar e atualizar
      </button>
    </div>
  )
}
