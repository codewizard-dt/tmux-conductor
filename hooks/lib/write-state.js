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

// Max length (UTF-16 code units) of the persisted last_prompt text, marker
// included (TASK-0220 rule b): longer prompts keep the first cap-1 characters
// plus one '…'.
const LAST_PROMPT_MAX_CHARS = 2000;

const PASTE_OPEN_TAG = /<pasted_content(?: id="[^"]*")?>\r?\n?/g;
const PASTE_CLOSE_TAG = /\r?\n?<\/pasted_content(?: id="[^"]*")?>/g;

// A bracketed paste reaches UserPromptSubmit wrapped as
// "\n\n<pasted_content id=\"N\">\n…\n</pasted_content id=\"N\">\n" (TASK-0219).
// Unwrap it: drop both tags (keeping the inner text verbatim and any typed text
// around the wrapper), then trim the leading/trailing blank lines the wrapper
// leaves behind. Prompts without a wrapper are returned untouched.
function normalizePrompt(prompt) {
  if (!prompt.includes('<pasted_content')) return prompt;
  return prompt
    .replace(PASTE_OPEN_TAG, '')
    .replace(PASTE_CLOSE_TAG, '')
    .replace(/^(?:[ \t]*\r?\n)+/, '')
    .replace(/(?:\r?\n[ \t]*)+$/, '');
}

// Cap text to LAST_PROMPT_MAX_CHARS including a single '…' marker; never leaves
// a dangling high surrogate at the cut.
function capPrompt(text) {
  if (text.length <= LAST_PROMPT_MAX_CHARS) return text;
  let cut = LAST_PROMPT_MAX_CHARS - 1;
  const last = text.charCodeAt(cut - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut -= 1;
  return text.slice(0, cut) + '…';
}

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

  // Read the Claude Code JSON payload from stdin synchronously. This both
  // consumes it (so the caller doesn't backpressure / SIGPIPE) and lets us
  // extract transcript_path / model / session_id for the dashboard's context
  // meter. fd 0 is a pipe in hook context, so readFileSync blocks until EOF.
  let payload = null;
  try {
    const raw = fs.readFileSync(0, 'utf8');
    if (raw && raw.trim()) payload = JSON.parse(raw);
  } catch (_err) {
    // no stdin, or not JSON — payload stays null
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

  // Persist transcript_path / model / session_id so the dashboard backend can
  // locate this agent's transcript and read live model + context usage. Merge
  // with any prior sidecar: only SessionStart carries `model`, so events that
  // lack it must keep the last captured value while refreshing transcript_path.
  if (payload) {
    try {
      const metaFile = path.join(STATE_DIR, AGENT_NAME + '.meta.json');
      let meta = {};
      try {
        meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
      } catch (_err) {
        meta = {};
      }
      if (payload.transcript_path) meta.transcript_path = payload.transcript_path;
      if (payload.session_id) meta.session_id = payload.session_id;
      if (payload.model) meta.model = payload.model;
      const now = new Date().toISOString();
      // Only UserPromptSubmit carries `prompt`; every other event keeps the
      // previous last_prompt (meta starts from the prior sidecar). Empty,
      // whitespace-only, missing or non-string prompts never overwrite.
      if (typeof payload.prompt === 'string') {
        const text = normalizePrompt(payload.prompt);
        if (text.trim() !== '') {
          meta.last_prompt = { text: capPrompt(text), ts: now };
          if (typeof payload.prompt_id === 'string' && payload.prompt_id) {
            meta.last_prompt.prompt_id = payload.prompt_id;
          }
        }
      }
      meta.ts = now;
      fs.writeFileSync(metaFile, JSON.stringify(meta) + '\n');
    } catch (_err) {
      // best-effort — never break the agent
    }
  }

  process.exit(0);
}

module.exports = { writeState };
