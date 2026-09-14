import type { ReactNode } from "react"

/**
 * The room's icons, drawn rather than typed.
 *
 * Emoji used to carry these buttons, and every platform draws them as a
 * different picture, in colours and at a weight the page does not control —
 * a 🔊 that arrives orange next to muted grey text is not a choice anyone made.
 * These follow the label instead: `currentColor` and a box sized in `em`, so
 * whatever a button does to its text reaches its icon too.
 *
 * Always decorative. Every icon here sits beside a label or inside a button
 * that names itself with `aria-label`, so none of them is announced.
 */

/** A shade above the cap height, so the icon reads as the label's equal. */
const iconClassName = "size-[1.15em] shrink-0"

const STROKE_WIDTH = 2

function Stroked({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={STROKE_WIDTH}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className === undefined ? iconClassName : `${iconClassName} ${className}`}
    >
      {children}
    </svg>
  )
}

function Filled({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={iconClassName}>
      {children}
    </svg>
  )
}

/** Four corners pushing outwards: the universal "fill the screen". */
export function EnterFullscreenIcon() {
  return (
    <Stroked>
      <path d="M9 3H5a2 2 0 0 0-2 2v4" />
      <path d="M15 3h4a2 2 0 0 1 2 2v4" />
      <path d="M21 15v4a2 2 0 0 1-2 2h-4" />
      <path d="M3 15v4a2 2 0 0 0 2 2h4" />
    </Stroked>
  )
}

/** The same four corners folded back in. */
export function ExitFullscreenIcon() {
  return (
    <Stroked>
      <path d="M9 3v4a2 2 0 0 1-2 2H3" />
      <path d="M15 3v4a2 2 0 0 0 2 2h4" />
      <path d="M15 21v-4a2 2 0 0 1 2-2h4" />
      <path d="M9 21v-4a2 2 0 0 0-2-2H3" />
    </Stroked>
  )
}

export function CloseIcon() {
  return (
    <Stroked>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </Stroked>
  )
}

export function PlayIcon() {
  return (
    <Filled>
      <path d="M8 5.2a1 1 0 0 1 1.5-.9l9.1 6.8a1 1 0 0 1 0 1.8l-9.1 6.8a1 1 0 0 1-1.5-.9Z" />
    </Filled>
  )
}

export function StopIcon() {
  return (
    <Filled>
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </Filled>
  )
}

/** A monitor on its stand: the thing being shared, not the act of sharing. */
export function ScreenIcon() {
  return (
    <Stroked>
      <rect x="2" y="4" width="20" height="13" rx="2" />
      <path d="M8 21h8" />
      <path d="M12 17v4" />
    </Stroked>
  )
}

export function SpeakerIcon() {
  return (
    <Stroked>
      <path d="M11 5 6.5 9H3v6h3.5L11 19Z" />
      <path d="M15.5 8.8a4.5 4.5 0 0 1 0 6.4" />
      <path d="M18.5 6.2a8 8 0 0 1 0 11.6" />
    </Stroked>
  )
}

/** The speaker, struck through — the same idea as the bell's own off state. */
export function SpeakerOffIcon() {
  return (
    <Stroked>
      <path d="M11 5 6.5 9H3v6h3.5L11 19Z" />
      <path d="M3 3l18 18" />
    </Stroked>
  )
}

export function BellIcon() {
  return (
    <Stroked>
      <path d="M18 8a6 6 0 1 0-12 0c0 6-3 8-3 8h18s-3-2-3-8" />
      <path d="M13.7 20a2 2 0 0 1-3.4 0" />
    </Stroked>
  )
}

/** The bell, struck through. Muting is the state worth showing, not the bell. */
export function BellOffIcon() {
  return (
    <Stroked>
      <path d="M18 8a6 6 0 1 0-12 0c0 6-3 8-3 8h18s-3-2-3-8" />
      <path d="M13.7 20a2 2 0 0 1-3.4 0" />
      <path d="M3 3l18 18" />
    </Stroked>
  )
}

export function DownloadIcon() {
  return (
    <Stroked>
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M4 20h16" />
    </Stroked>
  )
}

/** An arrow closing a circle: restart into the version already on disk. */
export function RestartIcon() {
  return (
    <Stroked>
      <path d="M21 12a9 9 0 1 1-2.6-6.4" />
      <path d="M21 4v5h-5" />
    </Stroked>
  )
}

/**
 * A ring with a gap, turning: something is under way and has not failed.
 *
 * The gap is what makes the rotation readable — a whole circle spinning looks
 * like a circle standing still.
 */
export function SpinnerIcon() {
  return (
    <Stroked className="animate-spin">
      <circle cx="12" cy="12" r="9" className="opacity-30" />
      <path d="M21 12a9 9 0 0 0-9-9" />
    </Stroked>
  )
}
