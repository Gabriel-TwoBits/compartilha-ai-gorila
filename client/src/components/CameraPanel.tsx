import { useEffect, useRef, useState } from "react"
import { useObservableAsValue } from "partytracks/react"
import { cameraConstraints, cameraId$, cameraInputs$, revealCameras, selectCamera } from "../camera"
import { mediaDevices, stopStream } from "../mediaInputs"

const optionClassName = "w-full truncate rounded-lg border px-3 py-2 text-left text-sm transition"
const chosenClassName = "border-accent bg-surface-raised text-ink"
const idleClassName = "border-edge text-ink-muted hover:bg-surface-raised hover:text-ink"

const buttonClassName =
  "self-start rounded-md border border-edge bg-surface-raised px-2 py-1.5 text-xs text-ink transition hover:brightness-110"

/**
 * What the chosen camera sees right now. Without it a person only finds out
 * they picked the wrong one — or left the shutter closed — when somebody says so.
 *
 * Mirrored, as every video app does: a person expects to see themselves as in
 * a mirror. Whoever watches gets the real picture.
 */
function CameraPreview({ deviceId }: { deviceId: string }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let stream: MediaStream | null = null
    let cancelled = false
    setFailed(false)

    mediaDevices()
      .getUserMedia({ audio: false, video: cameraConstraints(deviceId) })
      .then((acquired) => {
        // The panel can close while the camera is still opening; without this
        // its LED stays on with nothing on screen.
        if (cancelled) {
          stopStream(acquired)
          return
        }
        stream = acquired
        const element = videoRef.current
        if (element !== null) element.srcObject = acquired
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })

    return () => {
      cancelled = true
      if (stream !== null) stopStream(stream)
    }
  }, [deviceId])

  if (failed) {
    return (
      <p className="flex aspect-video w-56 items-center justify-center rounded-lg border border-edge px-3 text-center text-xs text-ink-muted">
        não consegui abrir essa câmera
      </p>
    )
  }

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted
      className="aspect-video w-56 -scale-x-100 rounded-lg border border-edge bg-black object-cover"
    />
  )
}

/**
 * Picks which camera the broadcast uses, with a preview of it.
 *
 * Nothing asks for the camera until the person clicks: asking lights the
 * webcam's LED, which is alarming when nobody meant to turn it on.
 */
export function CameraPanel() {
  const devices = useObservableAsValue(cameraInputs$, [])
  const selected = useObservableAsValue(cameraId$, null)
  const [error, setError] = useState<string | null>(null)

  // Before a grant the browser still lists cameras, but with blank ids and
  // labels: enough to know one is there, useless for telling them apart.
  const named = devices.filter((device) => device.deviceId !== "" && device.label !== "")

  function handleReveal(): void {
    setError(null)
    revealCameras().catch((revealError: unknown) => {
      if (!(revealError instanceof Error)) {
        setError("não foi possível listar as câmeras")
      } else if (revealError.name === "NotAllowedError") {
        setError("o acesso à câmera foi bloqueado; libere nas permissões do navegador")
      } else if (revealError.name === "NotFoundError") {
        setError("nenhuma câmera encontrada")
      } else {
        setError(revealError.message)
      }
    })
  }

  if (named.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-xs text-ink-muted">
          Escolha qual câmera vai junto na transmissão.
        </p>
        <button type="button" onClick={handleReveal} className={buttonClassName}>
          Ver câmeras
        </button>
        {error !== null && <p className="font-mono text-xs text-red-400">{error}</p>}
      </div>
    )
  }

  // With no choice saved, the system default is used, and that is the first
  // one listed. Marking it says so; leaving every option unmarked would read as
  // no camera being in use at all. A saved choice that is unplugged marks
  // nothing, since the capture asks for that exact device and would fail.
  const chosen =
    selected === null ? named[0] : named.find((device) => device.deviceId === selected)

  return (
    <div className="flex flex-wrap items-start gap-4">
      <div className="flex min-w-48 flex-1 flex-col gap-2">
        {named.map((device) => (
          <button
            key={device.deviceId}
            type="button"
            onClick={() => selectCamera(device.deviceId)}
            className={`${optionClassName} ${device === chosen ? chosenClassName : idleClassName}`}
          >
            {device.label}
          </button>
        ))}
        {chosen === undefined && (
          <p className="text-xs text-ink-muted">
            A câmera escolhida antes não está conectada; escolha outra.
          </p>
        )}
      </div>
      {chosen !== undefined && <CameraPreview deviceId={chosen.deviceId} />}
    </div>
  )
}
