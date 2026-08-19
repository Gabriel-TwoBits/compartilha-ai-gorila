# CompartilhaAíGorila

A single room where a group of friends walks in, someone shares their screen
**with audio** and everyone else watches. No camera, no microphone — the voice
conversation stays on Discord.

Video forwarding is handled by the [Cloudflare Realtime
SFU](https://developers.cloudflare.com/realtime/sfu/), which comes with 1,000
GB/month of free egress. The server in this repository takes care of login,
presence and handing out track addresses; it never touches the media.

---

## How it works

```
Browser A (broadcasting)                 Browser B (watching)
   │  push(track)                            │  ◄── pull(track)
   │  WS: "I am broadcasting,                │  WS: receives the room state
   │       here is (sessionId, trackName)"   │      and pulls A's track
   ▼                                         ▼
┌──────────────────────────────────────────────────────┐
│  Node server (server/)                               │
│   /api/login|logout|me   signed session cookie       │
│   /ws                    presence + track addresses  │
│   /partytracks/*         proxy (keeps the secret)    │
└──────────────────────┬───────────────────────────────┘
                       │ Bearer SFU_APP_TOKEN
                       ▼
             Cloudflare Realtime SFU  ◄── the media flows through here
```

Cloudflare's SFU has no concept of a room: a viewer can only pull a track if it
knows the `(sessionId, trackName)` pair of whoever is broadcasting. Handing that
pair around is the only reason the WebSocket in `server/signaling.ts` exists.

**The nickname is the identity.** Someone with two tabs open is still a single
participant with two connections, and only leaves the room when the last one
closes. A broadcast belongs to the connection that published it, so closing an
idle tab does not kill the tab actually sharing the screen. The price is that two
friends picking the same nickname collapse into one entry — acceptable in a room
whose real gate is a shared password.

Every client reports over the socket which broadcast it is displaying, and that
is where the viewer count in the sidebar comes from. Whoever watches their own
screen sees the local capture rather than a copy coming back from the SFU, and
so does not count as audience.

The `SFU_APP_TOKEN` never reaches the browser — hence the `/partytracks/*` proxy,
which sits behind the session cookie so that no outsider burns through your
quota.

The heavy WebRTC lifting (SDP, renegotiation, recovering from a dropped
connection) belongs to [`partytracks`](https://www.npmjs.com/package/partytracks),
a library maintained by Cloudflare.

---

## Running locally

**1. Create the SFU app.** In the [Cloudflare
dashboard](https://dash.cloudflare.com/?to=/:account/realtime/sfu), create a
Realtime SFU app and keep the **App ID** and the **App Secret**.

**2. Set up the environment.**

```sh
cp .env.example .env
```

Fill in `SFU_APP_ID` and `SFU_APP_TOKEN` with what Cloudflare gave you, pick a
`ROOM_PASSWORD` and generate the signing key:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

The server refuses to boot with any variable missing, naming the culprit.

**3. Start it.**

```sh
pnpm install
pnpm dev
```

The UI lives at <http://localhost:5173> and the server at `:8787`. In
development Vite forwards `/api`, `/ws` and `/partytracks` to it.

**4. Test with two people.** Open two Chrome windows — one normal and one
incognito, otherwise both share the same cookie — and log in with different
nicknames.

For production: `pnpm build && pnpm start`, which serves `dist/client` from Node
itself on a single port. To exercise that over `http://localhost`, run it with
`SECURE_COOKIES=false` — otherwise the browser drops the `Secure` cookie and the
login looks like it accepts the password without ever letting anyone in.

### Container

```sh
docker build -t compartilha-ai-gorila .
docker run -p 8787:8787 --env-file .env compartilha-ai-gorila
```

A multi-stage image: the first stage builds the client bundle with the full
toolchain, the second keeps only the runtime dependencies (~227 MB). There is no
`--env-file` in the `CMD` — a container takes its configuration from the
environment, and `server/env.ts` refuses to boot with anything missing.

## Bandwidth

Capture is capped at **720p, 30fps** and the encoder at **2.5 Mbps**
(`client/src/tracks.ts`). A resolution ceiling alone does not cap bitrate — a
busy screen blows through whatever the encoder feels like — so `maxBitrate` is
the number that actually keeps the bill down.

Cloudflare only charges for traffic going out to clients; what you **send** is
free. At 2.5 Mbps that works out to ~1.1 GB/h **per viewer**: against the free
quota of 1,000 GB/month, roughly 900 viewer-hours, or ~225 h/month with four
people watching.

---

## Audio

The footer carries a picker for where the broadcast's audio comes from. Its
default, **Áudio da tela**, is whatever the screen picker itself handed over —
and that depends entirely on the browser and the operating system:

| | A browser tab | A window or the whole screen |
|---|---|---|
| Chromium on Windows | audio | audio |
| Chromium on Linux | audio | **no audio** |
| Firefox, anywhere | **no audio** | **no audio** |

Window and full-screen audio needs an operating system loopback that Chromium
implements on Windows and ChromeOS only ([Chromium issue
40155218](https://issues.chromium.org/issues/40155218)), and Firefox implements
no `getDisplayMedia` audio at all ([bug
1541425](https://bugzilla.mozilla.org/show_bug.cgi?id=1541425)). Neither has
anything to do with Wayland or with the desktop portal — X11 behaves the same.

So on Linux, to carry the sound of a native application — a game, a video
player — pick an audio **input** instead. PipeWire and PulseAudio expose every
output as a `Monitor of …` source, and that source hears exactly what the
speakers are playing:

1. Click **Listar entradas**. Browsers hide device names until a capture
   permission has been granted at least once.
2. Pick `Monitor of <your output>`.

The capture is pinned to that one device (`deviceId: { exact }`) and never falls
back to another, so a monitor source that fails ends as an error in the footer
rather than as your microphone going out to the room. Echo cancellation, noise
suppression and gain control are all switched off: they are built for voice and
ruin everything else. The choice is not persisted — every reload starts back on
the screen capture.

To send one application instead of the whole desktop, route it to a null sink in
`pavucontrol` and pick that sink's monitor. You stop hearing it yourself unless
you also load `module-loopback`.

Chromium also hides an experimental loopback behind
`chrome://flags/#pulseaudio-loopback-for-screen-share`, which is worth a try
before reaching for any of the above.

---

## Sharing it with friends (Cloudflare Tunnel)

**`http://localhost` works; `http://192.168.x.x` does not.** Capturing the screen
requires a secure context, so the moment the app leaves your machine it needs
HTTPS. A quick tunnel settles that in one command: a public HTTPS URL pointing at
the local server, with no Cloudflare account, no domain and no port forwarding on
the router.

**1. Install
[`cloudflared`](https://github.com/cloudflare/cloudflared/releases/latest).**

**2. Run a single command.**

```sh
pnpm share
```

It builds the client, starts the server in production mode — one port, and the
session cookie comes out `Secure`, as the tunnel's HTTPS demands — and puts the
tunnel in front, announcing the URL as soon as it exists:

```
  Room reachable at https://<four-words>.trycloudflare.com
```

Hand the URL to your friends along with the `ROOM_PASSWORD`, and ask them to open
it in Chrome/Chromium (see "Known limitations"). Anyone holding the URL lands on
the login screen, so the password remains the gate. `Ctrl+C` takes down server
and tunnel together and the address dies with them; the next run draws another
one.

To exercise the app in development, point the tunnel at Vite (`cloudflared tunnel
--url http://localhost:5173`) instead of Node — that is why `vite.config.ts`
accepts `.trycloudflare.com` hosts. On that path the cookie comes out without
`Secure` and HMR may complain through the tunnel; for testing with real people,
prefer the production route above.

The tunnel costs nothing and asks for no account, but it carries no uptime
guarantee and cuts off at 200 concurrent requests: it is for testing, not for
hosting.

### When the video never arrives

A black screen and `ICE failed` in the console mean there is no direct UDP path
to the SFU, almost always a symmetric NAT or a network blocking outbound UDP on
the viewer's side. TURN is the fix: create the key under Realtime → TURN, fill in
`TURN_APP_ID` and `TURN_APP_TOKEN` and restart the server, which reads the
environment only at boot. The tunnel stays up and the URL does not change.

## Known limitations

- **Screen audio** depends on the browser and the operating system, and on Linux
  the screen picker hands over none. When the video arrives and the audio does
  not, this is almost always the reason and not the code — see "Audio" above for
  the way around it.
- **The media travels through Cloudflare** even with the app running locally.
  That is inherent to their SFU — see "Bandwidth" above.
- **The room lives in memory.** Restarting the server empties it, and everyone
  reconnects on their own.

---

## Layout

| Path | What it is |
|---|---|
| `shared/protocol.ts` | WebSocket contract and validation, used by both sides |
| `server/env.ts` | Environment read and validated once, at boot |
| `server/session.ts` | Room password and signed cookie |
| `server/room.ts` | Room state, in memory |
| `server/signaling.ts` | WebSocket: presence and track addresses |
| `server/main.ts` | HTTP routes and boot |
| `client/src/useBroadcast.ts` | Publishes the screen to the SFU and announces it to the room |
| `client/src/tracks.ts` | PartyTracks singletons and the 720p30 / 2.5 Mbps ceilings |
| `client/src/audioSource.ts` | Which audio source the broadcast uses, and its capture |
| `client/src/components/Stage.tsx` | Main panel: local preview or remote track |
| `scripts/share.ts` | Build, server and tunnel in one command (`pnpm share`) |

```sh
pnpm test        # vitest
pnpm typecheck   # tsc --noEmit
```

---

## License

[AGPL-3.0-only](LICENSE). Network copyleft: anyone running a modified version as
a service reachable over the internet has to offer that version's source to its
users, not only to whoever receives a binary.
