---
id: UAT-059
title: "UAT: README install one-liner + docs updates (CLAUDE.md, scripts/README, .env.example)"
status: passed
task: TASK-059
created: 2026-06-14
updated: 2026-06-14
---

# UAT-059 — UAT: README install one-liner + docs updates (CLAUDE.md, scripts/README, .env.example)

implements::[[TASK-059]]

> **Source task**: [[TASK-059]]
> **Generated**: 2026-06-14

---

## Prerequisites

- [ ] Repo checked out at the working tree under test; run all commands from the repo root (`/Users/davidtaylor/Repositories/tmux-conductor`).
- [ ] `bash`, `grep`, and standard coreutils available.
- [ ] These are static documentation / CLI-help checks — no running services required. (Reference: `app/api` local dev port is 8090.)

---

## Test Cases

### UAT-DOC-001: README install one-liner present with the correct raw URL
- **File**: `README.md`
- **Description**: The Quick Start install one-liner must be present and point at `raw.githubusercontent.com/codewizard-dt/tmux-conductor/main/install.sh` via `curl | bash`.
- **Steps**:
  1. Run the grep command below from the repo root.
  2. Confirm exactly one matching line is printed.
- **Command**:
  ```bash
  grep -nF 'curl -fsSL https://raw.githubusercontent.com/codewizard-dt/tmux-conductor/main/install.sh | bash' README.md
  ```
- **Expected Result**: One match printed (around line 12) showing the full `curl -fsSL https://raw.githubusercontent.com/codewizard-dt/tmux-conductor/main/install.sh | bash` one-liner. Exit code 0.
- [x] Pass <!-- 2026-06-14 -->

### UAT-DOC-002: README does NOT contain false "not shipped / planned / does not exist" claims about install.sh / conductor pair / the daemon connector
- **File**: `README.md`
- **Description**: install.sh, `conductor pair`, and the daemon relay connector ARE shipped. The README must not describe any of them as not-yet-shipped, planned, or non-existent. Only the live hosted deployment (TASK-050) may be described as pending.
- **Steps**:
  1. Run the command below — it greps (case-insensitive) for false-claim phrasings.
  2. Confirm no output (exit code 1 from grep = no matches = PASS).
- **Command**:
  ```bash
  grep -niE 'conductor pair[^.]*(not (yet )?ship|planned|does not exist|do(es)? ?n.?t exist|not implemented|coming soon)|install\.sh[^.]*(not (yet )?ship|planned|does not exist|not implemented|coming soon)|(daemon|relay) connector[^.]*(not (yet )?ship|planned|does not exist|not implemented|coming soon)' README.md
  ```
- **Expected Result**: No matching lines (grep exits non-zero). Any printed line is a FAIL — a false "not shipped" claim about a shipped component.
- [x] Pass <!-- 2026-06-14 -->

### UAT-DOC-003: README affirmatively states install.sh + pairing client + daemon connector are shipped
- **File**: `README.md`
- **Description**: The "Heads up" note must positively state the installer, pairing client, device.json writer, and daemon relay connector all exist, with only the hosted deployment (TASK-050) pending.
- **Steps**:
  1. Run the grep below.
  2. Confirm the line mentioning the components being shipped and the hosted deployment being pending is present.
- **Command**:
  ```bash
  grep -niE 'shipped.*(installer|pairing client|connector)|hosted (deployment|URL) pending|TASK-050' README.md
  ```
- **Expected Result**: At least one match showing the components are shipped and the public hosted deployment (TASK-050) is the only pending item. Exit code 0.
- [x] Pass <!-- 2026-06-14 -->

### UAT-DOC-004: scripts/README.md does NOT contain false "not shipped / planned / does not exist" claims
- **File**: `scripts/README.md`
- **Description**: The relay/pairing section must describe both halves (server endpoints AND the pairing client/connector/installer) as shipped, not planned.
- **Steps**:
  1. Run the command below.
  2. Confirm no output (no matches = PASS).
- **Command**:
  ```bash
  grep -niE '(conductor pair|install\.sh|connector)[^.]*(not (yet )?ship|planned|does not exist|do(es)? ?n.?t exist|not implemented|coming soon)' scripts/README.md
  ```
- **Expected Result**: No matching lines (grep exits non-zero). Any printed line is a FAIL.
- [x] Pass <!-- 2026-06-14 -->

