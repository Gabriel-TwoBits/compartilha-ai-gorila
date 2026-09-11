/**
 * Which build to offer whoever opened the room.
 *
 * The point of guessing at all is that the first download is the one manual
 * step the app ever asks for; after it, the app updates itself. Getting it
 * wrong hands someone a file that cannot run on their machine, and they have no
 * way to know which one was right.
 */

/** Served by our own server, under the release route. See `server/main.ts`. */
const RELEASE_ROUTE = "/atualiza"

export type DownloadTarget = "windows" | "linux" | "unsupported"

export type Download = {
  label: string
  url: string
  /** Shown under the button, for the one caveat that matters per file. */
  note: string | null
}

/**
 * File names that never change, so a link handed out once keeps working.
 *
 * A release copies the versioned artifacts here under these names as well. The
 * updater does not use them — it follows `latest.yml` to the versioned file —
 * so they only ever serve a first install.
 */
const WINDOWS_INSTALLER = `${RELEASE_ROUTE}/CompartilhaAiGorila-instalador.exe`
const LINUX_APPIMAGE = `${RELEASE_ROUTE}/CompartilhaAiGorila.AppImage`
const LINUX_DEB = `${RELEASE_ROUTE}/CompartilhaAiGorila.deb`

/**
 * Phones and Chromebooks that claim to be Linux.
 *
 * Android reports "Linux" in `navigator.platform`, and so does ChromeOS. Both
 * would be handed an AppImage that cannot run, and neither has any use for a
 * desktop app — they are here to watch, which the browser already does.
 */
const NOT_A_DESKTOP = /android|cros\b|iphone|ipad|ipod/i

export function detectTarget(platform: string, userAgent: string): DownloadTarget {
  if (NOT_A_DESKTOP.test(userAgent)) return "unsupported"
  if (/win/i.test(platform)) return "windows"
  if (/linux|x11/i.test(platform)) return "linux"
  // macOS and anything else: there is no build, and pretending otherwise would
  // be worse than saying so.
  return "unsupported"
}

export function downloadsFor(target: DownloadTarget): Download[] {
  switch (target) {
    case "windows":
      return [
        {
          label: "Baixar para Windows",
          url: WINDOWS_INSTALLER,
          // The installer is unsigned, so SmartScreen shows a blue warning on
          // first run. Saying it here, before the download, is what keeps
          // somebody from reading it as a virus and giving up.
          note: 'O Windows vai avisar que protegeu o computador — é por não ser um programa assinado. Clique em "Mais informações" e em "Executar assim mesmo".',
        },
      ]
    case "linux":
      return [
        {
          label: "Baixar para Linux (AppImage)",
          url: LINUX_APPIMAGE,
          // Without libfuse2 a double click does nothing and reports nothing,
          // which reads as a broken download rather than a missing library.
          note: "Precisa da libfuse2. Se o clique duplo não fizer nada, é ela que falta — ou use o .deb.",
        },
        {
          label: "Baixar o .deb",
          url: LINUX_DEB,
          note: "Instala como qualquer programa, mas não se atualiza sozinho.",
        },
      ]
    case "unsupported":
      return []
    default:
      // Unreachable: every DownloadTarget is handled above.
      return []
  }
}

/**
 * What the app is for, in one line, adapted to the machine reading it.
 *
 * On Linux the browser hands over no screen audio at all, so promising to keep
 * the Discord call out would be describing the wrong problem: there the app is
 * what makes any sound possible.
 */
export function pitchFor(target: DownloadTarget): string | null {
  switch (target) {
    case "windows":
      return "Transmita o som do jogo sem mandar a call do Discord junto."
    case "linux":
      return "No navegador, o Linux não manda áudio nenhum da tela. Com o app, vai o som do jogo — e só ele."
    case "unsupported":
      return null
    default:
      // Unreachable: every DownloadTarget is handled above.
      return null
  }
}
