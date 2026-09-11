import { useCallback, useEffect, useState } from "react"
import { type AudioApp, type AudioMode, desktopBridge } from "../desktop"
import { PROCESS_AUDIO_SOURCE, selectAudioSource } from "../audioSource"
import { applyAudioMode } from "../processAudio"

/**
 * How often the list of applications is re-read while the panel is open.
 *
 * A pid is born and dies with its program, and on Linux an application only
 * appears once it actually makes a sound — so a game opened after the panel
 * would otherwise never show up.
 */
const REFRESH_MS = 3000

type ModeKind = AudioMode["kind"]

const MODE_LABELS: Record<ModeKind, string> = {
  include: "Só estes aplicativos",
  everything: "Tudo menos o Discord",
  system: "Áudio do sistema inteiro",
  none: "Sem áudio",
}

const MODE_HINTS: Record<ModeKind, string> = {
  include: "Marque o jogo. Só o que estiver marcado vai.",
  everything: "Tudo o que está na lista, e o que você abrir depois.",
  system: "Vai tudo, Discord junto. Só use sabendo por quê.",
  none: "Só imagem.",
}

const MODE_ORDER: ModeKind[] = ["include", "everything", "system", "none"]

const optionClassName = "flex w-full items-start gap-2 rounded-lg border p-3 text-left transition"
const chosenClassName = "border-accent bg-surface-raised"
const idleClassName = "border-edge hover:bg-surface-raised"

/**
 * Picks which applications the broadcast carries, inside the desktop app.
 *
 * The whole reason the app exists: in a browser, system audio is all or
 * nothing, so broadcasting with the call open sends everyone's voices along and
 * the room hears itself with a delay.
 */
export function AudioModes() {
  const [kind, setKind] = useState<ModeKind>("include")
  const [pids, setPids] = useState<number[]>([])
  const [apps, setApps] = useState<AudioApp[]>([])
  const [error, setError] = useState<string | null>(null)

  const apply = useCallback((mode: AudioMode) => {
    // Choosing any mode here also makes the mix the broadcast's audio source:
    // picking applications and then not hearing them would be a trap.
    selectAudioSource(mode.kind === "none" ? null : PROCESS_AUDIO_SOURCE)
    applyAudioMode(mode).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : "não deu para ligar o áudio")
    })
  }, [])

  useEffect(() => {
    const bridge = desktopBridge()
    if (bridge === null) return undefined

    let cancelled = false
    const read = (): void => {
      bridge
        .audioApps()
        .then((listed) => {
          if (!cancelled) setApps(listed)
        })
        .catch(() => undefined)
    }

    read()
    const timer = window.setInterval(read, REFRESH_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  function chooseKind(next: ModeKind): void {
    setKind(next)
    setError(null)
    apply(next === "include" ? { kind: "include", pids } : { kind: next })
  }

  function toggleApp(pid: number): void {
    const next = pids.includes(pid) ? pids.filter((held) => held !== pid) : [...pids, pid]
    setPids(next)
    setError(null)
    if (kind === "include") apply({ kind: "include", pids: next })
  }

  return (
    <div className="flex flex-col gap-3">
      {MODE_ORDER.map((candidate) => (
        <button
          key={candidate}
          type="button"
          onClick={() => chooseKind(candidate)}
          className={`${optionClassName} ${kind === candidate ? chosenClassName : idleClassName}`}
        >
          <span className="mt-0.5 text-xs">{kind === candidate ? "◉" : "○"}</span>
          <span>
            <span className="block text-sm text-ink">{MODE_LABELS[candidate]}</span>
            <span className="block text-xs text-ink-muted">{MODE_HINTS[candidate]}</span>
          </span>
        </button>
      ))}

      {kind === "include" && (
        <div className="flex flex-col gap-1 rounded-lg border border-edge p-2">
          {apps.length === 0 && (
            <p className="p-2 text-xs text-ink-muted">
              Nada tocando som agora. No Linux a lista mostra quem está fazendo barulho — dê um
              tiro no jogo, abra o menu, e ele aparece.
            </p>
          )}
          {apps.map((app) => (
            <label
              key={app.pid}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm transition hover:bg-surface-raised"
            >
              <input
                type="checkbox"
                checked={pids.includes(app.pid)}
                onChange={() => toggleApp(app.pid)}
              />
              <span className="truncate">{app.name}</span>
              <span className="ml-auto font-mono text-xs text-ink-muted">{app.binary}</span>
            </label>
          ))}
        </div>
      )}

      {/* Only this mode captures the device as a whole, ourselves included — so
          it is the only one that can send someone their own audio back. */}
      {kind === "system" && (
        <p className="text-xs text-ink-muted">
          Assistindo alguém nesse modo, o som dela entra na sua transmissão e ela se ouve de volta.
        </p>
      )}

      {error !== null && <p className="font-mono text-xs text-red-400">{error}</p>}
    </div>
  )
}
