import { BrowserWindow, app, desktopCapturer, ipcMain, session, shell } from "electron"
import { join } from "node:path"
import type { AudioMode } from "./audioMode"
import * as pipewireAudio from "./audioPipewire"
import * as wasapiAudio from "./audioWasapi"

/**
 * Main process of the desktop shell.
 *
 * The window loads the room's own URL rather than a bundled page, so the whole
 * React client is reused as-is and the session cookie works without a bridge.
 * What this process adds is the two things a browser cannot do: list the
 * screens and windows itself, and capture audio one application at a time.
 */

const DEFAULT_SERVER_URL = "https://example.invalid"

const WINDOW_WIDTH = 1280
const WINDOW_HEIGHT = 800
const MIN_WINDOW_WIDTH = 940
const MIN_WINDOW_HEIGHT = 600

/** Matches the client's own surface colour, so the frame does not flash white. */
const BACKGROUND_COLOR = "#0b0b0f"

const THUMBNAIL_WIDTH = 320
const THUMBNAIL_HEIGHT = 180

/** Flags handed to the preload, which cannot read this process's variables. */
const PORTAL_ARGUMENT = "--gorila-portal"
const PER_PROCESS_AUDIO_ARGUMENT = "--gorila-per-process-audio"

const serverUrl = (process.env.GORILA_URL ?? DEFAULT_SERVER_URL).replace(/\/$/, "")

/**
 * Wayland forbids any program from enumerating other windows, by design. There
 * the system portal is what asks which screen to share, and `desktopCapturer`
 * cannot produce a list at all — so the app must not pretend to offer one.
 */
const usesPortal =
  process.platform === "linux" &&
  (process.env.XDG_SESSION_TYPE === "wayland" || process.env.WAYLAND_DISPLAY !== undefined)

// Both switches must be set before `ready`: afterwards Ozone has already picked
// a platform. Without the hint Electron runs under XWayland and renders blurry
// on a HiDPI screen, which is exactly the screen someone games on.
if (process.platform === "linux") {
  app.commandLine.appendSwitch("ozone-platform-hint", "auto")
  app.commandLine.appendSwitch("enable-features", "WebRTCPipeWireCapturer")
}

/**
 * Whether this machine can capture audio one application at a time.
 *
 * False only on a Windows older than process loopback. Saying so up front beats
 * the alternative: the capture fails at run time with nothing useful to report,
 * and the broadcast simply goes out silent.
 */
const canCapturePerProcess =
  process.platform !== "win32" || wasapiAudio.canCapturePerProcess()

let window: BrowserWindow | null = null

/**
 * What the portal handed over, waiting for the `getDisplayMedia` that follows.
 *
 * The whole source object is parked here, not its id. The handler must answer
 * without calling `desktopCapturer.getSources()` — from inside the handler that
 * call hangs forever, because Chromium waits for the handler before going on
 * and `getSources` needs that same path to raise the portal. Looking the id
 * back up there would reintroduce exactly that deadlock.
 */
let pickedSource: Electron.DesktopCapturerSource | null = null

type ScreenSource = {
  id: string
  name: string
  /** A data: URL, since the renderer cannot read anything off this process. */
  thumbnail: string
}

async function listSources(): Promise<ScreenSource[]> {
  // On Wayland this would raise the portal merely by opening the picker, and
  // would come back with one source at best. An empty list is the honest
  // answer, and the client explains why rather than showing an empty panel.
  if (usesPortal) return []

  const sources = await desktopCapturer.getSources({
    types: ["screen", "window"],
    thumbnailSize: { width: THUMBNAIL_WIDTH, height: THUMBNAIL_HEIGHT },
  })

  return sources.map((source) => ({
    id: source.id,
    name: source.name,
    thumbnail: source.thumbnail.toDataURL(),
  }))
}

/**
 * Raises the system picker and remembers the answer. Returns false when the
 * person dismissed it, which is a decision and not a failure.
 */
async function pickScreen(): Promise<boolean> {
  pickedSource = null

  // Outside the handler this raises the portal normally and comes back with
  // whatever was chosen — the wait here is the person deciding.
  const sources = await desktopCapturer.getSources({
    types: ["screen", "window"],
    thumbnailSize: { width: 0, height: 0 },
  })

  const [chosen] = sources
  if (chosen === undefined) return false

  pickedSource = chosen
  return true
}

