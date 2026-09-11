import type { Observable } from "rxjs"

/**
 * What the rest of the client needs from a screen capture, whichever provides it.
 *
 * Two do: partytracks' `Screenshare` in a browser tab, and our own in the
 * desktop app. The interface is the smaller of the two on purpose — it lists
 * only what is actually consumed, so a browser `Screenshare` satisfies it
 * structurally with nothing to adapt.
 */
export type ScreenSource = {
  isBroadcasting$: Observable<boolean>
  video: {
    /** The track to hand `PartyTracks.push`. */
    broadcastTrack$: Observable<MediaStreamTrack>
    /** Failures acquiring the screen — a dismissed picker, a denied permission. */
    error$: Observable<Error>
  }
  audio: {
    /** Whatever sound the capture itself carried, which on Linux is none. */
    broadcastTrack$: Observable<MediaStreamTrack>
  }
  toggleBroadcasting: () => void
}
