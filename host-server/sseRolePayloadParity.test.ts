// BUG-0006: SSE agent-update payloads must carry `role` at parity with
// buildSnapshot()/REST GET /api/status, at both hand-maintained call sites —
// the initial-connect resend (GET /api/events) and the periodic diff-tick
// broadcast (pollAndDiff). The initial-connect resend is covered live by
// scripts/verify-sse-role-payload.sh (it can be driven end-to-end with a
// scratch backend); the periodic diff-tick broadcast fires on an internal
// polling interval this repo has no harness to trigger deterministically, so
// it's pinned statically here instead — a future edit dropping `role` from
// either site's object literal fails one of these two checks immediately,
// rather than silently regressing until someone notices a blank role badge.
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const indexSource = fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8');

void test('the initial-connect SSE resend (GET /api/events) includes role in its agent-update payload', () => {
  assert.match(
    indexSource,
    /sendSSE\(reply, 'agent-update', \{[\s\S]{0,600}?\n\s+role: agent\.role,/,
    "expected the GET /api/events initial-connect resend's agent-update payload to include `role: agent.role,`",
  );
});

void test("pollAndDiff's periodic agent-update broadcast includes role, at parity with worktreePath/branch (the other worktree-agent fields added alongside it)", () => {
  assert.match(
    indexSource,
    /worktreePath: agent\.worktreePath,\s*\n\s*branch: agent\.branch,\s*\n\s*role: agent\.role,/,
    "expected the periodic broadcastSSE('agent-update', ...) call site to include `role: agent.role,` immediately after worktreePath/branch",
  );
});
