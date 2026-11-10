#!/usr/bin/env bash
# Deploy a branch to Snow: pull, rebuild, wait for the health check.
# Usage: scripts/deploy.sh [branch]   (default: main)
set -euo pipefail

BRANCH="${1:-main}"
QUOTED="$(printf %q "$BRANCH")"

ssh snow "BRANCH=$QUOTED bash -s" <<'REMOTE'
set -euo pipefail
cd ~/drama-chat
git fetch origin
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"
mkdir -p data/backups
docker compose up -d --build

for i in $(seq 1 30); do
  if docker compose exec -T app node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
    echo "healthy after $i check(s)"
    exit 0
  fi
  sleep 2
done

echo "health check failed; last app logs:" >&2
docker compose logs --tail 80 app >&2
exit 1
REMOTE
