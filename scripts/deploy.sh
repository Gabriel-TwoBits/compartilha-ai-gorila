#!/bin/bash
# Publishes the working tree to the machine that hosts the room.
#
# The room server no longer runs on the development machine, so a release is not
# finished when `release/` fills up locally: the installers and the server code
# both have to travel. Installers are static files the running process serves
# straight off disk, but server code only takes effect on restart, so this ends
# with one.
#
# The SSH destination comes from ~/.ssh/config. Override with GORILA_REMOTE when
# deploying somewhere else.
set -euo pipefail

REMOTE=${GORILA_REMOTE:-server}
REMOTE_DIR=personal-projects/compartilha-ai-gorila
HEALTH_URL=http://127.0.0.1:8787/atualiza/latest-linux.yml
REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

cd "$REPO_ROOT"

# desktop/ is the Electron build tree: 2.6 G of sources and dist-app output that
# only the development machine ever needs. Its product is release/, which does go.
rsync -aH --delete --partial --timeout=120 --info=progress2 \
      --exclude='desktop/' \
      --exclude='.git/' \
      --exclude='node_modules/.cache/' \
      ./ "$REMOTE:$REMOTE_DIR/"

ssh "$REMOTE" "systemctl --user restart gorila"

# A restart that fails leaves the previous process dead, so confirm rather than
# assume: an unreachable feed means every installed copy stops finding updates.
sleep 3
state=$(ssh "$REMOTE" "systemctl --user is-active gorila")
code=$(ssh "$REMOTE" "curl -s -o /dev/null -w '%{http_code}' $HEALTH_URL")

printf 'gorila: %s\nfeed  : HTTP %s\n' "$state" "$code"

if [ "$state" != "active" ] || [ "$code" != "200" ]; then
    echo "DEPLOY FALHOU -- veja: ssh $REMOTE 'journalctl --user -u gorila -n 30'" >&2
    exit 1
fi

echo "OK"
