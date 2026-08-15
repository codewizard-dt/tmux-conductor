import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { extractUsageDeltas, resetUsageMemo, getUsageSessionStart } from './usage.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpDir = path.resolve(__dirname, '../tmp');

interface Fixture {
  agent: string;
  workdir: string;
  stateDir: string;
  transcriptPath: string;
}

function makeFixture(label: string): Fixture {
  const rand = Math.random().toString(36).slice(2, 10);
  const dir = path.join(tmpDir, `usage-test-${label}-${rand}`);
  const stateDir = path.join(dir, 'state');
  fs.mkdirSync(stateDir, { recursive: true });
  const agent = `agent-${label}-${rand}`;
  const transcriptPath = path.join(dir, 'session-a.jsonl');
  fs.writeFileSync(transcriptPath, '');
  writeSidecar(stateDir, agent, transcriptPath, 'session-a');
  return { agent, workdir: dir, stateDir, transcriptPath };
}

function writeSidecar(stateDir: string, agent: string, transcriptPath: string, sessionId: string): void {
  fs.writeFileSync(
    path.join(stateDir, `${agent}.meta.json`),
    JSON.stringify({ transcript_path: transcriptPath, session_id: sessionId }),
  );
}

function assistantLine(opts: {
  requestId?: string;
  uuid?: string;
  input?: number;
  output?: number;
  cacheCreation?: number;
  cacheRead?: number;
  model?: string;
  sidechain?: boolean;
  timestamp?: string;
}): string {
  return JSON.stringify({
    type: 'assistant',
    isSidechain: opts.sidechain ?? false,
    requestId: opts.requestId,
    uuid: opts.uuid ?? `uuid-${Math.random().toString(36).slice(2, 10)}`,
    timestamp: opts.timestamp ?? '2026-07-06T12:00:00.000Z',
    message: {
      id: 'msg_x',
      model: opts.model ?? 'claude-fable-5',
      usage: {
        input_tokens: opts.input ?? 0,
        output_tokens: opts.output ?? 0,
        cache_creation_input_tokens: opts.cacheCreation ?? 0,
        cache_read_input_tokens: opts.cacheRead ?? 0,
      },
    },
  }) + '\n';
}

test('streaming dedup — last entry per requestId wins', () => {
  const f = makeFixture('dedup');
  fs.writeFileSync(
    f.transcriptPath,
    assistantLine({ requestId: 'req_1', output: 10, cacheRead: 100 }) +
    assistantLine({ requestId: 'req_1', output: 50, cacheRead: 100 }) +
    assistantLine({ requestId: 'req_1', output: 120, cacheRead: 100 }),
  );
  const deltas = extractUsageDeltas(f.agent, f.workdir, f.stateDir);
  assert.equal(deltas.length, 1);
  assert.equal(deltas[0]!.outputTokens, 120); // not 180
  assert.equal(deltas[0]!.cacheReadTokens, 100); // not 300
  assert.equal(deltas[0]!.model, 'claude-fable-5');
  assert.equal(deltas[0]!.sessionId, 'session-a');
  resetUsageMemo(f.agent);
});

test('incremental — second poll returns only appended records, unchanged file returns []', () => {
  const f = makeFixture('incr');
  fs.writeFileSync(f.transcriptPath, assistantLine({ requestId: 'req_1', output: 40, input: 5 }));
  const first = extractUsageDeltas(f.agent, f.workdir, f.stateDir);
  assert.equal(first.length, 1);
  assert.equal(first[0]!.outputTokens, 40);

  fs.appendFileSync(f.transcriptPath, assistantLine({ requestId: 'req_2', output: 30 }));
  const second = extractUsageDeltas(f.agent, f.workdir, f.stateDir);
  assert.equal(second.length, 1);
  assert.equal(second[0]!.outputTokens, 30);
  assert.equal(second[0]!.inputTokens, 0);

  assert.deepEqual(extractUsageDeltas(f.agent, f.workdir, f.stateDir), []);
  resetUsageMemo(f.agent);
});