/**
 * The audio backend for this platform.
 *
 * The two answer the same three calls and differ in everything underneath.
 * Importing both is safe only because each resolves what it needs INSIDE its
 * functions: the Windows one would otherwise die on import here, where its
 * optional native addon does not exist.
 */
function audioBackend(): typeof pipewireAudio {
  return process.platform === "win32" ? wasapiAudio : pipewireAudio
}

function isOurOrigin(url: string): boolean {
  try {
    return new URL(url).origin === new URL(serverUrl).origin
  } catch {
    return false
  }
}

function createWindow(): void {
  window = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    backgroundColor: BACKGROUND_COLOR,
    show: false,
    // The installer stamps the icon onto the executable, but a window started
    // from `npm start` is born with Electron's default atom without this.
    icon: join(__dirname, "..", "build", "icon.png"),
    // The native frame stays. A frameless window swallows `requestFullscreen`
    // — the promise neither resolves nor rejects — and the client's own
    // fullscreen button would have to become an IPC call for no gain.
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: [
        `${PORTAL_ARGUMENT}=${usesPortal ? "1" : "0"}`,
        `${PER_PROCESS_AUDIO_ARGUMENT}=${canCapturePerProcess ? "1" : "0"}`,
      ],
    },
  })

  window.once("ready-to-show", () => window?.show())

  // The page is remote, so treat it as remote: it may only navigate within its
  // own origin, and anything it opens goes to the real browser.
  window.webContents.on("will-navigate", (event, url) => {
    if (isOurOrigin(url)) return
    event.preventDefault()
    void shell.openExternal(url)
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (!isOurOrigin(url)) void shell.openExternal(url)
    return { action: "deny" }
  })

  // A server that is down would otherwise leave a Chromium error page, which
  // says nothing useful and offers nothing to do.
  window.webContents.on("did-fail-load", (_event, _code, _description, url, isMainFrame) => {
    if (!isMainFrame) return
    if (!isOurOrigin(url)) return
    void window?.loadFile(join(__dirname, "offline.html"))
  })

  void window.loadURL(serverUrl)

  window.on("closed", () => {
    window = null
  })
}

app.whenReady().then(() => {
  // Without a handler Electron denies silently, and what reaches the page is a
  // bare NotAllowedError with no explanation. Only media is ever needed here.
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(permission === "media")
  })

  // Only Wayland ever reaches this: elsewhere the client captures by source id
  // through getUserMedia and never calls getDisplayMedia. The callback has to
  // be invoked on every path — one that never comes leaves getDisplayMedia
  // pending forever, with no error anywhere.
  session.defaultSession.setDisplayMediaRequestHandler(
    (_request, callback) => {
      const source = pickedSource
      // The choice is good for one capture: a stale one would silently share
      // last time's window.
      pickedSource = null
      // `{}` denies. Denying is still an answer, and an answer is what matters.
      callback(source === null ? {} : { video: source })
    },
    // Only where a system picker exists (Windows, macOS 15+) does this change
    // anything; on Linux the handler is called either way.
    { useSystemPicker: false },
  )

  ipcMain.handle("sources", listSources)
  ipcMain.handle("pick-screen", pickScreen)

  ipcMain.handle("audio-apps", () => audioBackend().listApps())

  // Returns the source ids the PCM will arrive under. The renderer builds one
  // worklet per id and drops, in silence, any chunk whose id has no worklet —
  // so these two must be the same list, always.
  ipcMain.handle("audio-mode", (_event, mode: AudioMode) =>
    audioBackend().setMode(mode, (sourceId, pcm) => {
      // `send` copies the buffer, so the recorder's own chunk is never handed
      // across and then reused underneath the renderer.
      window?.webContents.send("audio-pcm", sourceId, pcm)
    }),
  )
  ipcMain.handle("reload", () => {
    void window?.loadURL(serverUrl)
  })

  createWindow()

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Leaving the null sink loaded would put a phantom audio device on the
// person's machine that outlives the app.
app.on("will-quit", (event) => {
  event.preventDefault()
  void audioBackend()
    .stop()
    .finally(() => app.exit(0))
})

app.on("window-all-closed", () => {
  // macOS keeps an app alive with no windows; nothing else does, and this is
  // not an app anyone leaves running in a dock.
  if (process.platform !== "darwin") app.quit()
})
