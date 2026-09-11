#!/bin/sh
# Restarts tailscaled when Cloudflare WARP goes away.
#
# The two do not coexist: while WARP is up, Tailscale announces the endpoints
# WARP handed it, the Funnel relay can no longer reach this machine, and the
# room is unreachable from outside. That much is expected.
#
# What is not expected is that Tailscale never recovers on its own. When WARP
# tears its interface down, the daemon does not notice the network changed — it
# keeps announcing addresses that no longer exist, and the room stays down
# indefinitely. Measured: still stale after several minutes, and back within
# forty seconds of a restart.
#
# This is a patch over two VPNs forced to share a machine, not a design. The
# room not depending on this machine's network at all is the real answer.
#
# Event-driven, not polled: `ip monitor` blocks until the kernel says something,
# so this costs nothing while idle — which matters on a machine that is also
# used for playing games.
set -eu

INTERFACE=CloudflareWARP

# Long enough for WARP's routes and resolv.conf to be torn down before the
# daemon re-reads them; short enough not to be felt.
SETTLE_SECONDS=5

ip monitor link | while read -r line; do
  case "$line" in
    "Deleted "*" $INTERFACE:"*)
      logger -t tailscale-after-warp "$INTERFACE went away; restarting tailscaled"
      sleep "$SETTLE_SECONDS"
      systemctl restart tailscaled
      ;;
  esac
done
