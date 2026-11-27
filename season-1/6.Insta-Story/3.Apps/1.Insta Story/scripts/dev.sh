#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

APP_NAME="flipkart-dev"

if pnpm exec pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  echo "pm2: $APP_NAME already running, restarting..."
  pnpm exec pm2 restart "$APP_NAME"
else
  echo "pm2: $APP_NAME not running, starting..."
  pnpm exec pm2 start ecosystem.config.json --only "$APP_NAME"
fi

pnpm exec pm2 logs "$APP_NAME" --lines 20
