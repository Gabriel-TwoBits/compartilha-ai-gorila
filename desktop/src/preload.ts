import { contextBridge, ipcRenderer } from "electron"

/**
 * The bridge between the room's page and the machine it runs on.
 *
 * Deliberately narrow. The page is loaded from the server over the network, so
 * everything exposed here is reachable by whatever that server serves — the
 * list is short enough to audit in one read, and nothing on it can touch the
 * filesystem or run a command.
 *
 * The presence of `window.gorila` is also how the client tells it is running
 * inside the app rather than in a browser tab.
 */

const PORTAL_ARGUMENT = "--gorila-portal"

/**
 * Whether the system portal owns the screen choice.
 *
 * Passed on the command line because a preload cannot read the main process's
 * environment, and a synchronous IPC to ask would block the first paint.
 */
const usesPortal = process.argv.some((argument) => argument === `${PORTAL_ARGUMENT}=1`)

contextBridge.exposeInMainWorld("gorila", {
  platform: process.platform,
  usesPortal,

  /** Screens and windows with thumbnails. Always empty under the portal. */
  sources: () => ipcRenderer.invoke("sources"),

  /** Raises the system picker and parks the answer. Only used under the portal. */
  pickScreen: () => ipcRenderer.invoke("pick-screen"),

  /** Retries the server, for the offline page. */
  reload: () => ipcRenderer.invoke("reload"),

  /** Applications currently making sound, for the list to tick. */
  audioApps: () => ipcRenderer.invoke("audio-apps"),

  /** Applies a mode and answers with the source ids the PCM will carry. */
  setAudioMode: (mode: unknown) => ipcRenderer.invoke("audio-mode", mode),

  /** Subscribes to the PCM. Returns the unsubscribe. */
  onAudioPcm: (listener: (sourceId: string, pcm: Uint8Array) => void) => {
    const forward = (_event: unknown, sourceId: string, pcm: Uint8Array) =>
      listener(sourceId, pcm)
    ipcRenderer.on("audio-pcm", forward)
    return () => ipcRenderer.off("audio-pcm", forward)
  },
})
