import { readFileSync } from 'node:fs';

const budgetsSource = readFileSync(new URL('../host-server/perfBudgets.ts', import.meta.url), 'utf8');
const serverSource = readFileSync(new URL('../host-server/index.ts', import.meta.url), 'utf8');

const requiredBudgets = [
  'maxStatusTickMs',
  'maxTerminalTickMs',
  'maxFocusedTerminalTickMs',
  'maxCaptureCallsPerAgentPerStatusInterval',
  'maxDashboardSseConnections',
];

for (const key of requiredBudgets) {
  if (!budgetsSource.includes(key)) {
    throw new Error(`Missing performance budget: ${key}`);
  }
}

const requiredMetrics = [
  'statusTicks',
  'terminalTicks',
  'focusedTerminalTicks',
  'tmuxCaptureTail',
  'tmuxCaptureTailRaw',
  'sseBroadcasts',
  'tailRequests',
  'terminalWsSnapshots',
  'terminalWsInputAck',
  'terminalWsInputEcho',
];

for (const key of requiredMetrics) {
  if (!serverSource.includes(key)) {
    throw new Error(`Missing live-update metric: ${key}`);
  }
}

if (!serverSource.includes("timeSync('statusTicks', pollAndDiff)")) {
  throw new Error('status poll loop is not timed');
}

if (!serverSource.includes("timeSync('terminalTicks', tailPollLoop)")) {
  throw new Error('terminal poll loop is not timed');
}

if (!serverSource.includes("timeSync('focusedTerminalTicks', tailPollLoopFocus)")) {
  throw new Error('focused terminal poll loop is not timed');
}

if (!serverSource.includes('prevTailMapFocus.get(a.id) !== text')) {
  throw new Error('focused terminal loop does not suppress unchanged snapshots');
}

const requiredObservabilityHooks = [
  'monitorEventLoopDelay',
  'eventLoopUtilization',
  'tmuxOperations',
  'terminalWebSocket',
  'status_transition',
  'slow_loop',
  'tmux_timeout',
  'observability.jsonl',
];

for (const key of requiredObservabilityHooks) {
  if (!serverSource.includes(key)) {
    throw new Error(`Missing observability hook: ${key}`);
  }
}

console.log('host performance checks passed');
