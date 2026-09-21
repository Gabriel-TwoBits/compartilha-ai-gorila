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

**Publishing and watching run on separate SFU sessions.** One `PartyTracks`
instance is one session over one peer connection, and every track pushed or
pulled renegotiates it. Sharing a connection between the two makes them collide:
opening a broadcast while already publishing pulls the track and closes it again
in the same breath, and the tile goes black over a track that has ended. Two
instances cost two idle sessions and no extra egress.

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

Cloudflare charges only for traffic going **out** to clients, so what you send
is free and what everyone else receives is not: a broadcast costs its bitrate
multiplied by the size of the audience, against a free 1,000 GB/month.

That is why the list of presets in `client/src/quality.ts` is short and stops
where it does:

| preset | bitrate | ~GB/h per viewer | four watching |
|---|---|---|---|
| 720p30 (default) | 2.5 Mbps | 1.1 | ~225 h/month |
| 720p60 | 4.5 Mbps | 2.0 | ~125 h/month |
| 1080p30 | 5.0 Mbps | 2.2 | ~112 h/month |

1080p60 (9 Mbps) and 1440p60 (16 Mbps) are not offered at all — the second would
spend the month's quota over a couple of weekends. A test pins the ceiling, so
adding one is a deliberate act rather than an oversight.

A resolution ceiling alone does not cap the bitrate: a busy screen blows through
whatever the encoder feels like. `maxBitrate` is the number that bounds the
bill, and the picker shows the GB/h beside each option so the choice is made
knowing that.

**TURN spends the same allowance.** It is a separate product but not a separate
quota, and a viewer who falls back to a relay costs roughly double: their video
crosses the relay as well as the SFU. That only happens to whoever cannot reach
the SFU directly, and for them the alternative is a black screen — but it is
worth knowing which number it comes out of.

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

All of that is the browser's story. **The desktop app answers this properly**,
capturing one application at a time — see below.

---

## Hosting it permanently (Tailscale Funnel)

**`http://localhost` works; `http://192.168.x.x` does not.** Capturing the screen
requires a secure context, so the moment the app leaves this machine it needs
HTTPS.

A Cloudflare quick tunnel supplies that in one command, but draws a new random
name every run — an address nobody can bookmark and nothing can be built on.
Tailscale Funnel gives a **permanent** one instead: a fixed
`https://<machine>.<tailnet>.ts.net`, with a certificate Tailscale renews, no
domain to buy and no port forwarded on the router. **Friends install nothing** —
Funnel is the public internet, and Tailscale only runs here.

Only signalling crosses it. Login, the presence socket and the SFU proxy are
kilobytes; the video goes straight from each browser to Cloudflare and never
touches this machine.

**1. Join the tailnet.**

```sh
sudo apt install tailscale        # or https://tailscale.com/download
sudo tailscale up
```

**2. Open the door.** Funnel needs MagicDNS, HTTPS certificates and the `funnel`
node attribute, all in the admin console. Running the next command before that
is fine — it prints exactly what is missing, with a link straight to the switch.

**3. Put it in front of the server.**

```sh
tailscale funnel --bg 8787
tailscale funnel status           # prints the public URL
```

`--bg` is what makes it permanent: the mapping is stored in `tailscaled` and
comes back on its own after a reboot. There is no service of ours to install for
this half.

**Then wait an hour before believing anything.** The public DNS records are
published by Tailscale, the documentation says "up to 10 minutes", and measured
here it took **an hour** — with the AAAA record arriving some forty minutes
before the A. Until the A lands the address is unreachable from any network
without IPv6, which looks exactly like a broken setup. Renaming the node or
toggling Funnel restarts that clock, so the one thing not to do while waiting is
fiddle.

Testing it from inside the tailnet needs a nudge, because MagicDNS answers with
the internal address and never touches the public path:

```sh
curl --resolve <machine>.<tailnet>.ts.net:443:<public A record> \
  https://<machine>.<tailnet>.ts.net/
```

**4. Keep the server up.** `scripts/gorila.service` is a user unit — nothing here
needs root:

```sh
cp scripts/gorila.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now gorila
loginctl enable-linger              # survives closing the terminal
```

Then stop the machine from sleeping. A suspended host takes the Funnel down with
it, and the address answers nothing until it wakes.

### If a second VPN shares the machine

Tailscale and Cloudflare WARP do not coexist. While WARP is up it replaces this
machine's network identity, Tailscale announces endpoints that belong to WARP,
and the Funnel relay can no longer reach here — the room is unreachable from
outside while looking perfectly healthy from in here, which is the worst way for
something to break.

