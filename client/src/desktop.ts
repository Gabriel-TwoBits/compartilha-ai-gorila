/**
 * The desktop app's bridge, as the page sees it.
 *
 * Everything here is injected by the Electron preload. In a browser tab it is
 * simply absent, and that absence is how the client tells the two apart — there
 * is no user agent sniffing anywhere.
 */

export type DesktopSource = {
  id: string
  name: string
  /** A data: URL, small enough to put straight into an `<img>`. */
  thumbnail: string
}

/**
 * Where the broadcast's audio comes from, inside the app.
 *
 * "everything" is an inclusion of every application on the list, never a native
 * exclusion: that one takes a single process tree, and more than one thing has
 * to stay out. The list already omits what must never go out.
 */
export type AudioMode =
  | { kind: "none" }
  | { kind: "system" }
  | { kind: "include"; pids: number[] }
  | { kind: "everything" }

export type AudioApp = {
  pid: number
  name: string
  binary: string
}

/** What the app knows about updating itself, at this moment. */
export type UpdateState = {
  /**
   * `idle` and `current` are different things: "have not looked yet" and
   * "looked, and there is nothing" both leave the interface quiet, and telling
   * them apart is the only way to answer a click honestly.
   */
  phase: "idle" | "checking" | "current" | "downloading" | "ready" | "failed"
  percent: number
  version: string | null
  error: string | null
}

export type DesktopBridge = {
  platform: string
  /**
   * Whether the system portal owns the screen choice.
   *
   * True on Wayland, where no program may enumerate another's windows. There
   * the app has no list to show and the picker belongs to the system.
   */
  usesPortal: boolean
  /**
   * Whether this machine can capture one application at a time.
   *
   * False only on a Windows older than process loopback. There the choice is
   * the whole device or nothing, which is what the browser already offers.
   */
  canCapturePerProcess: boolean
  sources: () => Promise<DesktopSource[]>
  /** Raises the system picker. `false` means it was dismissed. */
  pickScreen: () => Promise<boolean>
  reload: () => void

  /**
   * Fills the screen with the window itself.
   *
   * Electron swallows `requestFullscreen`: the promise never settles and
   * nothing happens. Taking the window fullscreen is the only route that
   * works, and lifting the tile out of the flow is then the page's own job.
   */
  setFullscreen: (on: boolean) => void
  /** Subscribes to fullscreen, F11 and Escape included. Returns the unsubscribe. */
  onFullscreen: (listener: (on: boolean) => void) => () => void

  /** Applications making sound right now. */
  audioApps: () => Promise<AudioApp[]>

  /**
   * Applies a mode, answering with the ids the PCM will arrive under.
   *
   * These have to be exactly the ids the chunks carry: the mixer builds one
   * worklet per id and drops, without a word, anything that does not match.
   */
  setAudioMode: (mode: AudioMode) => Promise<string[]>

  /** Subscribes to the PCM. Returns the unsubscribe. */
  onAudioPcm: (listener: (sourceId: string, pcm: Uint8Array) => void) => () => void

  updateState: () => Promise<UpdateState>
  checkUpdate: () => Promise<UpdateState>
  installUpdate: () => void
  /** Subscribes to update progress. Returns the unsubscribe. */
  onUpdateState: (listener: (state: UpdateState) => void) => () => void
}

declare global {
  interface Window {
    gorila?: DesktopBridge
  }
}

/** The bridge, or `null` in a browser. */
export function desktopBridge(): DesktopBridge | null {
  return window.gorila ?? null
}

/** Whether the page is running inside the desktop app. */
export function isDesktop(): boolean {
  return window.gorila !== undefined
}
