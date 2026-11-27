#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")" && pwd)"
js="$root/scripts/rs-status.js"

containers=(fk-mongo-primary fk-mongo-secondary-1 fk-mongo-secondary-2)

for c in "${containers[@]}"; do
  if docker exec "$c" mongosh --quiet --eval "db.adminCommand({ ping: 1 }).ok" >/dev/null 2>&1; then
    echo "queried     : $c  (container name ≠ replica role)"
    docker exec -i "$c" mongosh --quiet --file /dev/stdin < "$js"
    exit 0
  fi
done

echo "No replica member is up. Start with: pnpm mongo:up"
exit 1