Two things make that livable rather than ruinous, and both are measured:

- **`tailscale set --accept-dns=false`.** With no `systemd-resolved` on the
  machine, `/etc/resolv.conf` is a plain file that both clients overwrite and
  then restore from their own stale copy. Losing that fight left the machine
  with no DNS at all whenever WARP disconnected — a reboot to recover. Tailscale
  stepping out of it makes WARP the sole owner. The cost is that MagicDNS no
  longer resolves locally, which is fine: the Funnel hostname has public records.
- **`scripts/tailscale-after-warp.service`.** Tailscale never notices WARP
  tearing its interface down: it keeps announcing addresses that no longer exist
  and the room stays down indefinitely. The watcher restarts `tailscaled` when
  the interface disappears, and the room is back in about forty seconds. It is
  event-driven (`ip monitor`), so it costs nothing while idle. Install with the
  commands in the header of the unit file.

Both are patches over two VPNs forced to share one machine. The real answer is
for the room not to depend on this machine's network at all.

Hand the URL out with the `ROOM_PASSWORD`, and ask for Chrome/Chromium (see
"Known limitations"). Anyone holding the URL lands on the login screen, so the
password stays the gate.

### Testing without setting any of that up

`pnpm share` still builds the client, starts the server in production mode and
puts a throwaway Cloudflare quick tunnel in front, announcing the URL as soon as
it exists:

```
  Room reachable at https://<four-words>.trycloudflare.com
```

`Ctrl+C` takes down server and tunnel together and the address dies with them.
It asks for no account and costs nothing, but carries no uptime guarantee and
cuts off at 200 concurrent requests: it is for testing, not for hosting.

To exercise the app in development, point a tunnel at Vite (`cloudflared tunnel
--url http://localhost:5173`, or `tailscale funnel 5173`) instead of Node — that
is why `vite.config.ts` accepts both host suffixes. On that path the cookie comes
out without `Secure` and HMR may complain through the tunnel; for testing with
real people, prefer the production route above.

### When the video never arrives

A black screen and `ICE failed` in the console mean there is no direct UDP path
to the SFU, almost always a symmetric NAT or a network blocking outbound UDP on
the viewer's side. TURN is the fix: create the key under Realtime → TURN, fill in
`TURN_APP_ID` and `TURN_APP_TOKEN` and restart the server, which reads the
environment only at boot. The address does not change.

Set it up before handing the link out rather than after. This failure lands on
the viewer's network, not on yours, and from here it is indistinguishable from
"it just doesn't work".

To check it took, log in and fetch `/partytracks/generate-ice-servers`: with
TURN configured the answer carries `turn:` and `turns:` URLs alongside the STUN
one, with a short-lived username and credential. The pair on ports 80 and 443 is
the one that matters most — it is what gets through a network that only allows
what looks like web traffic.

Enabling TURN also changes the STUN entry Cloudflare offers, dropping the port 53
URL that `server/iceServers.ts` exists to remove. That module stays as a guard
rather than a load-bearing part.

## The desktop app

`desktop/` is an Electron shell around this same client: the window loads the
room's own URL, so the whole interface is reused rather than rebuilt. What it
adds is the two things a browser cannot do — list the screens itself, and
capture audio **one application at a time**, which is what keeps the Discord
call out of a broadcast.

```sh
cd desktop
npm install
npm start          # builds the bundles and opens the app
npm run dist       # AppImage and .deb into dist-app/
npm run dist:win   # NSIS installer — needs Wine, see below
```

**The Windows installer needs Wine**, and there is no way around it: NSIS is the
only Windows target `electron-updater` can update in place, and the packager
shells out to `signtool.exe` while building it. Turning off
`signAndEditExecutable` skips that step for the app's own executable but not for
NSIS itself.

Rather than putting Wine on the machine, build in the image that already has it:

```sh
cd desktop
docker run --rm \
  -v "$PWD":/project \
  -v "$HOME/.cache/electron":/root/.cache/electron \
  -v "$HOME/.cache/electron-builder":/root/.cache/electron-builder \
  -w /project electronuserland/builder:wine \
  /bin/bash -c "npm run dist:win"
```

The image is ~4.7 GB once, the two cache mounts stop it re-downloading Electron
every run, and nothing lands on the host. Under rootless Docker or podman the
artifacts come out owned by you.

Point it somewhere else with `GORILA_URL=http://localhost:8787 npm start`.

