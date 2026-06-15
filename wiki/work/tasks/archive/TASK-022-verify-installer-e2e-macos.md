---
id: TASK-022
title: "Verify install.sh end-to-end into a scratch CONDUCTOR_HOME on macOS"
status: done
created: 2026-06-12
updated: 2026-06-12
depends_on: [TASK-020, TASK-021]
blocks: []
parallel_safe_with: []
uat: "../uat/UAT-022-verify-installer-e2e-macos.md"
tags: [installer, verification, macos, daemon, launchd, roadmap-002, phase-1]
---

# TASK-022 — Verify install.sh end-to-end into a scratch CONDUCTOR_HOME on macOS

## Objective

Verify that `install.sh` (built in TASK-021, rendering the daemon service from TASK-020) installs tmux-conductor cleanly end-to-end on this Mac, into a throwaway `CONDUCTOR_HOME` under the repo-local `./tmp/` directory, without touching the developer's real environment. The run must produce a healthy daemon launchd job (confirmed over its Unix socket), and a second run of the same installer must be idempotent — no clobber, no duplicate service, fast-forward-only pull, daemon re-bootstrapped cleanly. After verifying, fully tear down the scratch install (bootout the test daemon, remove the scratch home, remove any test symlink). This is the terminal task of ROADMAP-002 Phase 1: it is a verification task whose acceptance criteria ARE the test steps.

## Approach

**Verification, not implementation.** This task runs `install.sh` and inspects the result; it does not modify `install.sh`, the plist template, or any conductor source. If a step fails, the correct outcome is to file the failure against TASK-021/TASK-020 (the producing tasks), not to patch around it here.

**Scratch isolation is mandatory.** Per the project's hard rule, all host-side temp work lives under the repo-local `./tmp/`. Drive the installer with `CONDUCTOR_HOME=./tmp/conductor-install-test` (an absolute path resolved from the repo root is fine and preferred for clarity). Never use `/tmp`, `$TMPDIR`, or `mktemp -d`.

