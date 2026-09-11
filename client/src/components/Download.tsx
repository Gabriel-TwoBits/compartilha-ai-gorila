import { detectTarget, downloadsFor, pitchFor } from "../downloads"
import { isDesktop } from "../desktop"

const linkClassName =
  "block rounded-lg border border-edge px-3 py-2 text-center text-sm text-ink transition hover:bg-surface-raised"

/**
 * Offers the desktop app, on the login screen.
 *
 * Here rather than inside the room because it has to work before anybody has
 * typed the password: the whole point is that a friend opens the link and
 * leaves with the right file. It is the one manual download the app ever asks
 * for — after it, the app updates itself.
 *
 * Invisible inside the app itself, which would be offering someone what they
 * are already running.
 */
export function Download() {
  if (isDesktop()) return null

  const target = detectTarget(navigator.platform, navigator.userAgent)
  const links = downloadsFor(target)
  if (links.length === 0) return null

  const pitch = pitchFor(target)

  return (
    <div className="mt-6 border-t border-edge pt-5">
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
    </div>
  )
}
