import { Observable } from "rxjs"
import { currentAudioMode } from "./audioMode"
import { type AudioMode, desktopBridge } from "./desktop"

/**
 * Turns the PCM the desktop app captures into a WebRTC audio track.
 *
 * Each capture source becomes an `AudioWorkletNode` feeding one destination, so
 * the mixing is the Web Audio graph's job — it already runs on an exact 48 kHz
 * clock. Mixing on the Node side would need a timer of our own, and a Node
 * timer drifts against that clock.
 *
 * The track is built once and never replaced. Changing mode only changes which
 * nodes feed the mix, so the SDP published to the SFU stays valid and nobody
 * watching sees the video flicker.
 */

const SAMPLE_RATE = 48000
const CHANNELS = 2

/**
 * How much audio the worklet may hold before dropping the oldest.
 *
 * The PCM arrives in bursts while the worklet consumes at an even rate. Past a
 * quarter of a second the delay is more annoying than a gap, so the excess is
 * discarded instead of accumulating into a growing lag.
 */
const MAX_QUEUE_SECONDS = 0.25

const WORKLET_SOURCE = `
const MAX_FRAMES = ${SAMPLE_RATE} * ${MAX_QUEUE_SECONDS}

class Source extends AudioWorkletProcessor {
  constructor() {
    super()
    this.queue = []   // chunks of interleaved Int16 (L, R, L, R...)
    this.offset = 0   // position inside the first chunk, in samples
    this.frames = 0
    this.port.onmessage = (event) => {
      const pcm = new Int16Array(event.data)
      this.queue.push(pcm)
      this.frames += pcm.length / ${CHANNELS}
      while (this.frames > MAX_FRAMES && this.queue.length > 1) {
        const dropped = this.queue.shift()
        this.frames -= (dropped.length - this.offset) / ${CHANNELS}
        this.offset = 0
      }
    }
  }

  process(_inputs, outputs) {
    const [left, right] = outputs[0]
    for (let i = 0; i < left.length; i++) {
      // Nothing queued is silence, and silence is the normal state whenever
      // the captured applications happen not to be making a sound.
      if (this.queue.length === 0) { left[i] = 0; right[i] = 0; continue }
      const chunk = this.queue[0]
      left[i] = chunk[this.offset] / 32768
      right[i] = chunk[this.offset + 1] / 32768
      this.offset += ${CHANNELS}
      this.frames--
      if (this.offset >= chunk.length) { this.queue.shift(); this.offset = 0 }
    }
    return true
  }
}

registerProcessor('source', Source)
`

type Mixer = {
  track: MediaStreamTrack
  /** Rebuilds the nodes to match the sources the main process opened. */
  sync: (sourceIds: string[]) => void
  close: () => Promise<void>
}

async function createMixer(): Promise<Mixer> {
  const bridge = desktopBridge()
  if (bridge === null) throw new Error("a captura por aplicativo só existe no app")

  const context = new AudioContext({ sampleRate: SAMPLE_RATE })
  const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: "text/javascript" }))
  await context.audioWorklet.addModule(url)
  URL.revokeObjectURL(url)

  const destination = context.createMediaStreamDestination()
  const mix = context.createGain()
  mix.connect(destination)

  const nodes = new Map<string, AudioWorkletNode>()

  const unsubscribe = bridge.onAudioPcm((sourceId, pcm) => {
    const node = nodes.get(sourceId)
    // A chunk whose id has no node is dropped here, in silence. That is exactly
    // why the ids the main process returns must be the ids it sends under.
    if (node === undefined) return

    // `pcm.buffer` may be a larger block with our chunk somewhere inside it;
    // handing the raw buffer over would make the worklet read the rubbish
    // around it. The slice takes only what is ours and owns the copy.
    const block = pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength)
    node.port.postMessage(block, [block])
  })

  const track = destination.stream.getAudioTracks()[0]
  if (track === undefined) throw new Error("o Web Audio não entregou nenhuma trilha")

  return {
    track,

    sync: (sourceIds) => {
      for (const [id, node] of nodes) {
        if (sourceIds.includes(id)) continue
        node.disconnect()
        nodes.delete(id)
      }
      for (const id of sourceIds) {
        if (nodes.has(id)) continue
        const node = new AudioWorkletNode(context, "source", {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [CHANNELS],
        })
        node.connect(mix)
        nodes.set(id, node)
      }
    },

    close: async () => {
      unsubscribe()
      for (const node of nodes.values()) node.disconnect()
      nodes.clear()
      mix.disconnect()
      await context.close().catch(() => undefined)
    },
  }
}

/**
 * The mixer, built on first use and kept for the life of the page.
 *
 * One track for the whole session: rebuilding it per broadcast would republish
 * to the SFU, and switching audio mode mid-broadcast is precisely what this
 * feature is for.
 */
let mixer: Promise<Mixer> | null = null

function getMixer(): Promise<Mixer> {
  mixer ??= createMixer()
  return mixer
}

/** Applies a mode and points the mix at whatever sources it opened. */
export async function applyAudioMode(mode: AudioMode): Promise<void> {
  const bridge = desktopBridge()
  if (bridge === null) return

  const ready = await getMixer()
  const sourceIds = await bridge.setAudioMode(mode)
  ready.sync(sourceIds)
}

/**
 * The mixed track, as a source for the broadcast.
 *
 * It emits once and stays: the track outlives every change of mode, which is
 * what keeps `PartyTracks.push` from renegotiating when one happens.
 */
export const processAudioTrack$ = new Observable<MediaStreamTrack>((subscriber) => {
  let cancelled = false

  // Starting a broadcast wires the audio too. Without this the default mode is
  // only a label in the panel: the room goes out silent until somebody thinks
  // to open it, and the first sign is a friend saying they hear nothing.
  applyAudioMode(currentAudioMode())
    .then(() => getMixer())
    .then((ready) => {
      if (cancelled) return
      subscriber.next(ready.track)
    })
    .catch((cause: unknown) => {
      subscriber.error(cause)
    })

  return () => {
    cancelled = true
  }
})
