#!/usr/bin/env bash
set -euo pipefail

HOST_URL="${HOST_URL:-http://localhost:8788/api}"
DURATION_SECONDS="${DURATION_SECONDS:-30}"

endpoint="${HOST_URL%/}/perf/live-updates"

node --input-type=module - "$endpoint" "$DURATION_SECONDS" <<'NODE'
const [endpoint, durationRaw] = process.argv.slice(2);
const durationSeconds = Number(durationRaw);

if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
  console.error('DURATION_SECONDS must be a positive number');
  process.exit(2);
}

async function readMetrics() {
  let response;
  try {
    response = await fetch(endpoint);
  } catch (error) {
    console.error(`Unable to reach ${endpoint}: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
  if (!response.ok) {
    console.error(`Metrics endpoint returned HTTP ${response.status}`);
    process.exit(1);
  }
  return response.json();
}

function timing(data, name) {
  return data?.liveUpdates?.timings?.[name] ?? { count: 0, totalMs: 0, maxMs: 0, lastMs: 0 };
}

function countDelta(start, end, name) {
  return timing(end, name).count - timing(start, name).count;
}

function totalDelta(start, end, name) {
  return Number((timing(end, name).totalMs - timing(start, name).totalMs).toFixed(3));
}

const start = await readMetrics();
await new Promise((resolve) => setTimeout(resolve, durationSeconds * 1000));
const end = await readMetrics();

const names = [
  'statusTicks',
  'terminalTicks',
  'focusedTerminalTicks',
  'tmuxCaptureTail',
  'tmuxCaptureTailRaw',
  'sseBroadcasts',
  'tailRequests',
];

console.log(`Endpoint: ${endpoint}`);
console.log(`Duration seconds: ${durationSeconds}`);
console.log(`Active SSE connections: ${end.liveUpdates?.activeSseConnections ?? 0}`);
console.log('');
console.log('| Metric | Count delta | Rate/sec | Total ms delta | End max ms |');
console.log('|---|---:|---:|---:|---:|');
for (const name of names) {
  const count = countDelta(start, end, name);
  const totalMs = totalDelta(start, end, name);
  const rate = (count / durationSeconds).toFixed(3);
  const maxMs = timing(end, name).maxMs ?? 0;
  console.log(`| ${name} | ${count} | ${rate} | ${totalMs} | ${maxMs} |`);
}
NODE
