import { useEffect, useState } from "react"
import { type DesktopSource, desktopBridge } from "../desktop"

type Props = {
  onChoose: (source: DesktopSource) => void
  onCancel: () => void
}

type Tab = "screens" | "windows"

/**
 * Chromium prefixes every source id with what it is, and that prefix is the
 * only reliable way to tell a whole screen from a single window.
 */
const SCREEN_ID_PREFIX = "screen:"

const TAB_LABELS: Record<Tab, string> = {
  screens: "Telas",
  windows: "Janelas",
}

function isScreen(source: DesktopSource): boolean {
  return source.id.startsWith(SCREEN_ID_PREFIX)
}

const tabClassName = "rounded-md px-3 py-1.5 text-sm transition"
const activeTabClassName = "bg-surface-raised text-ink"
const idleTabClassName = "text-ink-muted hover:text-ink"

/**
 * Picks what to broadcast, from the app's own list.
 *
 * Only reachable where a list can exist at all. Under the Wayland portal the
 * system owns this choice, no program may enumerate another's windows, and the
 * broadcast button raises the portal directly instead of opening this.
 */
export function SourcePicker({ onChoose, onCancel }: Props) {
  const [sources, setSources] = useState<DesktopSource[] | null>(null)
  const [tab, setTab] = useState<Tab>("screens")
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const bridge = desktopBridge()
    if (bridge === null) return undefined

    let cancelled = false
    bridge
      .sources()
      .then((listed) => {
        if (cancelled) return
        setSources(listed)
        // Opening on an empty tab looks like a failure. Whichever tab has
        // something wins, and screens win ties — that is what someone playing a
        // full-screen game wants.
        if (!listed.some(isScreen)) setTab("windows")
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        setError(cause instanceof Error ? cause.message : "não deu para listar as telas")
      })

    return () => {
      cancelled = true
    }
  }, [])

  const shown = (sources ?? []).filter((source) =>
    tab === "screens" ? isScreen(source) : !isScreen(source),
  )

  return (
    <div
      role="dialog"
      aria-label="escolher o que transmitir"
      className="absolute inset-0 z-10 flex items-center justify-center bg-black/70 p-6"
    >
      <div className="flex max-h-full w-full max-w-3xl flex-col gap-4 rounded-2xl border border-edge bg-surface p-5">
        <div className="flex items-center justify-between">
          <div className="flex gap-1">
            {(Object.keys(TAB_LABELS) as Tab[]).map((candidate) => (
              <button
                key={candidate}
                type="button"
                onClick={() => setTab(candidate)}
                className={`${tabClassName} ${tab === candidate ? activeTabClassName : idleTabClassName}`}
              >
                {TAB_LABELS[candidate]}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-2 py-1 text-sm text-ink-muted transition hover:bg-surface-raised hover:text-ink"
          >
            Cancelar
          </button>
        </div>

        {error !== null && <p className="font-mono text-xs text-red-400">{error}</p>}

        {sources === null && error === null && (
          <p className="text-sm text-ink-muted">procurando telas e janelas…</p>
        )}

        {sources !== null && shown.length === 0 && (
          <p className="text-sm text-ink-muted">
            Nada em {TAB_LABELS[tab].toLowerCase()}. Abra o jogo antes de transmitir.
          </p>
        )}

        <div className="grid gap-3 overflow-y-auto [grid-template-columns:repeat(auto-fill,minmax(14rem,1fr))]">
          {shown.map((source) => (
            <button
              key={source.id}
              type="button"
              onClick={() => onChoose(source)}
              className="flex flex-col gap-2 rounded-lg border border-edge p-2 text-left transition hover:bg-surface-raised"
            >
              <img
                src={source.thumbnail}
                alt=""
                className="aspect-video w-full rounded bg-black object-contain"
              />
              <span className="truncate text-xs text-ink-muted" title={source.name}>
                {source.name}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