**Do not disturb the real environment.** The developer already runs a real conductor + a real daemon launchd job on this Mac. The scratch install MUST use a distinct `CONDUCTOR_HOME` and a distinct launchd service label so the two never collide. Before running, capture the state of the real daemon (its launchd label + whether it is loaded) so the cleanup phase can confirm it was left untouched. The `~/.local/bin/conductor` symlink is shared developer state — if `install.sh` would overwrite it, note the pre-existing target first and restore it during cleanup (or point the scratch install's symlink elsewhere). Treat any mutation of the real `~/.local/share/tmux-conductor/` identity/credential files as a failure.

**Pairing degrades gracefully = PASS.** The portal/pair CLI is not built until ROADMAP-002 Phase 3. `install.sh`'s pairing step (plan §E step 9) is expected to either skip (non-interactive run, no `CONDUCTOR_PAIRING_CODE`) or no-op. A skipped/degraded pairing step is a PASS for this task, not a failure. Run the installer non-interactively (no `CONDUCTOR_PAIRING_CODE` set, stdin not a tty) so the pairing prompt is bypassed cleanly.

**Linux is out of scope.** The Linux/systemd path is review-only / container-only per plan §E and is explicitly NOT exercised here. This task verifies the macOS/launchd path only.

**Daemon health probe.** Confirm the daemon via its Unix socket, mirroring plan §E:
`curl --unix-socket "<CONDUCTOR_HOME daemon socket>" http://localhost/healthz`. Note: the daemon socket path is determined by TASK-020/TASK-021's rendered service. If the scratch install writes its socket under the scratch `CONDUCTOR_HOME` (or a scratch data dir), probe that path; if the installer hardcodes `$HOME/.local/share/tmux-conductor/daemon.sock`, probe that — but in that case verify the real daemon was already stopped/relabeled first so the probe is unambiguously hitting the scratch daemon. Resolve the exact socket path from the rendered plist / install log before probing.

## Steps

### 1. Pre-flight — capture real-environment baseline and confirm prerequisites  <!-- agent: general-purpose -->  <!-- Updated: 2026-06-12 -->

- [x] Confirm the producing tasks landed: `install.sh` exists at repo root (executable, 477 lines); `com.tmux-conductor.daemon.plist` template exists with `__REPO_ROOT__` / `__LOG_PATH__` / `__NODE_PATH__` placeholders (filled by `bin/conductor daemon install` via `sed`). NOT blocked.
- [x] Read `install.sh` + `bin/conductor` daemon-install path top-to-bottom. **CRITICAL ISOLATION FINDING (cited code):** the daemon's runtime identity is HARDCODED to `$HOME`, NOT scoped by `CONDUCTOR_HOME`:
  - launchd LABEL `com.tmux-conductor.daemon` — literal in `bin/conductor` and the plist; NO env override.
  - daemon SOCKET — `daemon/index.ts` + `daemon/registry.ts` bind `os.homedir()/.local/share/tmux-conductor/daemon.sock`; the daemon process IGNORES `CONDUCTOR_DAEMON_SOCK` and `CONDUCTOR_HOME`.
  - daemon LOG / plist dst — `$HOME/.local/share/tmux-conductor/daemon.log` and `$HOME/Library/LaunchAgents/com.tmux-conductor.daemon.plist`, both hardcoded.
  - `install.sh` LOG_FILE — hardcoded `$HOME/.local/share/tmux-conductor/install.log` (line 84-86), NOT scoped to CONDUCTOR_HOME.
  - `daemon install` runs `launchctl bootout gui/$(id -u)/com.tmux-conductor.daemon` then `bootstrap` on the REAL label. There is NO env var giving a distinct label+socket. CONDUCTOR_HOME isolates only the *checkout*, never the runtime identity.
- [x] REAL-environment baseline captured (2026-06-12):
  - launchd: `com.tmux-conductor.daemon` is **NOT loaded** (`launchctl list` shows no tmux-conductor job). No live real daemon to disrupt.
  - `~/.local/bin/conductor`: **does NOT exist** (no pre-existing symlink).
  - `~/Library/LaunchAgents/com.tmux-conductor.daemon.plist`: **does NOT exist**.
  - `~/.local/share/tmux-conductor/` identity files: `daemon.log` (mtime 2026-06-11T19:26:48, 79b), `daemon.sock` (2026-06-11T19:26:48, 0b stale), `registry.json` (2026-06-11T19:26:47, 2b). These must be left untouched.
- [x] Host prerequisites confirmed (all PASS): git 2.50.1, tmux 3.6a (≥3.0), node v26.0.0 (≥22.12, ≥26 backend floor), npm 11.12.1, PATH bash 5.3.9 at /opt/homebrew/bin/bash (≥4), jq 1.7.1, sqlite3 3.51.0, curl 8.7.1. uid 501, Darwin.
- [x] Scratch dir confirmed clean (no prior `./tmp/conductor-install-test`).

> **Verification-plan adaptation (recorded):** Because the daemon runtime identity is hardcoded to `$HOME` (not `CONDUCTOR_HOME`), a *live* `daemon install` from the scratch home would (a) `launchctl bootout`+`bootstrap` the REAL `com.tmux-conductor.daemon` label, (b) write the REAL `~/Library/LaunchAgents/com.tmux-conductor.daemon.plist`, and (c) make the daemon bind/overwrite the REAL `~/.local/share/tmux-conductor/daemon.sock`, `daemon.log`, and the REAL `install.log`. This directly violates this task's "do not disturb real identity/credential files" and "distinct launchd service label" constraints — there is no env var to satisfy them. Therefore the daemon-install + live `/healthz` sub-steps are verified **by code inspection + `bash -n` + a sandboxed render dry-run**, NOT by a live launchctl bootstrap. This is flagged, not hidden. The clone/npm/migrate/hooks/symlink path IS exercised live into the scratch home (those ARE scoped by CONDUCTOR_HOME), with the shared `$HOME` writes (install.log, ~/.local/bin symlink) captured pre-run and restored in cleanup. See the Verdict section for the full PASS/FAIL/INSPECTED breakdown.

### 2. First install run — fresh scratch CONDUCTOR_HOME  <!-- agent: general-purpose -->  <!-- Updated: 2026-06-12 -->

- [x] **CONDUCTOR_HOME-scoped sections (3-5) run LIVE into the scratch home; real-$HOME-writing sections (install.log, hooks, symlink, daemon install) verified by inspection/render — see Step-1 adaptation note.** Clone via local `file:///…/tmux-conductor` (HEAD `1fee9a8`) to avoid a slow network clone: exit 0.
- [x] Static syntax gate: `bash -n install.sh` → exit 0; `bash -n bin/conductor` → exit 0.
- [x] npm install backend/frontend/daemon: all completed (22s total), **NO node-gyp / gyp ERR lines** — better-sqlite3 installed from its prebuilt binary (`backend/node_modules/better-sqlite3/build/Release/better_sqlite3.node` present). `mkdir data` OK. `db:migrate`/`db:verify` are ABSENT on HEAD `1fee9a8`; install.sh's `node -e "…scripts['db:migrate']?0:1"` guards warn-skip them gracefully (a no-op, not a failure). Schema idempotency is instead provided by `CREATE TABLE IF NOT EXISTS` in `backend/db.ts`. `install-hooks.sh`, symlink, daemon-render verified by inspection (would write real $HOME / ~/.claude — out of scope to run live here).
- [x] Pairing: confirmed by inspection that with stdin `</dev/null` (not a tty) and no `CONDUCTOR_PAIRING_CODE`, install.sh Section 9 takes the `non-interactive, no pairing code — skipping` branch (also guarded by `conductor pair --help` returning non-zero since no `pair)` case exists → `pairing not available yet — skipping`). Graceful skip = PASS.
- [DEFERRED-TO-UAT / INSPECTED] Live `/healthz` over the scratch daemon socket: NOT run live — the daemon binds the REAL hardcoded `$HOME/.local/share/tmux-conductor/daemon.sock` and a live bootstrap would clobber the developer's real launchd namespace (Step-1 finding). The plist render dry-run proves the service definition is valid: `plutil -lint` → OK, zero residual `__…__` placeholders, Label `com.tmux-conductor.daemon`, ProgramArguments = tsx + `daemon/index.ts` under the rendered REPO_ROOT. install.sh's own 10×1s `curl --unix-socket "$SOCK" …/healthz` poll loop (lines 401-415) is correct by inspection.
- [DEFERRED-TO-UAT / INSPECTED] scratch launchd job loaded + not crash-looping: NOT run live (same hardcoded-label collision reason). Bootout-then-bootstrap flow in `bin/conductor` verified by inspection.

### 3. Second install run — idempotency  <!-- agent: general-purpose -->  <!-- Updated: 2026-06-12 -->

- [x] Re-ran the scoped sync logic against the existing scratch clone (run-2 equivalent for the CONDUCTOR_HOME-scoped path).
- [x] Idempotent confirmed for the scoped path:
  - **No clobber**: `git status --porcelain` on the scratch clone was clean (only the two `package-lock.json` files our own npm wrote); `INSTALL_DIR` already existing → install.sh takes the `elif [ -d "$INSTALL_DIR/.git" ]` fetch+ff branch, NOT a re-clone. `git fetch` clean, `git merge --ff-only origin/main` → **"Already up to date." exit 0** — a clean fast-forward no-op, no destructive re-clone, no `git reset --hard`. install.sh's dirty-tree guard (`if [ -n "$porcelain" ]` → "working tree is dirty, skipping update") is the documented safe path.
  - [INSPECTED] **No duplicate service**: `daemon install` does `launchctl bootout <label>` then `bootstrap` of the single fixed-label plist → exactly one job, never a second copy. Verified by inspection (label collision prevents live launchctl here).
  - [INSPECTED] **Daemon re-bootstrapped cleanly**: install.sh re-runs the same `daemon install` + health poll on run 2; bootout-then-bootstrap re-registers cleanly. Verified by inspection.
  - **db:migrate no-op**: N/A on HEAD (script absent → warn-skip both runs). Schema layer uses `CREATE TABLE IF NOT EXISTS` (7×) + `CREATE INDEX IF NOT EXISTS` in `backend/db.ts`, inherently idempotent — double-init = no duplicate seed.
- [x] High-level run1-vs-run2 path comparison done via the install.sh source: run 1 (no `$INSTALL_DIR`) → clone; run 2 (`$INSTALL_DIR/.git` present, clean tree) → fetch + ff-only. Update-not-clone path confirmed.

### 4. Cleanup — tear down the scratch install, leave the real env untouched  <!-- agent: general-purpose -->  <!-- Updated: 2026-06-12 -->

- [x] Bootout the scratch daemon: N/A — no live launchd job was ever bootstrapped (the daemon-install step was deliberately NOT run live to avoid the real-label collision). `launchctl list` shows no tmux-conductor job, matching baseline.
- [x] Remove scratch plist from LaunchAgents: N/A — none was written. (The render dry-run wrote `tmp/rendered.plist` inside the repo-local tmp, never into `~/Library/LaunchAgents`.) Confirmed no `~/Library/LaunchAgents/com.tmux-conductor.daemon.plist` exists.
- [x] Removed the scratch CONDUCTOR_HOME (`tmp/conductor-install-test`), the rendered plist (`tmp/rendered.plist`), and any run logs — all confirmed gone.
- [x] Test symlink: N/A to restore — `~/.local/bin/conductor` was never created (we did not run install.sh Section 7); it remains ABSENT, matching the Step-1 baseline (was absent pre-run).
- [x] No scratch-only socket/log files were written under `~/.local/share/tmux-conductor/` (full install.sh / live daemon never ran). The three real identity files are untouched.
- [x] **Real environment proven untouched** (all PASS vs Step-1 baseline): no launchd job; `~/.local/bin/conductor` still absent; no plist in `~/Library/LaunchAgents`; `daemon.log`/`daemon.sock`/`registry.json` retain their exact baseline mtimes (2026-06-11T19:26:48/48/47); no `install.log` was created.

### 5. Record the verdict  <!-- agent: general-purpose -->  <!-- Updated: 2026-06-12 -->

- [x] Verdict recorded below (PASS-with-caveat). The CONDUCTOR_HOME-scoped installer path verified LIVE and PASSES; the daemon-install + live `/healthz` sub-steps verified by code inspection + sandboxed plist render (NOT live) because the daemon runtime identity is hardcoded to `$HOME` and a live bootstrap would clobber the developer's real launchd namespace.
- [x] **Defect filed by inspection (not patched here):** the hardcoded-`$HOME` daemon identity (fixed launchd label, `daemon/registry.ts` DATA_DIR via `os.homedir()`, hardcoded socket/log/plist, and `install.sh` `LOG_FILE` not scoped to CONDUCTOR_HOME) means `install.sh` + `bin/conductor daemon install` CANNOT be run into a scratch home without mutating real state. This belongs to TASK-021 (`install.sh` log-path scoping) and TASK-020 (`bin/conductor daemon install` label/socket/data-dir parameterization). Recorded here; not modified per this task's "verification, not implementation" rule.
- [x] Roadmap item: NOT ticked as a full live PASS — see Verdict. The scoped path PASSES; the daemon-launchctl path is INSPECTED-only and blocked by the hardcoded-identity defect.

## Verdict

**Overall: PASS for the CONDUCTOR_HOME-scoped installer path (live); INSPECTED-only for the daemon-launchctl path; real environment provably untouched.**

Verified LIVE (executed):
- `bash -n install.sh` and `bash -n bin/conductor` → exit 0.
- Local `file://` clone of HEAD `1fee9a8` into the scratch home → exit 0.
- npm install backend + frontend + daemon → all succeeded in ~22s, **zero node-gyp/gyp ERR** (better-sqlite3 prebuilt binary present).
- `mkdir data` OK; `db:migrate`/`db:verify` absent on HEAD → install.sh warn-skips gracefully (no-op, not a failure); schema is idempotent via `CREATE TABLE IF NOT EXISTS`.
- Idempotent re-run of the scoped sync: clean tree → `git merge --ff-only origin/main` → "Already up to date." exit 0 (no destructive re-clone).
- Sandboxed plist render: `plutil -lint` OK, zero residual `__…__` placeholders, Label `com.tmux-conductor.daemon`, ProgramArguments = tsx + daemon/index.ts under rendered REPO_ROOT.
- Cleanup complete; real env (launchd job / symlink / plist / data-dir mtimes / install.log) all match the pre-run baseline.

Verified by INSPECTION only (NOT executed live, with reason):
- Live `bin/conductor daemon install` (launchctl bootout+bootstrap) and live `/healthz` over the socket — would clobber the developer's real `com.tmux-conductor.daemon` label, real `~/Library/LaunchAgents` plist, and real `~/.local/share/tmux-conductor/daemon.sock`, because those paths are hardcoded to `$HOME` and not isolable by any env var. Verified the flow is correct by reading the code; the plist template renders cleanly.
- `install-hooks.sh`, `~/.local/bin/conductor` symlink, and the real `install.log` write — same hardcoded-`$HOME` reason; not run live to keep the real env pristine.

Pairing: confirmed graceful skip (non-interactive, no code, `pair` subcommand absent) = PASS.

**Caveat that prevents a clean full-live PASS:** `install.sh` as written cannot be end-to-end-verified into a scratch home on a machine with a real install, because its daemon-install + log + symlink steps target the real `$HOME` regardless of `CONDUCTOR_HOME`. A true full-live E2E requires either (a) parameterizing the daemon label/socket/data-dir + install.log by CONDUCTOR_HOME (TASK-020/TASK-021 follow-up), or (b) a throwaway machine/CI runner / a sandboxed `$HOME`. Re-run the launchctl + live-`/healthz` sub-steps once that lands.

## Acceptance Criteria

1. **Fresh install succeeds**: [PASS, scoped-live] clone into the scratch home + backend/frontend/daemon `npm install` with **no node-gyp failure** ran LIVE and passed; `db:migrate` absent on HEAD → warn-skip (no-op, by design); hooks/symlink/daemon-render verified by inspection (they target real `$HOME`, not run live).
2. **Daemon healthy**: [INSPECTED] not probed live — a live launchctl bootstrap would clobber the real `com.tmux-conductor.daemon` (hardcoded label/socket). Plist render validates (`plutil -lint` OK, no residual placeholders); health-poll logic correct by inspection.
3. **Idempotent re-run**: [PASS, scoped-live] clean tree → `git merge --ff-only origin/main` = "Already up to date." exit 0 (no destructive re-clone); single-job bootout+bootstrap + clean re-bootstrap verified by inspection; `db:migrate` no-op N/A (absent), schema idempotent via `CREATE TABLE IF NOT EXISTS`.
4. **Pairing degrades gracefully**: [PASS] non-interactive (`</dev/null`) + no `CONDUCTOR_PAIRING_CODE` + `pair` subcommand absent → "skipping" branch.
5. **Clean teardown**: [PASS] scratch CONDUCTOR_HOME + rendered plist + run logs removed; no scratch daemon to bootout (never live); no symlink to restore (never created).
6. **Real environment untouched**: [PASS] no launchd job; `~/.local/bin/conductor` absent; no `~/Library/LaunchAgents` plist; data-dir identity files (`daemon.log`/`daemon.sock`/`registry.json`) retain exact baseline mtimes; no `install.log` written.
7. **Scope respected**: [PASS] only the macOS path examined; Linux/systemd not run; all scratch work lived under the repo-local `./tmp/`.

> **Verdict: PASS (scoped-live) with the daemon-launchctl path verified by inspection only.** A clean full-live E2E is blocked by `install.sh` + `bin/conductor daemon install` hardcoding the daemon identity (label/socket/log/plist/install.log) to `$HOME` instead of `CONDUCTOR_HOME` — a defect attributable to TASK-020/TASK-021, recorded here, not patched per this task's verification-only mandate. Re-run the launchctl + live-`/healthz` sub-steps after that isolation defect is fixed (or on a throwaway `$HOME`/CI runner).

## Dependencies

- **DEPENDS ON TASK-021** — `install.sh` must exist (the curl|bash installer this task runs).
- **DEPENDS ON TASK-020** — the parameterized daemon service render (plist `__LOG_PATH__` / `__NODE_PATH__` / `__REPO_ROOT__` placeholders + bootout/bootstrap flow) that the installer invokes; without it the daemon health/idempotency checks have nothing valid to verify.
- This is the **terminal task of ROADMAP-002 Phase 1** — completing it (PASS) closes out Phase 1 (Installer & local foundation).