test('sidechain, <synthetic>, and malformed lines are ignored without throwing', () => {
  const f = makeFixture('filter');
  fs.writeFileSync(
    f.transcriptPath,
    assistantLine({ requestId: 'req_side', output: 999, sidechain: true }) +
    assistantLine({ requestId: 'req_synth', output: 888, model: '<synthetic>' }) +
    '{"type":"assistant","message":{"usage":{"output_tokens": broken\n' +
    assistantLine({ requestId: 'req_ok', output: 7 }),
  );
  const deltas = extractUsageDeltas(f.agent, f.workdir, f.stateDir);
  assert.equal(deltas.length, 1);
  assert.equal(deltas[0]!.outputTokens, 7);
  resetUsageMemo(f.agent);
});

test('session change resets the memo and re-emits from the new transcript', () => {
  const f = makeFixture('session');
  fs.writeFileSync(f.transcriptPath, assistantLine({ requestId: 'req_1', output: 40, timestamp: '2026-07-06T10:00:00.000Z' }));
  extractUsageDeltas(f.agent, f.workdir, f.stateDir);
  assert.equal(getUsageSessionStart(f.agent), '2026-07-06T10:00:00.000Z');

  const newTranscript = path.join(f.workdir, 'session-b.jsonl');
  fs.writeFileSync(newTranscript, assistantLine({ requestId: 'req_9', output: 11, timestamp: '2026-07-06T11:00:00.000Z' }));
  writeSidecar(f.stateDir, f.agent, newTranscript, 'session-b');

  const deltas = extractUsageDeltas(f.agent, f.workdir, f.stateDir);
  assert.equal(deltas.length, 1);
  assert.equal(deltas[0]!.outputTokens, 11);
  assert.equal(deltas[0]!.sessionId, 'session-b');
  assert.equal(getUsageSessionStart(f.agent), '2026-07-06T11:00:00.000Z');
  resetUsageMemo(f.agent);
});

test('no sidecar → [] without error', () => {
  const rand = Math.random().toString(36).slice(2, 10);
  const dir = path.join(tmpDir, `usage-test-nosidecar-${rand}`);
  const stateDir = path.join(dir, 'state');
  fs.mkdirSync(stateDir, { recursive: true });
  // workdir has no ~/.claude/projects mapping either, so derivation also fails
  assert.deepEqual(extractUsageDeltas(`agent-${rand}`, path.join(dir, 'no-such-workdir'), stateDir), []);
});

test('truncation (size < offset) resets the memo — no negative deltas', () => {
  const f = makeFixture('trunc');
  fs.writeFileSync(
    f.transcriptPath,
    assistantLine({ requestId: 'req_1', output: 100 }) + assistantLine({ requestId: 'req_2', output: 200 }),
  );
  extractUsageDeltas(f.agent, f.workdir, f.stateDir);

  // Rewrite shorter — simulates rotation/truncation.
  fs.writeFileSync(f.transcriptPath, assistantLine({ requestId: 'req_3', output: 5 }));
  const deltas = extractUsageDeltas(f.agent, f.workdir, f.stateDir);
  assert.equal(deltas.length, 1);
  assert.equal(deltas[0]!.outputTokens, 5);
  for (const d of deltas) {
    assert.ok(d.inputTokens >= 0 && d.outputTokens >= 0 && d.cacheCreationTokens >= 0 && d.cacheReadTokens >= 0);
  }
  resetUsageMemo(f.agent);
});

test('streaming update across polls emits only the per-field difference', () => {
  const f = makeFixture('stream');
  fs.writeFileSync(f.transcriptPath, assistantLine({ requestId: 'req_1', output: 30 }));
  const first = extractUsageDeltas(f.agent, f.workdir, f.stateDir);
  assert.equal(first[0]!.outputTokens, 30);

  // Same requestId re-logged with a larger snapshot (mid-stream update).
  fs.appendFileSync(f.transcriptPath, assistantLine({ requestId: 'req_1', output: 120 }));
  const second = extractUsageDeltas(f.agent, f.workdir, f.stateDir);
  assert.equal(second.length, 1);
  assert.equal(second[0]!.outputTokens, 90); // 120 - 30, so totals converge to 120
  resetUsageMemo(f.agent);
});
