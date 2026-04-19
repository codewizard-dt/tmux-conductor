# 011 — Refactor Hooks to Node.js

## Objective

Port the four Claude Code per-event hooks from Bash to Node.js (stdlib-only), relocate `install-hooks.sh` to the repo root, and archive the old Bash hook scripts under `hooks/.bash-backup/`.

## Approach

Each hook is a tiny state-writer; factor the shared "resolve agent name + drain stdin + write `<state>\n`" logic into `hooks/lib/write-state.js` and leave each per-event script as a one-liner. Keep `install-hooks.sh` as Bash (its jq-based settings merge is well-tested) but move it to the repo root and update it to copy `.js` files plus the `lib/` folder. Node is already guaranteed by the Claude Code CLI install in the base image.

## Prerequisites

- [ ] Task 010 (Hooks Global Install) completed — this task edits the same installer
- [ ] Node.js available on the host / in the base image (comes with Claude Code CLI)

---

## Steps

### 1. Create shared helper `hooks/lib/write-state.js`  <!-- agent: general-purpose --> <!-- Completed: 2026-04-18 -->

- [x] Create directory `hooks/lib/`
- [x] Create `hooks/lib/write-state.js` exporting a single function `writeState(value)`:
  - Resolve `STATE_DIR` from `process.env.CONDUCTOR_STATE_DIR`, defaulting to `/conductor-state`
  - Resolve `AGENT_NAME` from `process.env.CONDUCTOR_AGENT_NAME`; if empty and `process.env.TMUX` is set, run `child_process.execFileSync('tmux', ['display-message', '-p', '#W'], { encoding: 'utf8' }).trim()` inside a try/catch (swallow errors)
  - Drain stdin non-blockingly (attach `data`/`end` listeners with no-op, or simply `process.stdin.resume()` and ignore) so the Claude Code JSON payload doesn't backpressure the caller — equivalent of the `cat >/dev/null` in the Bash version
  - If `AGENT_NAME` is falsy, `process.exit(0)` (no-op success, matches Bash behavior)
  - `fs.mkdirSync(STATE_DIR, { recursive: true })` inside try/catch; on failure `process.exit(0)`
  - `fs.writeFileSync(path.join(STATE_DIR, AGENT_NAME + '.state'), value + '\n')`
  - `process.exit(0)`
- [x] Use CommonJS (`module.exports = { writeState }`) so the hook scripts can `require('./lib/write-state')` without a `package.json` / type field
- [x] No external dependencies — `fs`, `path`, `child_process` only

### 2. Create per-event JS hook scripts  <!-- agent: general-purpose --> <!-- Completed: 2026-04-18 -->

- [x] Create `hooks/on-session-start.js`:
  - Shebang: `#!/usr/bin/env node`
  - Body: `require('./lib/write-state').writeState('idle');`
  - `chmod +x`
- [x] Create `hooks/on-prompt-submit.js`:
  - Shebang: `#!/usr/bin/env node`
  - Body: `require('./lib/write-state').writeState('busy');`
  - `chmod +x`
- [x] Create `hooks/on-stop.js`:
  - Shebang: `#!/usr/bin/env node`
  - Body: `require('./lib/write-state').writeState('idle');`
  - `chmod +x`
- [x] Create `hooks/on-stop-failure.js`:
  - Shebang: `#!/usr/bin/env node`
  - Body: `require('./lib/write-state').writeState('idle');`
  - `chmod +x`
- [x] Run `node --check` on each file to confirm syntax
  - All four JS files parse without error

### 3. Archive existing Bash hooks  <!-- agent: general-purpose --> <!-- Completed: 2026-04-18 -->

- [x] Create `hooks/.bash-backup/` directory
- [x] `git mv` each of the four existing `hooks/on-*.sh` files into `hooks/.bash-backup/` (preserves history)
  - `hooks/on-session-start.sh` → `hooks/.bash-backup/on-session-start.sh`
  - `hooks/on-prompt-submit.sh` → `hooks/.bash-backup/on-prompt-submit.sh`
  - `hooks/on-stop.sh` → `hooks/.bash-backup/on-stop.sh`
  - `hooks/on-stop-failure.sh` → `hooks/.bash-backup/on-stop-failure.sh`
