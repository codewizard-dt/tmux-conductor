import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';
import { openDb, createAgent, listAgentUsage } from './db.ts';
import { recordUsageDeltas, resetUsageStore } from './usage-store.ts';
import { resolvePricing, computeCostUsd, MODEL_PRICING } from './pricing.ts';
import type { UsageDelta } from './usage.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpDir = path.resolve(__dirname, '../tmp');

function freshDb(label: string): Database.Database {
  fs.mkdirSync(tmpDir, { recursive: true });
  const rand = Math.random().toString(36).slice(2, 10);
  return openDb(path.join(tmpDir, `usage-store-test-${label}-${rand}.db`));
}

function delta(overrides: Partial<UsageDelta>): UsageDelta {
  return {
    agentName: 'a1',
    sessionId: 'session-1',
    model: 'claude-fable-5',
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    costUSD: null,
    ts: '2026-07-06T12:00:00.000Z',
    ...overrides,
  };
}

void test('accumulates deltas across polls into one absolute session row', () => {
  resetUsageStore();
  const db = freshDb('accum');
  const agent = createAgent(db, { name: 'a1', workdir: '/w', launchCmd: 'claude' });

  recordUsageDeltas(db, agent, [delta({ inputTokens: 10, outputTokens: 100 })]);
  recordUsageDeltas(db, agent, [delta({ inputTokens: 5, outputTokens: 50, cacheReadTokens: 1000 })]);

  const rows = listAgentUsage(db, agent.id);
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.ok(row);
  assert.equal(row.inputTokens, 15);
  assert.equal(row.outputTokens, 150);
  assert.equal(row.cacheReadInputTokens, 1000);
});

void test('restart idempotency — full-file replay after reset leaves values unchanged', () => {
  resetUsageStore();
  const db = freshDb('restart');
  const agent = createAgent(db, { name: 'a1', workdir: '/w', launchCmd: 'claude' });

  recordUsageDeltas(db, agent, [delta({ outputTokens: 100 })]);
  recordUsageDeltas(db, agent, [delta({ outputTokens: 50 })]);
  const before = listAgentUsage(db, agent.id);

  // Simulate host-server restart: store resets, extraction bootstrap re-emits
  // the full-file totals as one delta.
  resetUsageStore();
  recordUsageDeltas(db, agent, [delta({ outputTokens: 150 })]);

  const after = listAgentUsage(db, agent.id);
  assert.equal(after.length, 1);
  const afterRow = after[0];
  const beforeRow = before[0];
  assert.ok(afterRow);
  assert.ok(beforeRow);
  assert.equal(afterRow.outputTokens, beforeRow.outputTokens);
  assert.equal(afterRow.costUsd, beforeRow.costUsd);
});

void test('multi-model session — tokens summed, cost is per-model rate math', () => {
  resetUsageStore();
  const db = freshDb('multimodel');
  const agent = createAgent(db, { name: 'a1', workdir: '/w', launchCmd: 'claude' });

  recordUsageDeltas(db, agent, [
    delta({ model: 'claude-fable-5', outputTokens: 1_000_000 }),
    delta({ model: 'claude-haiku-4-5', outputTokens: 1_000_000 }),
  ]);

  const rows = listAgentUsage(db, agent.id);
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.ok(row);
  assert.equal(row.outputTokens, 2_000_000);
  const fablePricing = MODEL_PRICING['claude-fable-5'];
  const haikuPricing = MODEL_PRICING['claude-haiku-4-5'];
  assert.ok(fablePricing);
  assert.ok(haikuPricing);
  const expected = fablePricing.outputPerMTok + haikuPricing.outputPerMTok;
  assert.ok(Math.abs(row.costUsd - expected) < 1e-9);
});

void test('costUSD passthrough wins over the pricing table', () => {
  resetUsageStore();
  const db = freshDb('passthrough');
  const agent = createAgent(db, { name: 'a1', workdir: '/w', launchCmd: 'claude' });

  recordUsageDeltas(db, agent, [delta({ outputTokens: 1_000_000, costUSD: 0.5 })]);

  const rows = listAgentUsage(db, agent.id);
  const row = rows[0];
  assert.ok(row);
  assert.equal(row.costUsd, 0.5); // not the table's $50/MTok
});

