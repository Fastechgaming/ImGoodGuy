#!/usr/bin/env bash
# Pull the latest code and restart the site.
#   ./deploy/update.sh              # update from the current branch
#   ./deploy/update.sh main         # update from a specific branch
set -euo pipefail

BRANCH="${1:-$(git rev-parse --abbrev-ref HEAD)}"
cd "$(dirname "$0")/.."

echo "==> Fetching $BRANCH"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull origin "$BRANCH"

echo "==> Installing dependencies"
# npm ci installs exactly what package-lock.json pins, and never writes to it.
npm ci --omit=dev

echo "==> Restarting the service"
if systemctl list-unit-files | grep -q '^angkorsmp-web.service'; then
  sudo systemctl restart angkorsmp-web
  sleep 2
  systemctl --no-pager --lines=10 status angkorsmp-web || true
else
  echo "    (no systemd unit installed — start it however you normally do)"
fi

echo "==> Done. Check: curl -s localhost:\${PORT:-3000}/healthz"
