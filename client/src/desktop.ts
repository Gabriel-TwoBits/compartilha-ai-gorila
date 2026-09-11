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