### UAT-DOC-005: scripts/README.md documents the bin/conductor vs scripts/conductor.sh distinction
- **File**: `scripts/README.md`
- **Description**: The docs must clarify that `bin/conductor` is the user-facing CLI (install/daemon/pair/unpair) and is distinct from `scripts/conductor.sh`, the tmux session orchestrator.
- **Steps**:
  1. Run the grep below.
  2. Confirm the distinguishing sentence is present.
- **Command**:
  ```bash
  grep -nE 'bin/conductor.*distinct from.*scripts/conductor\.sh|distinct from `scripts/conductor\.sh`' scripts/README.md
  ```
- **Expected Result**: One match in the "Remote access (relay & pairing)" section explicitly distinguishing `bin/conductor` (user CLI) from `scripts/conductor.sh` (tmux orchestrator). Exit code 0.
- [x] Pass <!-- 2026-06-14 -->

### UAT-DOC-006: CLAUDE.md documents the relay data path and bin/conductor vs scripts/conductor.sh distinction
- **File**: `CLAUDE.md`
- **Description**: CLAUDE.md must contain the "Relay data path & onboarding" subsection describing browser → app/api → WSS → daemon → host-server, AND the bin/conductor vs scripts/conductor.sh distinction.
- **Steps**:
  1. Run each grep below.
  2. Confirm both produce a match.
- **Command**:
  ```bash
  grep -nE '### Relay data path & onboarding|browser .* app/api .* WSS .* daemon .* host-server|not\*\* `scripts/conductor\.sh`|`pair\)` subcommand in `bin/conductor`' CLAUDE.md
  ```
- **Expected Result**: Multiple matches: the `### Relay data path & onboarding` heading, the relay-path sentence, and the `bin/conductor` vs `scripts/conductor.sh` distinction. Exit code 0.
- [x] Pass <!-- 2026-06-14 -->

### UAT-ENV-001: .env.example documents BOOTSTRAP_ADMIN_EMAIL with the VITE_ADMIN_EMAIL must-match note
- **File**: `.env.example`
- **Description**: `.env.example` must document `BOOTSTRAP_ADMIN_EMAIL` and state it must be set to the SAME email as `VITE_ADMIN_EMAIL` (dual-source admin gate), and vice-versa on `VITE_ADMIN_EMAIL`.
- **Steps**:
  1. Run the command below.
  2. Confirm both the var declarations and the must-match wording are present.
- **Command**:
  ```bash
  grep -nE 'BOOTSTRAP_ADMIN_EMAIL|VITE_ADMIN_EMAIL|same email|dual-source admin' .env.example
  ```
- **Expected Result**: Matches showing `BOOTSTRAP_ADMIN_EMAIL=` and `VITE_ADMIN_EMAIL=` declarations plus the "MUST be set to the SAME email" / "dual-source admin gate" cross-reference note on both. Exit code 0.
- [x] Pass <!-- 2026-06-14 -->

### UAT-ENV-002: .env.example documents all current environment variables
- **File**: `.env.example`
- **Description**: All current env vars consumed by host-server / app/api / app/frontend / deploy must be documented, including the code-only vars surfaced by TASK-059 (`VITE_API_URL`, `AUTH_PROXY_TARGET`).
- **Steps**:
  1. Run the command below; it asserts every required key appears as a declaration in `.env.example`.
  2. Confirm it prints `ALL VARS PRESENT`.
- **Command**:
  ```bash
  for v in BACKEND_PORT API_PORT CORS_ORIGIN DATABASE_URL BETTER_AUTH_SECRET HOST_SERVER_URL GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET PUBLIC_BASE_URL BOOTSTRAP_ADMIN_EMAIL FRONTEND_PORT PUBLIC_API_URL VITE_API_URL PROXY_TARGET AUTH_PROXY_TARGET VITE_ADMIN_EMAIL VITE_API_MODE VITE_DEVICE_ID DROPLET_IP; do grep -qE "^[# ]*${v}=" .env.example || { echo "MISSING: $v"; exit 1; }; done && echo "ALL VARS PRESENT"
  ```
- **Expected Result**: Prints `ALL VARS PRESENT`, no `MISSING:` lines. Exit code 0.
- [x] Pass <!-- 2026-06-14 -->

### UAT-ENV-003: .env.example contains no real secret values
- **File**: `.env.example`
- **Description**: The example file must carry placeholders only — `BETTER_AUTH_SECRET` must be empty and `DATABASE_URL` must remain the `USER:PASSWORD@HOST` placeholder.
- **Steps**:
  1. Run the command below.
  2. Confirm it prints `NO REAL SECRETS`.
