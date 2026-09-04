#!/usr/bin/env node
'use strict';

// BUG-0001: Claude Code's background/async-agent feature (shipped v2.1.198)
// lets a session's outer turn end via a genuine `Stop` — which on-stop.js
// writes as `idle` unconditionally, see lib/write-state.js — while a
// background sub-agent it spawned (e.g. /power-mode's UAT-auto sub-agents)
// keeps running independently. The Stop hook's own payload has no field for
// outstanding background work, so the idle/busy state file alone cannot
// represent "turn ended, but a background agent I spawned is still going."
//
// This hook tracks that separately: one sentinel file per outstanding
// background agent under `$STATE_DIR/<agent>.pending-agents/`, driven by the
// two documented Notification `notification_type` values for background
// agents (code.claude.com/docs/en/hooks, cross-verified in
// raw/research/stop-hook-subagent-detection/index.md):
//   agent_needs_input  -> an outstanding background agent  -> write a sentinel
//   agent_completed    -> a background agent has resolved  -> remove one
// Every other notification_type is a no-op (still logged) — this does NOT
// resurrect the done/working/wait/dispatching vocabulary TASK-009 removed.
//
// No live capture of a real agent_needs_input/agent_completed payload was
// available at implementation time to confirm a per-agent correlator field
// (see BUG-0001's Resolution section for what remains unverified). Absent a
// confirmed correlator, this uses a monotonic per-arrival file
// (`<timestamp>-<random>`), decremented FIFO (oldest file removed) on
// agent_completed — a degraded but still atomic scheme, per the design this
// hook was scoped from (wiki/work/tasks/TASK-133-*.md, step 2's documented
// fallback). The host-server side (host-server/pendingAgents.ts) treats a
// sentinel older than PENDING_AGENT_STALE_S as stale, so a missed or
// misunderstood agent_completed can never wedge the queue forever.
const fs = require('fs');
const path = require('path');

const STATE_DIR = process.env.CONDUCTOR_STATE_DIR || '/conductor-state';
const LOG_DIR = process.env.CONDUCTOR_LOG_DIR || '/conductor-logs';
let AGENT_NAME = process.env.CONDUCTOR_AGENT_NAME || '';

if (!AGENT_NAME && process.env.TMUX) {
  const { execFileSync } = require('child_process');
  try {
    AGENT_NAME = execFileSync('tmux', ['display-message', '-p', '#W'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch (_err) {
    // swallow — fall through to no-op below
  }
}

if (!AGENT_NAME) {
  process.exit(0);
}

// Read the Claude Code JSON payload from stdin synchronously — this both
// consumes it (avoids SIGPIPE) and gives us notification_type.
let payload = null;
try {
  const raw = fs.readFileSync(0, 'utf8');
  if (raw && raw.trim()) payload = JSON.parse(raw);
} catch (_err) {
  // no stdin, or not JSON — payload stays null
}

const notificationType = payload && typeof payload.notification_type === 'string' ? payload.notification_type : '';

// Debug log every payload (cheap, and the only way to confirm field names /
// a correlator live per this hook's own design doc) — best-effort.
try {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.appendFileSync(
    path.join(LOG_DIR, 'notification-debug.jsonl'),
    JSON.stringify({
      ts: new Date().toISOString(),
      agent: AGENT_NAME,
      notification_type: notificationType,
      payload,
    }) + '\n',
  );
} catch (_err) {
  // logging must never crash the agent
}

const pendingDir = path.join(STATE_DIR, `${AGENT_NAME}.pending-agents`);

if (notificationType === 'agent_needs_input') {
  try {
    fs.mkdirSync(pendingDir, { recursive: true });
    const sentinelName = `${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}`;
    fs.writeFileSync(path.join(pendingDir, sentinelName), '');
  } catch (_err) {
    // best-effort — a missed sentinel degrades to the pre-fix behavior for
    // this one background agent, never a crash
  }
} else if (notificationType === 'agent_completed') {
  try {
    const entries = fs.readdirSync(pendingDir).sort(); // timestamp-prefixed names sort oldest-first
    const oldest = entries[0];
    if (oldest) fs.unlinkSync(path.join(pendingDir, oldest));
  } catch (_err) {
    // directory absent, empty, or raced with a concurrent hook process — fine
  }
}

process.exit(0);