Per-application audio is PipeWire on Linux and a WASAPI addon on Windows. Both
hand over the same 16-bit stereo PCM at 48 kHz, so the mixing worklet in the
client is shared. The Windows half was written without a Windows machine to try
it on: its pure logic is covered by tests, the rest is waiting for a real one.

### Cutting a release

1. Raise `version` in `desktop/package.json` — the number is what decides
   whether an installed copy considers itself out of date.
2. `npm run dist` (and `npm run dist:win`, which needs Wine).
3. **`npm run smoke`**, and do not skip it. It opens the packaged app and checks
   it reaches the room. A release once went out whose bundle threw on the first
   line of the main process: nothing in development showed it — the failing
   module only loads in a packaged app — and the updater could not rescue
   anybody either, because an app that dies at startup never gets far enough to
   look for a new version. Whoever had downloaded it was stuck until they
   fetched a new file by hand.
4. Copy from `desktop/dist-app/` into `release/`: the versioned artifacts, their
   `.blockmap` where one exists, and the `latest*.yml` feed. Windows and Linux
   have separate feeds, so one can be published without touching the other.
5. Copy each installer again under a name with no version in it
   (`CompartilhaAiGorila.AppImage`, `CompartilhaAiGorila.deb`,
   `CompartilhaAiGorila-instalador.exe`). Those are what the download buttons
   point at, so a link handed out once keeps working. An app already installed
   never uses them — the updater follows the feed to the versioned file.
6. **`pnpm ship`.** The room runs on a different machine than the one that
   builds, so a release sitting in a local `release/` has been published to
   nobody. This sends the tree — installers and server code both — and restarts
   the service, then checks the feed answers `200` before reporting success.
   `desktop/` stays behind: its 2.6 G of build tree has no use there, and
   `release/` is its only product that matters.

The SSH destination is `server` from `~/.ssh/config`; `GORILA_REMOTE` overrides
it. Nothing else in the repository names the host.

**The `.blockmap` has to go up too.** Without it there is no differential
download and every update pulls the whole ~100 MB again, which is exactly what
should not be crossing the tunnel. The blockmap alone is not enough, either:
the updater asks for the changed blocks as one multi-range request, and
`@hono/node-server`'s static handler answers those with the whole file under a
`206` status. `server/ranges.ts` handles them before it gets the chance —
measured, that is the difference between 165 KB and 122 MB per person per
release.

### Opening the app

It looks for a new version before the main window exists, behind a small splash,
and installs one if it finds it — nobody should walk into a version that is
replaced a minute later. Two ceilings bound that: ten seconds to ask, ninety to
fetch. Past either, the app opens anyway and whatever was downloading finishes
behind it, surfacing as the banner. A server that is down never keeps anybody
out of their own app.

## Known limitations

- **Screen audio** depends on the browser and the operating system, and on Linux
  the screen picker hands over none. When the video arrives and the audio does
  not, this is almost always the reason and not the code — see "Audio" above for
  the way around it.
- **The media travels through Cloudflare** even with the app running locally.
  That is inherent to their SFU — see "Bandwidth" above.
- **The room lives in memory.** Restarting the server empties it, and everyone
  reconnects on their own.
- **A still window under Wayland sends almost nothing**, and looks exactly like a
  broadcast that never started. The portal hands over a frame only when the
  window itself changes: measured here, 1 frame in 4 seconds for a window
  sitting idle against 119 for the same window animating. The whole screen never
  shows this — a clock or the cursor is always moving somewhere on it. Nothing
  is broken; the picture arrives the moment the window does something.

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
| `client/src/tracks.ts` | The two PartyTracks sessions, and which screen source is in use |
| `client/src/quality.ts` | The preset table, and what each one costs per viewer |
| `client/src/audioSource.ts` | Which audio source the broadcast uses, and its capture |
| `client/src/components/Stage.tsx` | Main panel: local preview or remote track |
| `scripts/share.ts` | Build, server and quick tunnel in one command (`pnpm share`) |
| `scripts/gorila.service` | systemd user unit that keeps the server up across reboots |
| `desktop/src/main.ts` | The app's window, IPC and lifecycle |
| `desktop/src/pipewireGraph.ts` | Reading the PipeWire graph and deciding what to wire |
| `desktop/src/windowsProcesses.ts` | Which Windows processes may reach the broadcast |
| `client/src/processAudio.ts` | Captured PCM into one WebRTC audio track |

```sh
pnpm test        # vitest
pnpm typecheck   # tsc --noEmit
```

---

## License

[AGPL-3.0-only](LICENSE). Network copyleft: anyone running a modified version as
a service reachable over the internet has to offer that version's source to its
users, not only to whoever receives a binary.
