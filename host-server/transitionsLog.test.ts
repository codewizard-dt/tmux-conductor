// TASK-143: pollAndDiff already detected every agent status transition and
// appended a thin status_transition event to observability.jsonl (TASK-089).
// This task adds a *separate*, richer logs/transitions.jsonl stream (reason +
// matchedPattern + pane snapshot, sourced from TASK-142's widened
// detectAgentStatus return and buildSnapshot's existing tail15 capture) without
// touching the existing observability.jsonl event or adding a second
// capture-pane call.
//
// index.ts has top-level side effects (it opens the DB, registers Fastify
// plugins, and eventually starts listening) so it cannot be imported directly
// in a unit test — see sseRolePayloadParity.test.ts / rolePresets.test.ts /
// perfBudgets.test.ts for the established precedent of pinning this kind of
// server-wiring behavior via static assertions against the raw source text
// instead. The live, end-to-end behavior (a real transition producing a real
// logs/transitions.jsonl line under a running host-server + tmux session) is
// covered manually in UAT-143, mirroring UAT-144's EDGE-006 for monitor.sh.
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const indexSource = fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8');

void test('appendTransitionLog writes to logs/transitions.jsonl using the same try/mkdirSync/appendFileSync shape as appendObservabilityLog', () => {
  assert.match(
    indexSource,
    /function appendTransitionLog\(payload: Record<string, unknown>\): void \{\s*\n\s*try \{\s*\n\s*const \{ logDir \} = readConductorConf\(\);\s*\n\s*mkdirSync\(logDir, \{ recursive: true \}\);\s*\n\s*appendFileSync\(\s*\n\s*path\.join\(logDir, 'transitions\.jsonl'\),/,
    'expected appendTransitionLog to resolve logDir via readConductorConf(), mkdirSync it, then appendFileSync to logs/transitions.jsonl',
  );
});

void test('appendTransitionLog never throws — its body is wrapped in a silent catch, same as appendObservabilityLog', () => {
  const fnMatch = /function appendTransitionLog\([\s\S]*?\n\}/.exec(indexSource);
  assert.ok(fnMatch, 'expected to find the appendTransitionLog function body');
  const body = fnMatch[0];
  assert.match(
    body,
    /\} catch \{\s*\n\s*\/\*[\s\S]*?\*\/\s*\n\s*\}/,
    'expected appendTransitionLog to swallow write failures in an empty (comment-only) catch block',
  );
  assert.doesNotMatch(body, /\bthrow\b/, 'appendTransitionLog must never rethrow — a logging failure must not break the poll loop');
});

void test("pollAndDiff calls appendTransitionLog immediately after the existing appendObservabilityLog('status_transition', ...) call, with the full reason/matchedPattern/paneTail payload", () => {
  assert.match(
    indexSource,
    /appendObservabilityLog\('status_transition', \{\s*\n\s*agentId: agent\.id,\s*\n\s*agent: agent\.name,\s*\n\s*previousState: prev\.state,\s*\n\s*nextState: agent\.state,\s*\n\s*\}\);\s*\n\s*const detection = lastDetectionByAgentId\.get\(agent\.id\);\s*\n\s*appendTransitionLog\(\{\s*\n\s*agentId: agent\.id,\s*\n\s*agent: agent\.name,\s*\n\s*from: prev\.state,\s*\n\s*to: agent\.state,\s*\n\s*reason: detection\?\.reason \?\? 'state-file',\s*\n\s*matchedPattern: detection\?\.matchedPattern,\s*\n\s*stateFileAgeS: agent\.status\.evidence\.stateFile\.ageSeconds,\s*\n\s*windowPresent: agent\.windowPresent,\s*\n\s*queuedTasks: agent\.queuedTasks,\s*\n\s*paneTail: detection\?\.tail15 \? detection\.tail15\.split\('\\n'\) : \[\],\s*\n\s*\}\);/,
    'expected pollAndDiff to call appendTransitionLog right after appendObservabilityLog(\'status_transition\', ...) with agentId/agent/from/to/reason/matchedPattern/stateFileAgeS/windowPresent/queuedTasks/paneTail',
  );
});

void test("observability.jsonl's status_transition event keeps its original 4-field shape (agentId, agent, previousState, nextState) — TASK-143 must not modify it", () => {
  const callMatch = /appendObservabilityLog\('status_transition', \{[\s\S]*?\}\);/.exec(indexSource);
  assert.ok(callMatch, "expected to find the appendObservabilityLog('status_transition', ...) call site");
  const call = callMatch[0];
  assert.match(call, /agentId: agent\.id,/);
  assert.match(call, /agent: agent\.name,/);
  assert.match(call, /previousState: prev\.state,/);
  assert.match(call, /nextState: agent\.state,/);
  // Exactly 4 payload fields — a 5th key here would mean this task edited the
  // pre-existing event instead of adding a separate transitions.jsonl stream.
  const fieldCount = (call.match(/^\s*\w+: [^,]+,$/gm) ?? []).length;
  assert.equal(fieldCount, 4, `expected exactly 4 fields on the status_transition payload, found ${String(fieldCount)}`);
});

void test('buildSnapshot captures reason/matchedPattern/tail15 into lastDetectionByAgentId right after the single per-agent capturePaneTail/detectAgentStatus call — no second capture-pane call is added for transitions logging', () => {
  assert.match(
    indexSource,
    /const tail15 = windowPresent \? capturePaneTail\(sessionName, wn, 15, 'snapshot'\) : '';\s*\n\s*const \{ state, reason, matchedPattern \} = detectAgentStatusWithBackgroundJobs\(conf, wn, agent\.launchCmd, agent\.workdir, tail15 \|\| undefined, windowPresent, paneCurrentCommand\);\s*\n\s*lastDetectionByAgentId\.set\(agent\.id, \{ reason, matchedPattern, tail15 \}\);/,
    'expected buildSnapshot to set lastDetectionByAgentId from the same tail15/detectAgentStatusWithBackgroundJobs call already used for status/mode detection',
  );

  const fnMatch = /function buildSnapshot\(\): Snapshot \{[\s\S]*?\n\}/.exec(indexSource);
  assert.ok(fnMatch, 'expected to find the buildSnapshot function body');
  const perAgentMapMatch = /const agentStatuses = agents\.map\(\(agent\) => \{[\s\S]*?\n {2}\}\);/.exec(fnMatch[0]);
  assert.ok(perAgentMapMatch, 'expected to find the per-agent agentStatuses.map(...) callback inside buildSnapshot');
  const captureCalls = perAgentMapMatch[0].match(/capturePaneTail\(/g) ?? [];
  assert.equal(
    captureCalls.length,
    1,
    `expected exactly one capturePaneTail(...) call per agent per tick inside buildSnapshot's per-agent loop, found ${String(captureCalls.length)}`,
  );
});

void test('lastDetectionByAgentId is typed to carry reason, matchedPattern, and tail15 (the fields transitions.jsonl needs), and reuses state.ts\'s DetectionReason type rather than a hand-rolled string union', () => {
  assert.match(
    indexSource,
    /const lastDetectionByAgentId = new Map<number, \{ reason: DetectionReason; matchedPattern: 'busy' \| 'idle' \| 'awaiting' \| undefined; tail15: string \}>\(\);/,
    'expected lastDetectionByAgentId to be a Map<number, { reason: DetectionReason; matchedPattern; tail15 }>',
  );
  assert.match(
    indexSource,
    /import \{[^}]*type DetectionReason[^}]*\} from '\.\/state\.ts';/,
    "expected index.ts to import DetectionReason as a type from state.ts rather than redeclaring the union",
  );
});

void test('reason/matchedPattern/tail15 stay in the lastDetectionByAgentId side-channel and never leak into the public Snapshot.agents[] shape that gets JSON-serialized to every SSE client on every diff', () => {
  const snapshotMatch = /interface Snapshot \{[\s\S]*?\n\}/.exec(indexSource);
  assert.ok(snapshotMatch, 'expected to find the Snapshot interface');
  assert.doesNotMatch(snapshotMatch[0], /\breason\b/, 'Snapshot must not declare a reason field');
  assert.doesNotMatch(snapshotMatch[0], /\bmatchedPattern\b/, 'Snapshot must not declare a matchedPattern field');
  assert.doesNotMatch(snapshotMatch[0], /\btail15\b/, 'Snapshot must not declare a tail15 field');

  const fnMatch = /function buildSnapshot\(\): Snapshot \{[\s\S]*?\n\}/.exec(indexSource);
  assert.ok(fnMatch, 'expected to find the buildSnapshot function body');
  const returnMatch = /return \{\s*\n\s*id: agent\.id,[\s\S]*?\n {4}\};/.exec(fnMatch[0]);
  assert.ok(returnMatch, "expected to find buildSnapshot's per-agent return object literal");
  // Check for these as *property keys* (a trailing colon), not merely as a
  // referenced local variable — tail15 is legitimately passed as an argument
  // to detectAgentMode(...) inside this same object literal (e.g. the `mode:`
  // field's value), which must not trip this assertion.
  assert.doesNotMatch(returnMatch[0], /\breason:/, "buildSnapshot's per-agent object literal must not include a reason field");
  assert.doesNotMatch(returnMatch[0], /\bmatchedPattern:/, "buildSnapshot's per-agent object literal must not include a matchedPattern field");
  assert.doesNotMatch(returnMatch[0], /\btail15:/, "buildSnapshot's per-agent object literal must not re-expose tail15 as a field outside the side-channel map");
});
