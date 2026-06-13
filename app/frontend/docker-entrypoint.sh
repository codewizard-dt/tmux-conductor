#!/bin/sh
set -e
npm install
HASH=$(md5sum package.json | cut -d' ' -f1)
APP_PID=""
start_app() { npx vite --host & APP_PID=$!; }
stop_app() { if [ -n "$APP_PID" ]; then kill "$APP_PID" 2>/dev/null; wait "$APP_PID" 2>/dev/null || true; APP_PID=""; fi; }
start_app
while sleep 3; do
  NEW=$(md5sum package.json | cut -d' ' -f1)
  if [ "$NEW" != "$HASH" ]; then
    echo "[entrypoint] package.json changed — reinstalling..."
    npm install; HASH=$NEW; stop_app; start_app
  fi
done