- **Command**:
  ```bash
  grep -qE '^BETTER_AUTH_SECRET=$' .env.example && grep -qE '^DATABASE_URL=postgres://USER:PASSWORD@HOST' .env.example && echo "NO REAL SECRETS"
  ```
- **Expected Result**: Prints `NO REAL SECRETS`. Exit code 0.
- [x] Pass <!-- 2026-06-14 -->

### UAT-CLI-001: `conductor pair` accepts a positional code AND --code; help documents both
- **File**: `bin/conductor`
- **Description**: The `pair)` subcommand must accept the pairing code positionally (`conductor pair XXXX-XXXX`) in addition to `--code`, matching install.sh's usage. The `--help` text must document the positional form.
- **Steps**:
  1. Run `conductor pair --help` and confirm the usage line shows the optional positional `[<code>]` and the `--code` option.
  2. (Static cross-check) The positional branch in `bin/conductor` assigns a bare argument to `CODE`.
- **Command**:
  ```bash
  bash bin/conductor pair --help
  ```
- **Expected Result**: Help text printed including `Usage: conductor pair [<code>] [--portal <url>] [--code <code>]` and the line "The pairing code may be given positionally or via --code." Exit code 0.
- [x] Pass <!-- 2026-06-14 -->

### UAT-CLI-002: `bash -n bin/conductor` passes (no syntax errors)
- **File**: `bin/conductor`
- **Description**: The pair-subcommand code fix must not introduce a bash syntax error.
- **Steps**:
  1. Run the syntax check below.
  2. Confirm it prints `bin/conductor: syntax OK`.
- **Command**:
  ```bash
  bash -n bin/conductor && echo "bin/conductor: syntax OK"
  ```
- **Expected Result**: Prints `bin/conductor: syntax OK`, no parser errors. Exit code 0.
- [x] Pass <!-- 2026-06-14 -->

### UAT-CLI-003: install.sh invokes `conductor pair` with a positional code
- **File**: `install.sh`
- **Description**: install.sh's optional pairing step must call `bin/conductor pair <code>` positionally — the exact usage the positional-code fix was made to support.
- **Steps**:
  1. Run the grep below.
  2. Confirm install.sh passes the code positionally to `conductor pair`.
- **Command**:
  ```bash
  grep -nE 'bin/conductor" pair "\$(CONDUCTOR_PAIRING_)?[Cc]ode"' install.sh
  ```
- **Expected Result**: At least two matches showing `"$INSTALL_DIR/bin/conductor" pair "$CONDUCTOR_PAIRING_CODE"` and/or `... pair "$code"` (positional, not `--code`). Exit code 0.
- [x] Pass <!-- 2026-06-14 verified: install.sh has two positional invocations (lines 426, 436); test grep matched line 436, exit 0 -->

### UAT-LINK-001: All internal markdown links in the changed docs resolve
- **Description**: Every relative markdown link target referenced from `README.md`, `CLAUDE.md`, and `scripts/README.md` must exist on disk (no broken internal links). External `http(s)://` and pure `#anchor` links are skipped.
- **Steps**:
  1. Run the script below from the repo root. It extracts `[text](target)` links, drops external/anchor links, resolves each target relative to its source file, and reports any missing file.
  2. Confirm it prints `ALL INTERNAL LINKS RESOLVE`.
- **Command**:
  ```bash
  for f in README.md CLAUDE.md scripts/README.md; do d=$(dirname "$f"); grep -oE '\]\([^)]+\)' "$f" | sed -E 's/^\]\(//; s/\)$//' | sed -E 's/#.*$//' | grep -vE '^(https?:|mailto:)' | grep -vE '^$' | while read -r t; do [ -e "$d/$t" ] || echo "BROKEN in $f -> $t"; done; done; echo "ALL INTERNAL LINKS RESOLVE"
  ```
- **Expected Result**: Prints `ALL INTERNAL LINKS RESOLVE` with no preceding `BROKEN in ...` lines. Any `BROKEN in <file> -> <target>` line is a FAIL.
- [x] Pass <!-- 2026-06-14 -->

---

## Notes

- Targets verified to exist during generation: `install.sh`, `daemon/pair.ts`, `daemon/credentials.ts`, `daemon/connector.ts` (all present); link targets `SCRIPTS_GLOSSARY.md`, `hooks/README.md`, `CLAUDE.md`, `conductor.conf` (all present).
- `bash -n bin/conductor` and `conductor pair --help` confirmed passing during generation; the positional-code branch is at `bin/conductor` lines ~208-212.
