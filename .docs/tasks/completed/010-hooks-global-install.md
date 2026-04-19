# 010 — Hooks Global Install

## Objective

Refactor `hooks/install-hooks.sh` to copy per-event hook scripts into a namespaced `~/.claude/hooks/tmux-conductor/` directory and merge them into `~/.claude/settings.json` with dedup-by-command, so existing foreign hook entries are preserved (matching the pattern used by `claude-code-lsp-enforcement-kit`).

## Approach

Replace the current destructive `jq .hooks.X = [...]` assignment with a merge-and-dedup pass against each target array (`SessionStart`, `UserPromptSubmit`, `Stop`, `StopFailure`). Copy hook scripts from the invoking `$HOOK_DIR` into `~/.claude/hooks/tmux-conductor/` so the installed settings reference a stable, self-contained location independent of the repo path. Keep the existing `/conductor-hooks:ro` bind-mount in `scaffold.sh` as the init-time source for the in-container install; runtime reads from `~/.claude/hooks/tmux-conductor/`.

## Prerequisites

- [x] Task 007 (per-event hook split) completed — four scripts exist: `on-session-start.sh`, `on-prompt-submit.sh`, `on-stop.sh`, `on-stop-failure.sh`
- [x] `jq` available on host and inside the base image (already a base-image dep)

---

## Steps

### 1. Rewrite `hooks/install-hooks.sh`  <!-- agent: general-purpose -->

