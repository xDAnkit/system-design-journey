#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

APP_NAME="flipkart-prod"

# Build first, once — pm2 runs the built dist/server.js directly in cluster mode (4
# instances), so the build must not happen inside the pm2-managed command itself
# (that would fire once per cluster worker and race).
pnpm build:prod

if pnpm exec pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  echo "pm2: $APP_NAME already running, reloading (zero-downtime)..."
  pnpm exec pm2 reload "$APP_NAME"
else
  echo "pm2: $APP_NAME not running, starting..."
  pnpm exec pm2 start ecosystem.config.json --only "$APP_NAME"
fi

pnpm exec pm2 logs "$APP_NAME" --lines 20
