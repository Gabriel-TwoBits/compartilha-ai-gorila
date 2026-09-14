import { type RefObject, createContext, useEffect, useState } from "react"

/**
 * Whether the pointer has gone quiet over an element, so its controls can go.
 *
 * The rule players everywhere use: the picture is what the person came for, and
 * anything drawn over it earns its place only while a hand is moving. Any
 * movement brings it back, and so does leaving the element — a tile nobody is
 * pointing at goes on saying whose it is.
 */

/**
 * How long the pointer has to sit still before the controls go.
 *
 * Long enough not to fire while somebody is aiming at a button, short enough
 * that settling in to watch clears the picture without a wait worth noticing.
 */
const IDLE_AFTER_MS = 2500

export type PointerIdle = {
  /** True once the pointer has been still over the element for long enough. */
  idle: boolean
  /**
   * Spread onto the controls themselves. A pointer resting ON them is aiming,
   * not settling: without this the button fades out from under the cursor
   * reaching for it.
   */
  holdProps: {
    onPointerEnter: () => void
    onPointerLeave: () => void
  }
}

/**
 * `covering` says the element fills the screen, where the pointer is over it
 * wherever it happens to be. Without it nothing would start counting until the
 * pointer moved, and a screen filled and then left alone would keep its
 * controls forever — which is precisely the case this exists for.
 */
export function usePointerIdle(
  elementRef: RefObject<HTMLElement | null>,
  covering: boolean,
): PointerIdle {
  const [idle, setIdle] = useState(false)
  const [held, setHeld] = useState(false)

  useEffect(() => {
    const element = elementRef.current
    if (element === null) return undefined

    let timer = 0
    let inside = covering

    function countDown(): void {
      window.clearTimeout(timer)
      if (!inside) return
      timer = window.setTimeout(() => setIdle(true), IDLE_AFTER_MS)
    }

    function wake(): void {
      setIdle(false)
      countDown()
    }

    function enter(): void {
      inside = true
      wake()
    }

    function leave(): void {
      inside = false
      setIdle(false)
      window.clearTimeout(timer)
    }

    countDown()

    element.addEventListener("pointerenter", enter)
    element.addEventListener("pointermove", wake)
    element.addEventListener("pointerleave", leave)

    return () => {
      window.clearTimeout(timer)
      element.removeEventListener("pointerenter", enter)
      element.removeEventListener("pointermove", wake)
      element.removeEventListener("pointerleave", leave)
    }
  }, [elementRef, covering])

  return {
    // Held is decided at render rather than against the timer: leaving the
    // controls is itself a movement, which wakes the count on its own.
    idle: idle && !held,
    holdProps: {
      onPointerEnter: () => setHeld(true),
      onPointerLeave: () => setHeld(false),
    },
  }
}

/** A consumer outside a tile is never hidden, and has nothing to hold. */
function doNothing(): void {}

/**
 * What a tile hands down to everything it draws over the picture.
 *
 * The chrome is not all in one place — the name and the buttons ride in the
 * header, the volume sits in the corner of the video, several components deep —
 * and all of it has to go and come back together. Passing it down the tree by
 * hand would mean a prop through every layer in between for a decision none of
 * them take part in.
 */
export const TileChrome = createContext<PointerIdle>({
  idle: false,
  holdProps: { onPointerEnter: doNothing, onPointerLeave: doNothing },
})
