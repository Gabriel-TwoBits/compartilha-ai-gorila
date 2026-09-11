import { type RefObject, useCallback, useEffect, useState } from "react"
import { desktopBridge } from "./desktop"

/**
 * Filling the screen with one element, by whichever route this build has.
 *
 * In a browser that is `requestFullscreen`, and the document itself remembers
 * who holds the screen. Inside the desktop app it is not: Electron swallows the
 * call — the promise neither resolves nor rejects, and `document.fullscreenElement`
 * stays null — so the window goes fullscreen natively and the page has to lift
 * the element out of the flow and remember, here, which one it was.
 */

/** Which element covers the screen under the native route. Never set in a browser. */
let expandedElement: HTMLElement | null = null

const listeners = new Set<() => void>()

function setExpanded(element: HTMLElement | null): void {
  expandedElement = element
  for (const listener of listeners) listener()
}

// Leaving by F11 or Escape never passes through the page, so the window reports
// it. Without this the element would go on covering a window already back to
// its normal size.
desktopBridge()?.onFullscreen((on) => {
  if (on) return
  setExpanded(null)
})

/** The browser refusing fullscreen leaves nothing to recover from or report. */
function ignoreRejection(): void {}

export type Fullscreen = {
  /** Whether this element is the one currently covering the screen. */
  isFullscreen: boolean
  toggle: () => void
}

export function useFullscreen(elementRef: RefObject<HTMLElement | null>): Fullscreen {
  const bridge = desktopBridge()
  const [isFullscreen, setIsFullscreen] = useState(false)

  useEffect(() => {
    function sync(): void {
      const holder = bridge === null ? document.fullscreenElement : expandedElement
      setIsFullscreen(holder !== null && holder === elementRef.current)
    }

    sync()

    if (bridge === null) {
      // The event fires on the document for every tile at once, so each has to
      // check for itself.
      document.addEventListener("fullscreenchange", sync)
      return () => document.removeEventListener("fullscreenchange", sync)
    }

    listeners.add(sync)
    return () => {
      listeners.delete(sync)
    }
  }, [bridge, elementRef])

  // A tile can vanish while it holds the screen — whoever was broadcasting
  // stopped — and the window would stay fullscreen over nothing. The browser
  // route needs none of this: removing the element ends its own fullscreen.
  useEffect(() => {
    const element = elementRef.current
    return () => {
      if (expandedElement !== element) return
      setExpanded(null)
      desktopBridge()?.setFullscreen(false)
    }
  }, [elementRef])

  const toggle = useCallback(() => {
    const element = elementRef.current
    if (element === null) return

    if (bridge !== null) {
      // Another tile holding the screen is replaced by this one, and the window
      // is already fullscreen — saying so again costs nothing and keeps the two
      // calls together.
      const leaving = expandedElement === element
      setExpanded(leaving ? null : element)
      bridge.setFullscreen(!leaving)
      return
    }

    if (document.fullscreenElement === element) {
      void document.exitFullscreen().catch(ignoreRejection)
      return
    }
    void element.requestFullscreen().catch(ignoreRejection)
  }, [bridge, elementRef])

  return { isFullscreen, toggle }
}
