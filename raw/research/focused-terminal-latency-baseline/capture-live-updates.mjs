#!/usr/bin/env node

const DEFAULT_URL = 'http://localhost:4321/api/perf/live-updates';
const DEFAULT_OUT = 'raw/research/focused-terminal-latency-baseline/live-updates-baseline.json';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (!arg.startsWith('--')) continue;
  const key = arg.slice(2);
  const next = process.argv[i + 1];
  if (next && !next.startsWith('--')) {
    args.set(key, next);
    i += 1;
  } else {
    args.set(key, 'true');
  }
}

const url = args.get('url') ?? process.env.PERF_URL ?? DEFAULT_URL;
const out = args.get('out') ?? DEFAULT_OUT;
const before = Number.parseInt(args.get('before') ?? '5', 10);
const during = Number.parseInt(args.get('during') ?? '30', 10);
const after = Number.parseInt(args.get('after') ?? '5', 10);
const intervalMs = Number.parseInt(args.get('interval-ms') ?? '500', 10);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function percentile(values, pct) {
  const clean = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (clean.length === 0) return null;
  const index = Math.min(clean.length - 1, Math.ceil((pct / 100) * clean.length) - 1);
  return clean[index];
}

function round(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Math.round(value * 1000) / 1000;
}

function timingDelta(prev, next) {
  if (!prev || !next) return null;
  const countDelta = next.count - prev.count;
  const totalDeltaMs = next.totalMs - prev.totalMs;
  return {
    countDelta,
    totalDeltaMs: round(totalDeltaMs),
    avgDeltaMs: countDelta > 0 ? round(totalDeltaMs / countDelta) : null,
    lastMs: next.lastMs,
    maxMs: next.maxMs,
  };
}

function snapshotDelta(prev, next) {
  if (!prev) return null;
  const prevMetrics = prev.body.liveUpdates;
  const nextMetrics = next.body.liveUpdates;
  const timings = {};
  for (const [name, metric] of Object.entries(nextMetrics.timings)) {
    timings[name] = timingDelta(prevMetrics.timings[name], metric);
  }
  return {
    sseOpenedDelta: nextMetrics.sseConnections.opened - prevMetrics.sseConnections.opened,
    sseClosedDelta: nextMetrics.sseConnections.closed - prevMetrics.sseConnections.closed,
    activeSseConnections: nextMetrics.activeSseConnections,
    sseBroadcastsByEventDelta: Object.fromEntries(
      Object.entries(nextMetrics.sseBroadcastsByEvent).map(([eventName, count]) => [
        eventName,
        count - (prevMetrics.sseBroadcastsByEvent[eventName] ?? 0),
      ]),
    ),
    timings,
  };
}

async function sample(phase, index, prev) {
  const startedAt = performance.now();
  const response = await fetch(url);
  const fetchedAt = performance.now();
  if (!response.ok) {
    throw new Error(`GET ${url} failed: ${response.status} ${response.statusText}`);
  }
  const body = await response.json();
  const snapshot = {
    phase,
    index,
    sampledAt: new Date().toISOString(),
    fetchMs: round(fetchedAt - startedAt),
    body,
  };
  snapshot.deltaFromPrevious = snapshotDelta(prev, snapshot);
  return snapshot;
}

async function runPhase(name, count, prev, samples) {
  for (let index = 0; index < count; index += 1) {
    const snapshot = await sample(name, index, prev);
    samples.push(snapshot);
    prev = snapshot;
    if (index < count - 1) await sleep(intervalMs);
  }
  return prev;
}

function summarize(samples) {
  const summary = { sampleCount: samples.length, phases: {}, metrics: {} };
  for (const phase of ['before', 'during', 'after']) {
    summary.phases[phase] = samples.filter((sample) => sample.phase === phase).length;
  }

  const metricNames = new Set();
  for (const sample of samples) {
    const timings = sample.deltaFromPrevious?.timings ?? {};
    for (const name of Object.keys(timings)) metricNames.add(name);
  }

  for (const name of metricNames) {
    const values = samples
      .map((sample) => sample.deltaFromPrevious?.timings?.[name]?.avgDeltaMs)
      .filter((value) => value !== null && value !== undefined);
    summary.metrics[name] = {
      samples: values.length,
      medianAvgDeltaMs: round(percentile(values, 50)),
      p95AvgDeltaMs: round(percentile(values, 95)),
      maxAvgDeltaMs: values.length ? round(Math.max(...values)) : null,
    };
  }
  return summary;
}

const samples = [];
let previous = null;
previous = await runPhase('before', before, previous, samples);
console.error('Open or keep focused terminal active now; sampling during phase next.');
previous = await runPhase('during', during, previous, samples);
console.error('Focused during phase complete; sampling after phase next.');
await runPhase('after', after, previous, samples);

const result = {
  scenario: {
    url,
    intervalMs,
    requestedSamples: { before, during, after },
    capturedAt: new Date().toISOString(),
    instructions: [
      'Start the dashboard and host-server.',
      'Run this helper, then open a representative focused agent detail terminal before the during phase.',
      'Keep the focused terminal visible until the during phase completes.',
    ],
  },
  summary: summarize(samples),
  samples,
};

await import('node:fs/promises').then((fs) => fs.writeFile(out, `${JSON.stringify(result, null, 2)}\n`));
console.log(out);
console.log(JSON.stringify(result.summary, null, 2));