- [x] Replace the script at `hooks/install-hooks.sh` with a version that:
  - Accepts the same CLI flags: `--hook-dir <path>` (default: script's own dir), `--settings-file <path>` (default: `$HOME/.claude/settings.json`)
  - Adds a new default `INSTALL_DIR="$HOME/.claude/hooks/tmux-conductor"` (override via `--install-dir <path>`)
  - Creates `$INSTALL_DIR` with `mkdir -p`
  - Copies the four hook scripts from `$HOOK_DIR` → `$INSTALL_DIR`: `on-session-start.sh`, `on-prompt-submit.sh`, `on-stop.sh`, `on-stop-failure.sh`
  - Sets `chmod +x` on each copied script
  - Ensures `$SETTINGS_FILE` parent dir and file exist (seed with `{}` if missing)
  - Uses `jq` to merge hook entries by **dedup-by-command-string**, not array replacement — see structure below
  - Cleans up stale `PreToolUse` and `Notification` entries (carry over existing behavior)
  - Cleans up stale entries whose `command` points into the old repo-path layout (any command matching `*/hooks/on-*.sh` that is NOT `$INSTALL_DIR/on-*.sh`) from `SessionStart`, `UserPromptSubmit`, `Stop`, `StopFailure` arrays
  - Writes output atomically (`mktemp` → `mv`)
  - Prints a summary line: `Conductor hooks installed to <INSTALL_DIR> and registered in <SETTINGS_FILE>`

- [x] jq merge structure — for each of the four events, the target entry shape is:

  ```jsonc
  // SessionStart (needs matcher)
  { "matcher": "startup|resume|clear",
    "hooks": [{ "type": "command", "command": "<INSTALL_DIR>/on-session-start.sh" }] }

  // UserPromptSubmit / Stop / StopFailure (no matcher)
  { "hooks": [{ "type": "command", "command": "<INSTALL_DIR>/on-<event>.sh" }] }
  ```

  Implement merge by:
    - Initializing missing `.hooks` and `.hooks.<Event>` to `[]` if absent
    - Filtering out any existing entry whose `.hooks[].command` equals the new command string (dedup)
    - Appending the new entry
    - Do this in a single `jq` invocation that reads `--arg install_dir "$INSTALL_DIR"` and emits the full settings object

- [x] Stale repo-path cleanup: for each event array, additionally filter out entries where any `hook.command` matches the pattern `*/hooks/on-(session-start|prompt-submit|stop|stop-failure)\.sh$` **and** does not start with `$INSTALL_DIR`. This drops registrations left behind by the prior version of the script that baked repo paths into settings.

- [x] Idempotency: running the script twice must produce byte-identical `settings.json` output (verified in Verification step).

### 2. Verify dev-container scaffolding still wires hooks  <!-- agent: general-purpose -->

- [x] Confirm `scaffold.sh` still mounts `${CONDUCTOR_REPO}/hooks` → `/conductor-hooks:ro` in the generated `conductor-compose.yml` (no change needed — read to confirm at `scaffold.sh:234`)
- [x] Confirm `init-claude-config.sh` template still invokes `/conductor-hooks/install-hooks.sh` during first-boot init (no change needed — read to confirm at `scaffold.sh:204`)
- [x] Add a short comment to the `init-claude-config.sh` heredoc in `scaffold.sh` noting that install-hooks.sh now copies scripts into `~/.claude/hooks/tmux-conductor/` and the `/conductor-hooks` mount is only needed at init time, not at runtime
- [x] No change to the bind-mount itself — keep `/conductor-hooks:ro` so re-running `init-claude-config.sh` (or manual re-install) can pick up updated hook scripts without image rebuild

### 3. Update documentation  <!-- agent: general-purpose -->

- [x] Update `CLAUDE.md` — in the "Core Scripts" table row for `hooks/install-hooks.sh`, change the description to note the new install destination (`~/.claude/hooks/tmux-conductor/`) and that the script merges into settings.json without clobbering foreign hook entries
- [x] Update `CLAUDE.md` "Key Design Decisions" bullet about hooks to reference `~/.claude/hooks/tmux-conductor/` as the registered install path
- [x] Update `README.md` — if it has an installation or setup section referencing install-hooks.sh, update it to document the new install path and the merge-friendly behavior
- [x] Update `.docs/tasks/README.md` — move this task row under the Active Tasks table (see step 4 below)

### 4. Update task index  <!-- agent: general-purpose -->

- [x] Add a row for task 010 to the Active Tasks table in `.docs/tasks/README.md`:
  ```
  | 010 | [Hooks Global Install](active/010-hooks-global-install.md) | Refactor install-hooks.sh to copy hooks into ~/.claude/hooks/tmux-conductor/ and merge-register into settings.json with dedup (preserves foreign hook entries); container scaffolding unchanged |
  ```

### 5. Verification  <!-- agent: general-purpose -->

- [x] `bash -n hooks/install-hooks.sh` passes syntax check
- [x] Dry-run on a scratch settings file proves dedup-and-merge works:
  - Create `./tmp/settings-test.json` with `{"hooks":{"SessionStart":[{"matcher":"startup","hooks":[{"type":"command","command":"/some/foreign/hook.sh"}]}]}}`
  - Run `hooks/install-hooks.sh --settings-file ./tmp/settings-test.json --install-dir ./tmp/hooks-test`
  - Verify the foreign entry is **preserved** AND a new entry pointing at `./tmp/hooks-test/on-session-start.sh` is appended
- [x] Idempotency: run the same command twice; the second run produces a byte-identical settings file (`diff` shows no changes)
- [x] Stale repo-path cleanup: seed a settings file with an entry whose command is `/Users/fake/tmux-conductor/hooks/on-stop.sh`; run install-hooks.sh; confirm that entry is removed and replaced by the `$INSTALL_DIR/on-stop.sh` entry
- [x] Verify the four scripts exist and are executable under `$INSTALL_DIR` after a successful run (`ls -l`)
- [x] Manual host install against real `~/.claude/settings.json`: confirm that any pre-existing non-conductor hook entries in `SessionStart`/`UserPromptSubmit`/`Stop`/`StopFailure` survive untouched (back up first with `cp ~/.claude/settings.json ~/.claude/settings.json.bak`)

### 6. Rewrite host hook-command path prefixes in rsynced settings.json  <!-- agent: general-purpose -->

Bug discovered post-implementation: rsync in `init-claude-config.sh` seeds the container's `~/.claude/settings.json` from the host copy, which contains hook `command` strings pointing at host filesystem paths (e.g. `/Users/davidtaylor/.claude/hooks/tmux-conductor/on-session-start.sh`). Those paths don't exist inside the container, so Claude Code emits `hook error ... not found` on every `SessionStart` / `UserPromptSubmit`.

Fix: after rsync, rewrite every hook `command` so that the prefix before `.claude/` is replaced with the container's `$HOME` (`/home/conductor`). This keeps foreign hooks (e.g. `claude-code-lsp-enforcement-kit`, also installed under `~/.claude/hooks/`) working inside the container, and leaves `install-hooks.sh`'s dedup-merge to handle tmux-conductor's own entries normally. Do **not** delete the `hooks` object.

- [ ] In `scaffold.sh`'s `init-claude-config.sh` heredoc, between the `.hasCompletedOnboarding` jq line (around `scaffold.sh:194`) and the `/conductor-hooks/install-hooks.sh` call (around `scaffold.sh:207`), add a jq pass that rewrites host path prefixes in hook commands. The generated script should produce this literal (note `\$HOME`, `\$` escaping to defer expansion into the generated script):
  ```bash
  # Rewrite host path prefixes in hook commands: anything before "/.claude/" is replaced
  # with the container's \$HOME so foreign hooks (e.g. LSP enforcement kit) installed
  # under ~/.claude/hooks/ still resolve inside the container. install-hooks.sh will
  # separately dedup-merge tmux-conductor's own entries below.
  if [[ -f "\$HOME/.claude/settings.json" ]]; then
    jq --arg home "\$HOME" '
      if .hooks then
        .hooks |= with_entries(
          .value |= map(
            .hooks |= map(
              if (.command // "") | test("/\\\\.claude/") then
                .command |= sub("^.*/\\\\.claude/"; \$home + "/.claude/")
              else . end
            )
          )
        )
      else . end
    ' "\$HOME/.claude/settings.json" > /tmp/settings-rehomed.json \\
      && mv /tmp/settings-rehomed.json "\$HOME/.claude/settings.json"
  fi
  ```
  Double-backslashes in `test("/\\\\.claude/")` / `sub("^.*/\\\\.claude/"; ...)` are because the heredoc is non-quoted (`<<EOF`), so `\\` in the source becomes `\` in the generated script, which jq then sees as the single literal `\.` regex escape.

- [ ] Apply the same fix to this repo's own `.devcontainer/init-claude-config.sh` (it's a copy of the scaffold template, not a heredoc). Insert an unescaped version between the existing `.hasCompletedOnboarding` jq call (line 35) and the `/conductor-hooks/install-hooks.sh` call (line 45):
  ```bash
  if [[ -f "$HOME/.claude/settings.json" ]]; then
    jq --arg home "$HOME" '
      if .hooks then
        .hooks |= with_entries(
          .value |= map(
            .hooks |= map(
              if (.command // "") | test("/\\.claude/") then
                .command |= sub("^.*/\\.claude/"; $home + "/.claude/")
              else . end
            )
          )
        )
      else . end
    ' "$HOME/.claude/settings.json" > /tmp/settings-rehomed.json \
      && mv /tmp/settings-rehomed.json "$HOME/.claude/settings.json"
  fi
  ```

- [ ] Update the comment block above the `install-hooks.sh` call in both files to note that hook command prefixes are rewritten to the container's `$HOME` first, so foreign hooks (e.g. LSP enforcement) keep working alongside tmux-conductor's dedup-merged entries.

- [ ] Verification sub-step: on a scratch settings file seeded with `{"hooks":{"SessionStart":[{"matcher":"startup","hooks":[{"type":"command","command":"/Users/fake/.claude/hooks/foreign/hook.sh"}]}]}}`, run the jq pass manually with `HOME=/home/conductor`; confirm the resulting command is `/home/conductor/.claude/hooks/foreign/hook.sh` and the foreign entry is not dropped.

### 7. Verify end-to-end in a fresh container  <!-- manual: user will run these steps -->

User will test this step manually — do not attempt automated execution.

- [ ] Remove the init sentinel (`rm -f ~/.claude/.conductor-initialized` inside the container, or rebuild from scratch) and re-run `docker compose -f conductor-compose.yml up -d --build --force-recreate` for a scaffolded project.
- [ ] Launch `claude` inside the container, submit a prompt; confirm no `SessionStart` / `UserPromptSubmit` / `Stop` hook errors appear in the TUI.
- [ ] Inspect the container's `~/.claude/settings.json`: every entry under `.hooks.SessionStart[*].hooks[*].command`, `.hooks.UserPromptSubmit[*].hooks[*].command`, `.hooks.Stop[*].hooks[*].command`, `.hooks.StopFailure[*].hooks[*].command` must start with `/home/conductor/.claude/hooks/tmux-conductor/`. No `/Users/...` paths may remain.
- [ ] Repeat on this repo's own devcontainer (`.devcontainer/init-claude-config.sh`) to confirm the duplicated fix works there too.

---
**UAT**: [`.docs/uat/skipped/010-hooks-global-install.uat.md`](../../uat/skipped/010-hooks-global-install.uat.md) *(skipped)*