void test('unknown model — tokens recorded, cost contribution 0, no throw', () => {
  resetUsageStore();
  const db = freshDb('unknown');
  const agent = createAgent(db, { name: 'a1', workdir: '/w', launchCmd: 'claude' });

  recordUsageDeltas(db, agent, [delta({ model: 'gpt-42-turbo', outputTokens: 123 })]);

  const rows = listAgentUsage(db, agent.id);
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.ok(row);
  assert.equal(row.outputTokens, 123);
  assert.equal(row.costUsd, 0);
});

void test('session change — second row, first untouched, accumulator pruned to current session', () => {
  resetUsageStore();
  const db = freshDb('sessions');
  const agent = createAgent(db, { name: 'a1', workdir: '/w', launchCmd: 'claude' });

  recordUsageDeltas(db, agent, [delta({ sessionId: 'session-1', outputTokens: 100 })]);
  recordUsageDeltas(db, agent, [delta({ sessionId: 'session-2', outputTokens: 7 })]);

  let rows = listAgentUsage(db, agent.id);
  assert.equal(rows.length, 2);
  const bySession = new Map(rows.map((r) => [r.sessionStart, r]));
  assert.equal(bySession.get('session-1')?.outputTokens, 100);
  assert.equal(bySession.get('session-2')?.outputTokens, 7);

  // session-1 was pruned from the accumulator: a fresh delta for session-2
  // keeps accumulating, session-1's row stays final.
  recordUsageDeltas(db, agent, [delta({ sessionId: 'session-2', outputTokens: 3 })]);
  rows = listAgentUsage(db, agent.id);
  assert.equal(rows.find((r) => r.sessionStart === 'session-2')?.outputTokens, 10);
  assert.equal(rows.find((r) => r.sessionStart === 'session-1')?.outputTokens, 100);
});

void test('empty deltas — zero DB work', () => {
  resetUsageStore();
  const db = freshDb('empty');
  const agent = createAgent(db, { name: 'a1', workdir: '/w', launchCmd: 'claude' });

  recordUsageDeltas(db, agent, []);
  assert.equal(listAgentUsage(db, agent.id).length, 0);
});

void test('pricing — longest-prefix resolution and unknown models', () => {
  // Versioned/dated id resolves through the prefix.
  assert.equal(resolvePricing('claude-haiku-4-5-20251001'), MODEL_PRICING['claude-haiku-4-5']);
  // claude-sonnet-4-6 must hit the sonnet-4 family entry, not sonnet-5.
  assert.equal(resolvePricing('claude-sonnet-4-6'), MODEL_PRICING['claude-sonnet-4']);
  assert.equal(resolvePricing('claude-sonnet-5'), MODEL_PRICING['claude-sonnet-5']);
  assert.equal(resolvePricing('gpt-42-turbo'), null);
  assert.equal(computeCostUsd('gpt-42-turbo', { inputTokens: 1, outputTokens: 1, cacheCreationTokens: 1, cacheReadTokens: 1 }), null);

  const cost = computeCostUsd('claude-fable-5', {
    inputTokens: 1_000_000, outputTokens: 1_000_000, cacheCreationTokens: 1_000_000, cacheReadTokens: 1_000_000,
  });
  const p = MODEL_PRICING['claude-fable-5'];
  assert.ok(p);
  assert.ok(Math.abs((cost ?? 0) - (p.inputPerMTok + p.outputPerMTok + p.cacheWritePerMTok + p.cacheReadPerMTok)) < 1e-9);

  // claude-opus-5 (TASK-075 pricing-gap fix, 2026-08-15): must resolve to its own
  // entry — not fall through to the claude-opus-4-x family (none of those keys
  // are a prefix of "claude-opus-5") — and must price a real bundle non-zero.
  assert.equal(resolvePricing('claude-opus-5'), MODEL_PRICING['claude-opus-5']);
  const opus5Cost = computeCostUsd('claude-opus-5', {
    inputTokens: 1_000_000, outputTokens: 500_000, cacheCreationTokens: 0, cacheReadTokens: 0,
  });
  const opus5 = MODEL_PRICING['claude-opus-5'];
  assert.ok(opus5);
  assert.ok(opus5Cost !== null && opus5Cost > 0);
  assert.ok(Math.abs(opus5Cost - (opus5.inputPerMTok + 0.5 * opus5.outputPerMTok)) < 1e-9);
});
