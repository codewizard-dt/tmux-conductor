#!/usr/bin/env bash
set -euo pipefail

HOST_URL="${HOST_URL:-http://localhost:8788/api}"
OUT_ROOT="${OUT_ROOT:-./tmp/diagnostics}"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT_DIR="${OUT_ROOT%/}/${STAMP}"

mkdir -p "$OUT_DIR"

endpoint="${HOST_URL%/}/perf/live-updates"

{
  echo "# tmux-conductor diagnostics"
  echo "created_at: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "host_url: $HOST_URL"
  echo "metrics_endpoint: $endpoint"
} > "$OUT_DIR/README.md"

if curl -fsS "$endpoint" -o "$OUT_DIR/perf-live-updates.json"; then
  node --input-type=module - "$OUT_DIR/perf-live-updates.json" > "$OUT_DIR/perf-summary.md" <<'NODE'
import { readFileSync } from 'node:fs';

const file = process.argv[2];
const data = JSON.parse(readFileSync(file, 'utf8'));
const timing = (name) => data.liveUpdates?.timings?.[name] ?? {};
const ws = data.liveUpdates?.terminalWebSocket ?? {};
const loop = data.eventLoop ?? {};

console.log('# Performance Summary');
console.log('');
console.log(`Event-loop utilization: ${loop.utilization?.utilization ?? 0}`);
console.log(`Event-loop delay p95 ms: ${loop.delay?.p95Ms ?? 0}`);
console.log(`Event-loop delay p99 ms: ${loop.delay?.p99Ms ?? 0}`);
console.log('');
console.log(`Terminal WS active/opened/closed: ${ws.activeConnections ?? 0}/${ws.opened ?? 0}/${ws.closed ?? 0}`);
console.log(`Terminal WS acks/echoes/errors: ${ws.inputAcks ?? 0}/${ws.inputEchoes ?? 0}/${ws.errors ?? 0}`);
console.log('');
console.log('| Timing | Count | Last ms | Max ms |');
console.log('|---|---:|---:|---:|');
for (const name of ['statusTicks', 'terminalTicks', 'focusedTerminalTicks', 'terminalWsInputAck', 'terminalWsInputEcho']) {
  const metric = timing(name);
  console.log(`| ${name} | ${metric.count ?? 0} | ${metric.lastMs ?? 0} | ${metric.maxMs ?? 0} |`);
}
NODE
else
  echo "Could not fetch $endpoint" > "$OUT_DIR/perf-live-updates.error"
fi

for file in logs/observability.jsonl logs/hooks.jsonl logs/dispatch.jsonl logs/transitions.jsonl; do
  if [[ -f "$file" ]]; then
    cp "$file" "$OUT_DIR/$(basename "$file")"
  fi
done

if command -v tmux >/dev/null 2>&1; then
  tmux list-sessions > "$OUT_DIR/tmux-sessions.txt" 2>&1 || true
  tmux list-windows -a -F '#{session_name}:#{window_index}:#{window_name} #{pane_current_command}' > "$OUT_DIR/tmux-windows.txt" 2>&1 || true
fi

echo "Diagnostic bundle written to $OUT_DIR"
