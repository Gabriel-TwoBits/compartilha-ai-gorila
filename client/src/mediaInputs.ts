import { type Observable, catchError, defer, from, fromEvent, map, merge, of, shareReplay, switchMap } from "rxjs"

/** `navigator.mediaDevices` is absent on an insecure origin, where none of this works. */
export function mediaDevices(): MediaDevices {
  const available: MediaDevices | undefined = navigator.mediaDevices
  if (available === undefined) {
    throw new Error("captura exige HTTPS ou localhost")
  }
  return available
}

export function stopStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop()
}

/**
 * The inputs of one kind, re-read on every hotplug and whenever `revealed$`
 * says a fresh capture grant may have revealed their names.
 *
 * Enumerating directly rather than through partytracks' `devices$`, which asks
 * the Permissions API about the camera — a descriptor Firefox rejects, taking
 * the whole device list down with it. An enumeration that fails outright (an
 * insecure origin has no `navigator.mediaDevices`) yields an empty list; the
 * button that reveals the names is what reports why.
 */
export function inputDevices$(
  kind: MediaDeviceKind,
  revealed$: Observable<void>,
): Observable<MediaDeviceInfo[]> {
  return defer(() => {
    const devices = mediaDevices()
    return merge(of(null), fromEvent(devices, "devicechange"), revealed$).pipe(
      switchMap(() => from(devices.enumerateDevices())),
    )
  }).pipe(
    map((devices) => devices.filter((device) => device.kind === kind)),
    catchError(() => of([])),
    shareReplay({ bufferSize: 1, refCount: true }),
  )
}
