---
id: UAT-0192
aliases: [UAT-0192]
title: "UAT: Add an ANSI-stripped bg process output endpoint"
status: passed
task: TASK-0192
created: 2026-09-20
updated: 2026-10-17
---

# UAT-0192 — UAT: Add an ANSI-stripped bg process output endpoint

implements::[[TASK-0192]]

> **Source task**: [[TASK-0192]]
> **Generated**: 2026-09-20

Verifies `GET /api/bg-processes/:name/tail` (`host-server/index.ts`), the pure cleaner and bounded reader in `host-server/bgOutput.ts`, and the typed `bgTail()` client in `frontend/src/lib/api.ts`. This UAT carries the live smoke recipe that TASK-0192 marked `[DEFERRED-TO-UAT]`.

Cases UAT-API-001 .. UAT-API-008 all use one throwaway registered bg process, `t0192-smoke`, and only ever touch its own fixture log (`logs/bg-t0192-smoke.log`). Never edit a real bg log.

---

## Prerequisites

- [ ] Host-server running on port 8788 with the tmux session `conductor` alive (`make dev`, or the conductor already running). `POST /api/bg-processes` returns 409 `session not running` otherwise.
- [ ] Working directory is the repo root (fixture paths below are relative to it; `LOG_DIR` is `./logs`).
- [ ] `jq` is installed (used by a few API cases).
- [ ] Register the throwaway bg process (creates a tmux window `t0192-smoke` running `sleep 3600` and attaches `pipe-pane` logging to `logs/bg-t0192-smoke.log`). Expect `201 {"ok":true,"bg":{"name":"t0192-smoke",...}}`:
  ```bash
  curl -sS -X POST 'http://localhost:8788/api/bg-processes' -H 'Content-Type: application/json' -d '{"name":"t0192-smoke","workdir":"/Users/davidtaylor/Repositories/tmux-conductor/tmp","launchCmd":"sleep 3600"}'
  ```
- [ ] Write fixture A (colour escape, `\r` progress redraw, restart marker). This overwrites the throwaway log only:
  ```bash
  printf 'plain\n\033[31mred\033[0m\nprogress 10%%\rprogress 100%%\n--- restart 2026-09-19T00:00:00Z ---\n' > logs/bg-t0192-smoke.log
  ```

---

## Test Cases

### UAT-API-001: text format returns clean text (colour stripped, progress collapsed, restart marker kept)
- **Endpoint**: `GET /api/bg-processes/t0192-smoke/tail?lines=20&format=text`
- **Description**: The smoke recipe from TASK-0192. With fixture A in place the plain-text response has no escape bytes, the `\r`-redrawn progress line shows only its final frame, and the `--- restart ... ---` marker line passes through unchanged.
- **Steps**:
  1. Confirm fixture A is in place (Prerequisites).
  2. Run the curl command below as-is.
- **Command**:
  ```bash
  curl -sS 'http://localhost:8788/api/bg-processes/t0192-smoke/tail?lines=20&format=text'
  ```
- **Expected Result**: HTTP 200; body is exactly these four lines followed by a trailing newline, with no `ESC`/`[31m` text and no `progress 10%`:
  ```
  plain
  red
  progress 100%
  --- restart 2026-09-19T00:00:00Z ---
  ```
- **Repeatable Unit Test**: Created: `host-server/bgOutput.test.ts` (cleaner and reader logic only; the HTTP wiring is not unit-testable, see gaps)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test bgOutput.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-002: text format is served as text/plain
- **Endpoint**: `GET /api/bg-processes/t0192-smoke/tail?format=text`
- **Description**: `?format=text` responds with a `text/plain` content type so the shell skill script needs no `jq`.
- **Steps**:
  1. Run the curl command below as-is (prints the response headers only).
- **Command**:
  ```bash
  curl -sS -D - -o /dev/null 'http://localhost:8788/api/bg-processes/t0192-smoke/tail?format=text'
  ```
- **Expected Result**: Status line `HTTP/1.1 200 OK` and a header `content-type: text/plain; charset=utf-8`.
- **Repeatable Unit Test**: Not applicable: asserts the real Fastify route's response header
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-003: JSON form returns the documented shape
- **Endpoint**: `GET /api/bg-processes/t0192-smoke/tail` (no `format`, no `lines`, so the default of 50 applies)
- **Description**: The default JSON response carries `name`, `lines`, `truncated`, `sizeBytes`, `logPath`, `updatedAt` with the right types and values for fixture A.
- **Steps**:
  1. Run the curl command below as-is.