- [x] Add a short `hooks/.bash-backup/README.md` explaining these are retained for reference and are NOT installed by `install-hooks.sh` after task 011

### 4. Move and update `install-hooks.sh`  <!-- agent: general-purpose --> <!-- Completed: 2026-04-18 -->

- [x] `git mv hooks/install-hooks.sh ./install-hooks.sh`
- [x] Update the header comment to reflect the new location ("at the repo root") and JS hooks
- [x] Change the default `HOOK_DIR` to resolve the repo-root-relative `hooks/` directory:
  - `HOOK_DIR="$(cd "$(dirname "$0")/hooks" && pwd)"`
- [x] Replace the `for script in on-session-start.sh ...` loop with a loop over the four `.js` filenames (`on-session-start.js on-prompt-submit.js on-stop.js on-stop-failure.js`); still `cp` + `chmod +x` each into `$INSTALL_DIR`
- [x] Add a separate copy step for the shared helper:
  - `mkdir -p "$INSTALL_DIR/lib"`
  - `cp "$HOOK_DIR/lib/write-state.js" "$INSTALL_DIR/lib/write-state.js"`
- [x] Update the jq `stale_cmd` regex to match `.js` (and still clean up any old `.sh` registrations from prior installs):
  - Replace `test("/hooks/on-(session-start|prompt-submit|stop|stop-failure)\\.sh$")` with `test("/hooks/on-(session-start|prompt-submit|stop|stop-failure)\\.(sh|js)$")` — this way the installer also prunes stale `.sh` registrations left behind from task 010 installs
- [x] Update the four `register*` calls to point at `$install_dir + "/on-*.js"` instead of `.sh`
- [x] Keep the final success echo but reference the new installer path
- [x] Verify `shellcheck install-hooks.sh` (or `bash -n`) passes

### 5. Update project docs  <!-- agent: general-purpose --> <!-- Completed: 2026-04-18 -->

- [x] Update `CLAUDE.md`:
  - Change the four `hooks/on-*.sh` rows in the "Core Scripts" table to `hooks/on-*.js`
  - Change `hooks/install-hooks.sh` row to `install-hooks.sh` (root) and note it copies JS hooks + `hooks/lib/write-state.js`
  - Update the "Key Design Decisions" paragraph about hooks to say the per-event scripts are Node.js, with shared logic in `hooks/lib/write-state.js`
- [x] Update `.docs/tasks/README.md` — move task 010 line already present under Completed; add task 011 under Active with one-line description
- [x] Search the repo for any remaining references to `hooks/install-hooks.sh` or `hooks/on-*.sh` and update them (likely in `scaffold.sh`, `README.md`, `CONDUCTOR.md`, or `.devcontainer/`)
  - Use Grep for `hooks/install-hooks.sh` and `hooks/on-(session-start|prompt-submit|stop|stop-failure)\.sh`
  - Update each hit to the new JS path / root installer path

### 6. Verification  <!-- agent: general-purpose --> <!-- Completed: 2026-04-18 -->

- [x] `node --check hooks/lib/write-state.js hooks/on-*.js` — all parse clean
- [x] `bash -n install-hooks.sh` — shell syntax clean
- [x] Smoke test the installer against a sandbox:
  - `mkdir -p tmp && ./install-hooks.sh --settings-file tmp/settings.json --install-dir tmp/hooks-install`
  - Confirm `tmp/hooks-install/on-*.js` exist and are executable
  - Confirm `tmp/hooks-install/lib/write-state.js` exists
  - Confirm `tmp/settings.json` contains four registrations pointing at the `.js` paths (no `.sh` entries)
- [x] Idempotency: run the installer a second time with the same args; `diff` the two `tmp/settings.json` outputs — must be byte-identical
- [x] State-write smoke test: with `CONDUCTOR_STATE_DIR=$PWD/tmp/state CONDUCTOR_AGENT_NAME=test-agent`, pipe empty stdin into `node hooks/on-prompt-submit.js`; confirm `tmp/state/test-agent.state` contains `busy\n`. Repeat for `on-stop.js` → `idle\n`.
- [x] Clean up `tmp/` after verification

---
**UAT**: [`.docs/uat/pending/011-hooks-to-js.uat.md`](../../uat/pending/011-hooks-to-js.uat.md)
