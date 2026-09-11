import { useEffect, useRef } from "react"

type Props = {
  /** The audio going out, or `null` when the broadcast carries none. */
  track: MediaStreamTrack | null
}

const FFT_SIZE = 1024

/**
 * Loudest RMS the bar treats as full.
 *
 * Well below 1: an RMS of 1 is a square wave at full scale, and real audio never
 * approaches it. A bar that only twitches answers nothing.
 */
const FULL_SCALE_RMS = 0.3

function rms(samples: Float32Array): number {
  let sum = 0
  for (const sample of samples) sum += sample * sample
  return Math.sqrt(sum / samples.length)
}

/**
 * Shows how loud the broadcast's audio actually is, right now.
 *
 * This is not decoration. "Is the sound going out?" and, once per-process
 * capture exists, "did I tick the right application?" have no honest answer
 * except watching the bar move while the game makes noise — and the alternative
 * is finding out when a friend says they hear nothing.
 *
 * It writes to `style` from inside a `requestAnimationFrame` loop rather than
 * going through React state, which would re-render the whole room sixty times a
 * second. The raw value is mirrored on `data-level` so a test can read it.
 */
export function LevelMeter({ track }: Props) {
  const fillRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const fill = fillRef.current
    if (track === null || fill === null) {
      if (fill !== null) {
        fill.style.transform = "scaleX(0)"
        fill.dataset.level = "0"
      }
      return undefined
    }

    let context: AudioContext
    try {
      context = new AudioContext()
    } catch {
      // No Web Audio means no meter, and a room that still works.
      return undefined
    }

    // The source needs a stream, and the track we are handed belongs to one we
    // do not own — wrapping it keeps this analysis independent of whatever else
    // is reading the same track.
    const source = context.createMediaStreamSource(new MediaStream([track]))
    const analyser = context.createAnalyser()
    analyser.fftSize = FFT_SIZE
    source.connect(analyser)

    const samples = new Float32Array(analyser.fftSize)
    let frame = 0

    // An arrow function, not a declaration: a hoisted `function draw` is
    // analysed at the top of the block, before `fill` has been checked for null.
    const draw = (): void => {
      analyser.getFloatTimeDomainData(samples)
      const level = rms(samples)
      const ratio = Math.min(level / FULL_SCALE_RMS, 1)

      // `scaleX` rather than `width`: a transform is composited, so this costs
      // no layout on any of the sixty frames a second it runs for.
      fill.style.transform = `scaleX(${ratio})`
      fill.dataset.level = level.toFixed(4)

      frame = requestAnimationFrame(draw)
    }

    frame = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(frame)
      source.disconnect()
      analyser.disconnect()
      void context.close().catch(() => undefined)
    }
  }, [track])

  return (
    <div
      role="meter"
      aria-label="nível do áudio que está saindo"
      title={
        track === null
          ? "A transmissão não está levando áudio"
          : "Se a barra não mexe quando o jogo faz barulho, a fonte escolhida está errada"
      }
      className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-raised"
    >
      <div
        ref={fillRef}
        className="h-full w-full origin-left bg-accent"
        style={{ transform: "scaleX(0)" }}
      />
    </div>
  )
}