- **Command**:
  ```bash
  curl -sS 'http://localhost:8788/api/bg-processes/t0192-smoke/tail'
  ```
- **Expected Result**: HTTP 200 and JSON with exactly these keys:
  - `name`: `"t0192-smoke"`
  - `lines`: `["plain","red","progress 100%","--- restart 2026-09-19T00:00:00Z ---"]`
  - `truncated`: `false`
  - `sizeBytes`: `83` (the raw fixture byte count, not the cleaned length)
  - `logPath`: absolute path ending in `/logs/bg-t0192-smoke.log`
  - `updatedAt`: an ISO-8601 timestamp string (not null)
- **Repeatable Unit Test**: Not applicable: asserts the live route's response envelope (the reader's fields are unit-covered by `host-server/bgOutput.test.ts`)
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-004: `lines` returns only the last N lines
- **Endpoint**: `GET /api/bg-processes/t0192-smoke/tail?lines=2`
- **Description**: With four cleaned lines in the log, `lines=2` returns the final two, in order.
- **Steps**:
  1. Run the curl command below as-is.
- **Command**:
  ```bash
  curl -sS 'http://localhost:8788/api/bg-processes/t0192-smoke/tail?lines=2' | jq -c '.lines'
  ```
- **Expected Result**: `["progress 100%","--- restart 2026-09-19T00:00:00Z ---"]`
- **Repeatable Unit Test**: Created: `host-server/bgOutput.test.ts` (`lines clamp` test on `readLogTail`)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test bgOutput.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-005: `lines` is clamped to 1..1000 and falls back to 50 on garbage
- **Endpoint**: `GET /api/bg-processes/t0192-smoke/tail?lines=0` and `?lines=abc`
- **Description**: Same clamping as `GET /agents/:id/tail`: `lines=0` clamps up to 1 (one line, the last), `lines=abc` (NaN) falls back to the default of 50 (all four lines of the fixture).
- **Steps**:
  1. Run the first curl below (`lines=0`), then the second (`lines=abc`).
- **Command**:
  ```bash
  curl -sS 'http://localhost:8788/api/bg-processes/t0192-smoke/tail?lines=0' | jq -c '.lines'
  ```
  ```bash
  curl -sS 'http://localhost:8788/api/bg-processes/t0192-smoke/tail?lines=abc' | jq -c '.lines'
  ```
- **Expected Result**: First prints `["--- restart 2026-09-19T00:00:00Z ---"]` (exactly one line); second prints all four lines: `["plain","red","progress 100%","--- restart 2026-09-19T00:00:00Z ---"]`. Neither returns an error status.
- **Repeatable Unit Test**: Created: `host-server/bgOutput.test.ts` (`clampTailLines` test: 0 -> 1, -5 -> 1, 99999 -> 1000, `abc` -> 50)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test bgOutput.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-006: a log larger than the read window reports `truncated: true` and stays bounded
- **Endpoint**: `GET /api/bg-processes/t0192-smoke/tail?lines=1000`
- **Description**: The endpoint never reads the whole file: for a log larger than `TAIL_MAX_BYTES` (256 KiB) it reports `truncated: true`, still returns full lines only, and honours the 1000-line ceiling even when more is requested.
- **Steps**:
  1. Replace the fixture with a ~660 KB log (20000 lines, well over 256 KiB):
     ```bash
     yes 'filler line of dev server output' | head -n 20000 > logs/bg-t0192-smoke.log
     ```
  2. Run the curl command below as-is.
  3. Repeat with `lines=99999` in place of `lines=1000` and confirm the same count.
- **Command**:
  ```bash
  curl -sS 'http://localhost:8788/api/bg-processes/t0192-smoke/tail?lines=1000' | jq -c '{n: (.lines | length), truncated, sizeBytes, first: .lines[0]}'
  ```
- **Expected Result**: `{"n":1000,"truncated":true,"sizeBytes":660000,"first":"filler line of dev server output"}` (the first line is a complete line, never a partial fragment). Step 3 also yields `n` = 1000.
- **Repeatable Unit Test**: Created: `host-server/bgOutput.test.ts` (`log larger than maxBytes`, `window begins exactly on a line boundary`, `exactly maxBytes long is not truncated`)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test bgOutput.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-007: unknown bg process name returns 404
- **Endpoint**: `GET /api/bg-processes/t0192-nope/tail`
- **Description**: A name not registered in SQLite returns 404 with a JSON error, not an empty 200.
- **Steps**:
  1. Run the curl command below as-is.
