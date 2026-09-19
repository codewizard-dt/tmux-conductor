import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { modelContextLimit, getAgentContext } from './context.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpDir = path.resolve(__dirname, '../tmp');

// TASK-132: modelContextLimit() drives getAgentContext()'s contextLimitConfident
// branching, so its table lookups (exact id, dated-suffix id, and the
// unrecognized-id null fallback) are pinned directly here.
void test('modelContextLimit: claude-sonnet-5 resolves to 1_000_000', () => {
  assert.equal(modelContextLimit('claude-sonnet-5'), 1_000_000);
});

void test('modelContextLimit: claude-sonnet-4-5 resolves to 200_000', () => {
  assert.equal(modelContextLimit('claude-sonnet-4-5'), 200_000);
});

void test('modelContextLimit: claude-opus-5 resolves to 1_000_000', () => {
  assert.equal(modelContextLimit('claude-opus-5'), 1_000_000);
});

void test('modelContextLimit: a dated-suffix id (claude-sonnet-4-5-20250929) still matches its family prefix and resolves to 200_000', () => {
  assert.equal(modelContextLimit('claude-sonnet-4-5-20250929'), 200_000);
});

void test('modelContextLimit: an unrecognized model id resolves to null', () => {
  assert.equal(modelContextLimit('claude-totally-unknown-model'), null);
});

/**
 * Build a minimal fixture transcript containing one non-sidechain assistant
 * turn with `usage`, the shape readTranscriptInfo() scans for (see
 * context.ts's TranscriptRec). This is the transcript getAgentContext()
 * reads once its sidecar-pinned path resolves to `trusted: true`.
 */
function writeFixtureTranscript(dir: string, modelId: string): string {
  const transcriptPath = path.join(dir, 'session.jsonl');
  const record = {
    type: 'assistant',
    isSidechain: false,
    message: {
      model: modelId,
      usage: { input_tokens: 100, cache_creation_input_tokens: 50, cache_read_input_tokens: 25 },
    },
  };
  fs.writeFileSync(transcriptPath, `${JSON.stringify(record)}\n`, 'utf8');
  return transcriptPath;
}

/**
 * Write the hook-written sidecar (`<agent>.meta.json`) that
 * resolveTranscriptPath() reads first and trusts unconditionally (source:
 * 'sidecar'), which is what makes getAgentContext() read token counts from
 * the fixture transcript above instead of falling back to the generic
 * derived-path/no-transcript paths.
 */
function writeSidecar(stateDir: string, agentName: string, transcriptPath: string, sessionId: string): void {
  fs.writeFileSync(
    path.join(stateDir, `${agentName}.meta.json`),
    JSON.stringify({ transcript_path: transcriptPath, session_id: sessionId }),
    'utf8',
  );
}

void test('getAgentContext: contextLimitConfident is true when the model resolves via the known-model table', () => {
  const dir = fs.mkdtempSync(path.join(tmpDir, 'context-confident-'));
  const transcriptPath = writeFixtureTranscript(dir, 'claude-sonnet-5');
  writeSidecar(dir, 'ctx-test-confident-agent', transcriptPath, 'sess-confident-1');

  const ctx = getAgentContext('ctx-test-confident-agent', dir, dir, 150_000, false);

  assert.equal(ctx.modelId, 'claude-sonnet-5');
  assert.equal(ctx.contextLimitConfident, true, 'a table-matched model should be confident');
  assert.equal(ctx.contextLimit, 1_000_000, 'contextLimit should come from the model table, not the generic fallback');
});

void test('getAgentContext: contextLimitConfident is false and contextLimit falls back to the generic conductor.conf value when the model is unrecognized', () => {
  const dir = fs.mkdtempSync(path.join(tmpDir, 'context-unconfident-'));
  const transcriptPath = writeFixtureTranscript(dir, 'claude-nonexistent-model-9');
  writeSidecar(dir, 'ctx-test-unconfident-agent', transcriptPath, 'sess-unconfident-1');

  const genericFallbackLimit = 150_000;
  const ctx = getAgentContext('ctx-test-unconfident-agent', dir, dir, genericFallbackLimit, false);

  assert.equal(ctx.modelId, 'claude-nonexistent-model-9');
  assert.equal(ctx.contextLimitConfident, false, 'an unrecognized model should not be confident');
  assert.equal(ctx.contextLimit, genericFallbackLimit, 'contextLimit should fall back to the generic conductor.conf parameter');
});
