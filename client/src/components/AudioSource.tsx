import { type ChangeEvent, useState } from "react"
import { useObservableAsValue } from "partytracks/react"
import {
  audioInputs$,
  audioSourceId$,
  revealAudioInputs,
  selectAudioSource,
} from "../audioSource"
import { SpeakerIcon } from "./Icons"

/** `<option>` values are strings, so the screen capture needs one of its own. */
const SCREEN_AUDIO = ""

const controlClassName =
  "rounded-md border border-edge bg-surface-raised px-2 py-1.5 text-xs text-ink transition hover:brightness-110"

/**
 * Picks where the broadcast's audio comes from.
 *
 * Always on screen, because the platform gives no reliable signal that screen
 * audio is unavailable: on Linux the picker simply hands over a video track and
 * says nothing, and a broadcast that goes out silent looks identical to one
 * whose source is muted.
 */
export function AudioSource() {
  const devices = useObservableAsValue(audioInputs$, [])
  const selected = useObservableAsValue(audioSourceId$, null)
  const [error, setError] = useState<string | null>(null)

  // Before a grant the browser still lists inputs, but with blank ids and
  // labels: enough to know something is there, useless for picking a monitor.
  const named = devices.filter((device) => device.deviceId !== "" && device.label !== "")
  const missing = selected !== null && !named.some((device) => device.deviceId === selected)

  function handleChange(event: ChangeEvent<HTMLSelectElement>): void {
    const { value } = event.target
    selectAudioSource(value === SCREEN_AUDIO ? null : value)
  }

  function handleReveal(): void {
    setError(null)
    revealAudioInputs().catch((permissionError: unknown) => {
      setError(
        permissionError instanceof Error ? permissionError.message : "não foi possível listar",
      )
    })
  }

  return (
    <div className="flex items-center gap-2">
      <label className="flex items-center gap-2 text-xs text-ink-muted">
        <SpeakerIcon />
        <select
          value={selected ?? SCREEN_AUDIO}
          onChange={handleChange}
          aria-label="fonte de áudio da transmissão"
          className={controlClassName}
        >
          <option value={SCREEN_AUDIO}>Áudio da tela</option>
          {named.map((device) => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label}
            </option>
          ))}
          {/* A device can be unplugged while selected; without this the select goes blank. */}
          {missing && <option value={selected}>entrada indisponível</option>}
        </select>
      </label>

      {named.length === 0 && (
        <button
          type="button"
          onClick={handleReveal}
          title="O navegador esconde os nomes das entradas até autorizar a captura uma vez"
          className={controlClassName}
        >
          Listar entradas
        </button>
      )}

      {error !== null && <span className="font-mono text-xs text-red-400">{error}</span>}
    </div>
  )
}