- **Command**:
  ```bash
  curl -sS -i 'http://localhost:8788/api/bg-processes/t0192-nope/tail'
  ```
- **Expected Result**: `HTTP/1.1 404 Not Found` with body `{"error":"bg process 't0192-nope' not found"}`.
- **Repeatable Unit Test**: Not applicable: 404 comes from the live route's `listBgProcesses(db)` lookup; `host-server/index.ts` has no route-level test harness
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-008: registered bg process with no log yet returns 200 with empty lines
- **Endpoint**: `GET /api/bg-processes/t0192-smoke/tail`
- **Description**: A registered process whose log file does not exist is not an error: `200` with empty `lines`, `sizeBytes: 0`, `truncated: false`, `updatedAt: null`. The text form returns an empty body.
- **Steps**:
  1. Remove the throwaway fixture log (only this file):
     ```bash
     rm logs/bg-t0192-smoke.log
     ```
  2. Run the curl command below as-is.
  3. Repeat with `?format=text` and confirm HTTP 200 with `content-length: 0` (for example `curl -sS -D - 'http://localhost:8788/api/bg-processes/t0192-smoke/tail?format=text'`).
- **Command**:
  ```bash
  curl -sS 'http://localhost:8788/api/bg-processes/t0192-smoke/tail'
  ```
- **Expected Result**: HTTP 200; JSON `{"name":"t0192-smoke","lines":[],"truncated":false,"sizeBytes":0,"logPath":"<repo>/logs/bg-t0192-smoke.log","updatedAt":null}`. Text form: 200, `content-type: text/plain; charset=utf-8`, empty body.
- **Repeatable Unit Test**: Created: `host-server/bgOutput.test.ts` (`a missing file yields empty lines, size 0, null updatedAt`)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test bgOutput.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-EDGE-001: served text contains no raw escape bytes
- **Scenario**: Belt-and-braces byte-level check that nothing terminal-control survives through the real route (the visual check in UAT-API-001 cannot show an invisible ESC byte).
- **Steps**:
  1. Rewrite fixture A (see Prerequisites; the log was removed in UAT-API-008):
     ```bash
     printf 'plain\n\033[31mred\033[0m\nprogress 10%%\rprogress 100%%\n--- restart 2026-09-19T00:00:00Z ---\n' > logs/bg-t0192-smoke.log
     ```
  2. Run the curl command below as-is and read the `od -c` output.
- **Command**:
  ```bash
  curl -sS 'http://localhost:8788/api/bg-processes/t0192-smoke/tail?lines=20&format=text' | od -c
  ```
- **Expected Result**: The `od -c` dump shows only printable characters and `\n` (no `033`, no `\r`, no `[`, `3`, `1`, `m` as an escape residue between `r e d`). Sequence reads `p l a i n \n r e d \n p r o g r e s s   1 0 0 % \n - - - ...`.
- **Repeatable Unit Test**: Created: `host-server/bgOutput.test.ts` (`SGR colour sequences are removed`, `a \r-redrawn progress line collapses to its last frame`)
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test bgOutput.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-EDGE-002: cleaner handles CRLF, OSC, cursor moves, UTF-8, backspace and restart markers
- **Scenario**: Pure-function behaviour of `cleanTerminalOutput`: `\r\n` line endings survive as line breaks instead of wiping their line; a redraw followed by CRLF keeps the last frame; OSC title sequences (BEL and ST terminated, and unterminated) and CSI cursor/erase sequences are removed; other two-byte escapes are removed; UTF-8 multibyte text is unharmed; a stray backspace is dropped (documented choice, not applied); `\t` and `\n` are preserved; `--- restart ... ---` marker lines pass through unchanged.
- **Steps**:
  1. Run the Unit Test Command below.
  2. Confirm all `cleanTerminalOutput` tests pass.
