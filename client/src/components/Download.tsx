import { detectTarget, downloadsFor, pitchFor } from "../downloads"
import { isDesktop } from "../desktop"

const linkClassName =
  "block rounded-lg border border-edge px-3 py-2 text-center text-sm text-ink transition hover:bg-surface-raised"

/**
 * Whether this machine has anything to download.
 *
 * False inside the app itself — offering somebody what they are already
 * running — and false where there is no build, such as macOS or a phone.
 * Callers use it to decide whether to render a way in at all, so nothing opens
 * onto an empty panel.
 */
export function hasDownload(): boolean {
  if (isDesktop()) return false
  return downloadsFor(detectTarget(navigator.platform, navigator.userAgent)).length > 0
}

/**
 * Offers the desktop app.
 *
 * Deliberately without a frame of its own: it appears in two places that look
 * nothing alike — inside the login card, and in a panel of the room — and each
 * one wraps it. It is the one manual download the app ever asks for; after it,
 * the app updates itself.
 */
export function Download() {
  if (!hasDownload()) return null

  const target = detectTarget(navigator.platform, navigator.userAgent)
  const links = downloadsFor(target)
  const pitch = pitchFor(target)

  return (
    <>
      {pitch !== null && <p className="mb-3 text-xs text-ink-muted">{pitch}</p>}

      <div className="flex flex-col gap-2">
        {links.map((link) => (
          <a key={link.url} href={link.url} className={linkClassName}>
            {link.label}
          </a>
        ))}
      </div>

      {/* One caveat per file, and only the one that actually bites. */}
      {links.map((link) =>
        link.note === null ? null : (
          <p key={link.url} className="mt-2 text-xs text-ink-muted">
            {link.note}
          </p>
        ),
      )}

      <p className="mt-3 text-xs text-ink-muted">
        Para assistir, o site já basta. O app é para quem transmite.
      </p>
    </>
  )
}
