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

export type DesktopBridge = {
  platform: string
  /**
   * Whether the system portal owns the screen choice.
   *
   * True on Wayland, where no program may enumerate another's windows. There
   * the app has no list to show and the picker belongs to the system.
   */
  usesPortal: boolean
  sources: () => Promise<DesktopSource[]>
  /** Raises the system picker. `false` means it was dismissed. */
  pickScreen: () => Promise<boolean>
  reload: () => void

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