- **Expected Result**: `bgOutput.test.ts` reports 23 tests, 23 pass, 0 fail (cleaner cases: SGR, cursor-move CSI, OSC BEL/ST, unterminated OSC, two-byte escapes, `\r` collapse, CRLF preserved, redraw then CRLF, UTF-8, restart marker, tabs/newlines with control bytes dropped).
- **Repeatable Unit Test**: Created: `host-server/bgOutput.test.ts`
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test bgOutput.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-EDGE-003: window boundary never garbles kept lines
- **Scenario**: When the 256 KiB read window starts mid-file, the leading partial line is dropped, a boundary landing exactly on a line start keeps that line, a multibyte UTF-8 character split at the boundary never produces a replacement character in a kept line, and a single line longer than the window yields no lines with `truncated: true`.
- **Steps**:
  1. Run the Unit Test Command below.
  2. Confirm the `readLogTail` suite passes.
- **Expected Result**: All `readLogTail` tests pass, including the multibyte sweep over window sizes 22..80 and the single-oversized-line case.
- **Repeatable Unit Test**: Created: `host-server/bgOutput.test.ts`
- **Unit Test Command**: `cd host-server && node --import tsx/esm --test bgOutput.test.ts`
- [x] Pass <!-- 2026-09-20 -->

### UAT-API-009: cleanup the throwaway bg process
- **Endpoint**: `DELETE /api/bg-processes/t0192-smoke`
- **Description**: Removes the throwaway registration and its tmux window, and confirms the tail route then 404s for it. Run last, and run it even if earlier cases failed.
- **Steps**:
  1. Remove the fixture log if it still exists (only this file):
     ```bash
     rm -f logs/bg-t0192-smoke.log
     ```
  2. Run the curl command below as-is.
  3. Confirm the window is gone: `tmux list-windows -t conductor -F '#W'` shows no `t0192-smoke`.
  4. Confirm `curl -sS -o /dev/null -w '%{http_code}' 'http://localhost:8788/api/bg-processes/t0192-smoke/tail'` prints `404`.
- **Command**:
  ```bash
  curl -sS -X DELETE 'http://localhost:8788/api/bg-processes/t0192-smoke'
  ```
- **Expected Result**: `{"ok":true,"removed":"t0192-smoke"}`; no `t0192-smoke` tmux window; follow-up tail request returns 404; `logs/bg-t0192-smoke.log` does not exist.
- **Repeatable Unit Test**: Not applicable: lifecycle cleanup of live tmux/SQLite state
- [x] Pass <!-- 2026-09-20 -->

### UAT-INT-001: frontend `bgTail()` client typechecks against the response shape
- **Description**: `frontend/src/lib/api.ts` exports `BgTail` (`name`, `lines`, `truncated`, `sizeBytes`, `logPath`, `updatedAt: string | null`) and `bgTail(name, lines?)`, which calls `/bg-processes/<encoded name>/tail[?lines=N]` and throws with the server's `error` message on a non-OK response. Type-only in this task; UI use is Phase 4.
- **Steps**:
  1. Run the command below from the repo root.
  2. In `frontend/src/lib/api.ts`, confirm `BgTail` fields mirror the JSON keys in UAT-API-003.
- **Command**:
  ```bash
  cd frontend && npx tsc --noEmit
  ```
- **Expected Result**: `tsc` prints nothing and exits 0.
- **Repeatable Unit Test**: Not applicable: type-level check, covered by the frontend typecheck gate rather than a runtime assertion
- [x] Pass <!-- 2026-09-20 -->

### UAT-DOC-001: CLAUDE.md documents the new route
- **Description**: The `host-server/index.ts` row in the Core Scripts table of `CLAUDE.md` lists `GET /bg-processes/:slug/tail?lines=N[&format=text]` with its ANSI-stripped, bounded-tail semantics.
- **Steps**:
  1. Search `CLAUDE.md` for `bg-processes/:slug/tail`.
  2. Read the matched text in the `host-server/index.ts` row.
- **Expected Result**: The row lists the route, the `lines` and `format=text` params, notes ANSI-stripped/bounded tail of `bg-<slug>.log`, and states `format=text` returns `text/plain`.
- **Repeatable Unit Test**: Not applicable: documentation check
- [x] Pass <!-- 2026-10-17 --> CLAUDE.md line 45 documents `GET /bg-processes/:slug/tail?lines=N[&format=text]` (ANSI-stripped, bounded tail of `bg-<slug>.log`; `format=text` returns `text/plain`; all `/bg-processes/:slug` routes keyed by slug).
