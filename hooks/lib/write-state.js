// write-state.js — shared helper for tmux-conductor Claude Code hooks.
//
// Writes a single state value ("idle" or "busy") to
// $CONDUCTOR_STATE_DIR/<agent>.state so monitor.sh can track agent liveness.
// Mirrors the semantics of the original Bash hooks (hooks/on-*.sh):
//   - Resolve agent name from CONDUCTOR_AGENT_NAME, falling back to
//     `tmux display-message -p '#W'` when running inside a tmux pane.
//   - Drain stdin so the Claude Code JSON payload doesn't backpressure the caller
//     (equivalent of `cat >/dev/null` in Bash).
//   - Any failure is swallowed with a clean exit(0) — hooks must never break
//     the agent.
// Appends a JSONL transition record to $CONDUCTOR_LOG_DIR/hooks.jsonl
// after each successful state file write (best-effort; errors are swallowed).

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function writeState(value, event) {
  const STATE_DIR = process.env.CONDUCTOR_STATE_DIR || '/conductor-state';
  const LOG_DIR = process.env.CONDUCTOR_LOG_DIR || '/conductor-logs';
  let AGENT_NAME = process.env.CONDUCTOR_AGENT_NAME || '';

  if (!AGENT_NAME && process.env.TMUX) {
    try {
      AGENT_NAME = execFileSync('tmux', ['display-message', '-p', '#W'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch (_err) {
      // swallow — fall through to no-op below
    }
  }

  // Drain stdin non-blockingly so the Claude Code JSON payload is consumed.
  try {
    process.stdin.on('data', () => {});
    process.stdin.on('end', () => {});
    process.stdin.on('error', () => {});
    process.stdin.resume();
  } catch (_err) {
    // ignore
  }

  if (!AGENT_NAME) {
    process.exit(0);
  }

  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
  } catch (_err) {
    process.exit(0);
  }

  const stateFile = path.join(STATE_DIR, AGENT_NAME + '.state');

  // Read previous state before overwriting (best-effort).
  let prevState = '';
  try {
    prevState = fs.readFileSync(stateFile, 'utf8').replace(/\n$/, '');
  } catch (_err) {
    // file absent or unreadable — prevState stays ''
  }

  try {
    fs.writeFileSync(stateFile, value + '\n');
  } catch (_err) {
    // ignore — match Bash behavior of best-effort write
  }

  // Append JSONL transition record (best-effort).
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const record = JSON.stringify({
      ts: new Date().toISOString(),
      agent: AGENT_NAME,
      event: event,
      prev_state: prevState,
      new_state: value,
    });
    fs.appendFileSync(path.join(LOG_DIR, 'hooks.jsonl'), record + '\n');
  } catch (_err) {
    // swallow — logging must never crash the agent
  }

  process.exit(0);
}

module.exports = { writeState };
