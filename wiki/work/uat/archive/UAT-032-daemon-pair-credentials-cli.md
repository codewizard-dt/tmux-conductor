---
id: UAT-032
title: "UAT: daemon/pair.ts + daemon/credentials.ts; conductor pair / conductor unpair CLI"
status: passed
task: TASK-032
created: 2026-06-14
updated: 2026-06-14
---

# UAT-032 — UAT: daemon/pair.ts + daemon/credentials.ts; conductor pair / conductor unpair CLI

implements::[[TASK-032]]

> **Source task**: [[TASK-032]]
> **Generated**: 2026-06-14

---

## Prerequisites

- [ ] Node.js >= 22 (built-in `fetch`, `tsx` available in `daemon/node_modules`)
- [ ] Repo checked out at `/Users/davidtaylor/Repositories/tmux-conductor`; commands run from the repo root
- [ ] `daemon/` dependencies installed (`daemon/node_modules` present, including `tsx`)
- [ ] A scratch CONDUCTOR_HOME under `./tmp/pair-smoke/` is used for all credential-writing tests so the real `~/.local/share/tmux-conductor/device.json` is never touched
- [ ] No real `device.json` exists in the scratch dir at the start of each test (each command sets `CONDUCTOR_HOME` to an isolated path)

---

## Test Cases

### UAT-EDGE-001: `conductor pair --help` prints usage
- **Scenario**: The `pair` subcommand help text is wired into `bin/conductor`.
- **Description**: Verifies `conductor pair --help` exits 0 and prints the usage block with both flags documented, without contacting any portal.
- **Steps**:
  1. Run the command below as-is from the repo root.
  2. Read the output.
- **Command**:
  ```bash
  bash bin/conductor pair --help
  ```
- **Expected Result**: Exit 0. Output contains `Usage: conductor pair [--portal <url>] [--code <code>]`, a line documenting `--portal <url>`, and a line documenting `--code <code>`. No network call is made.
- [x] Pass <!-- 2026-06-14 -->

### UAT-EDGE-002: `conductor unpair --help` prints usage
- **Scenario**: The `unpair` subcommand help text is wired into `bin/conductor`.
- **Description**: Verifies `conductor unpair --help` exits 0 and documents the `--revoke` flag.
- **Steps**:
  1. Run the command below as-is.
  2. Read the output.
- **Command**:
  ```bash
  bash bin/conductor unpair --help
  ```
- **Expected Result**: Exit 0. Output contains `Usage: conductor unpair [--revoke]` and a line documenting `--revoke` (calls `DELETE /api/devices/:deviceId` before removing).
- [x] Pass <!-- 2026-06-14 -->

### UAT-EDGE-003: `conductor help` lists pair and unpair commands
- **Scenario**: Top-level help advertises the new subcommands.
- **Description**: Verifies the `pair` and `unpair` rows are present in the main `conductor help` output, plus the `CONDUCTOR_HOME` environment note.
- **Steps**:
  1. Run the command below as-is.
  2. Read the output.
- **Command**:
  ```bash
  bash bin/conductor help
  ```
- **Expected Result**: Exit 0. Output contains a `pair` line ("Pair this device with the portal"), an `unpair` line ("Remove local device credentials (--revoke ...)"), and the `CONDUCTOR_HOME` environment description.
- [x] Pass <!-- 2026-06-14 -->

### UAT-EDGE-004: `conductor unpair` is idempotent with no credentials present
- **Scenario**: Unpairing when `device.json` does not exist must succeed (no error).
- **Description**: Points `CONDUCTOR_HOME` at a fresh empty scratch dir and runs `unpair`; the command must print the "Unpaired" confirmation and exit 0, never erroring on the missing file.
- **Steps**:
  1. Run the command below as-is (it creates an isolated empty CONDUCTOR_HOME first).
  2. Confirm exit 0 and the confirmation line.
- **Command**:
  ```bash
  rm -rf ./tmp/pair-smoke/edge004 && mkdir -p ./tmp/pair-smoke/edge004 && CONDUCTOR_HOME="$PWD/tmp/pair-smoke/edge004" bash bin/conductor unpair
  ```
- **Expected Result**: Exit 0. Output is `Unpaired. Credentials removed from .../tmp/pair-smoke/edge004/device.json.`. No `device.json` is created.
- [x] Pass <!-- 2026-06-14 -->

### UAT-EDGE-005: `conductor unpair` removes an existing device.json
- **Scenario**: Unpairing deletes the local credentials file.
- **Description**: Seeds a fake `device.json` in an isolated CONDUCTOR_HOME, runs `unpair` (no `--revoke`, so no network), and confirms the file is gone afterward.
- **Steps**:
  1. Run the command below as-is. It writes a fake `device.json`, runs `unpair`, then prints whether the file still exists.
- **Command**:
  ```bash
  rm -rf ./tmp/pair-smoke/edge005 && mkdir -p ./tmp/pair-smoke/edge005 && printf '%s\n' '{"portalUrl":"http://localhost:8080","deviceId":"dev-123","token":"tcd_fake"}' > ./tmp/pair-smoke/edge005/device.json && CONDUCTOR_HOME="$PWD/tmp/pair-smoke/edge005" bash bin/conductor unpair && test ! -f ./tmp/pair-smoke/edge005/device.json && echo "FILE_DELETED"
  ```
- **Expected Result**: Exit 0. Output includes the `Unpaired. Credentials removed from ...` line followed by `FILE_DELETED`, proving the seeded file was removed.
- [x] Pass <!-- 2026-06-14 -->

### UAT-EDGE-006: `writeCredentials` writes atomically with chmod 600 and gitignores device.json
- **Scenario**: Core credentials persistence contract (atomic write + 0600 perms + idempotent .gitignore append).
- **Description**: Calls `writeCredentials` via tsx against an isolated CONDUCTOR_HOME, then asserts the file is valid JSON with all three fields and mode `600`. Runs inside an isolated throwaway git repo so the `ensureGitignored` git-root detection appends `device.json` to *that* repo's `.gitignore`, never the real one.
- **Steps**:
  1. Run the command below as-is. It creates an isolated git repo + CONDUCTOR_HOME under `./tmp/pair-smoke/edge006`, runs `writeCredentials`, and reports the file mode and gitignore contents.
- **Command**:
  ```bash
  rm -rf ./tmp/pair-smoke/edge006 && mkdir -p ./tmp/pair-smoke/edge006/home && git -C ./tmp/pair-smoke/edge006 init -q && CONDUCTOR_HOME="$PWD/tmp/pair-smoke/edge006/home" node --import tsx/esm -e "import {writeCredentials,readCredentials,credentialsPath} from './daemon/credentials.ts'; import * as fs from 'node:fs'; process.chdir('./tmp/pair-smoke/edge006'); writeCredentials({portalUrl:'http://localhost:8080',deviceId:'dev-abc',token:'tcd_secret'}); const p=credentialsPath(); const mode=(fs.statSync(p).mode & 0o777).toString(8); const c=readCredentials(); const gi=fs.readFileSync('.gitignore','utf8'); console.log(JSON.stringify({mode, creds:c, gitignoreHasEntry: gi.split('\n').some(l=>l.trim()==='device.json')}));"
  ```
- **Expected Result**: Exit 0. JSON output shows `"mode":"600"`, `creds` equal to `{portalUrl:"http://localhost:8080",deviceId:"dev-abc",token:"tcd_secret"}`, and `"gitignoreHasEntry":true`.
- [x] Pass <!-- 2026-06-14 -->

### UAT-EDGE-007: `ensureGitignored` is idempotent (no duplicate entry on repeat writes)
- **Scenario**: Writing credentials twice must not add `device.json` to `.gitignore` more than once.
- **Description**: Runs `writeCredentials` twice in the same isolated git repo and asserts `device.json` appears exactly once in `.gitignore`.
- **Steps**:
  1. Run the command below as-is.
- **Command**:
  ```bash
  rm -rf ./tmp/pair-smoke/edge007 && mkdir -p ./tmp/pair-smoke/edge007/home && git -C ./tmp/pair-smoke/edge007 init -q && CONDUCTOR_HOME="$PWD/tmp/pair-smoke/edge007/home" node --import tsx/esm -e "import {writeCredentials} from './daemon/credentials.ts'; import * as fs from 'node:fs'; process.chdir('./tmp/pair-smoke/edge007'); const c={portalUrl:'http://localhost:8080',deviceId:'d',token:'tcd_x'}; writeCredentials(c); writeCredentials(c); const n=fs.readFileSync('.gitignore','utf8').split('\n').filter(l=>l.trim()==='device.json').length; console.log('count='+n);"
  ```
- **Expected Result**: Exit 0. Output is `count=1` — the entry is present exactly once after two writes.
- [x] Pass <!-- 2026-06-14 -->

### UAT-EDGE-008: `writeCredentials` rejects empty fields
- **Scenario**: Validation guard — all three fields must be non-empty strings.
- **Description**: Calls `writeCredentials` with an empty `token` and asserts it throws and no file is written.
- **Steps**:
  1. Run the command below as-is.
- **Command**:
  ```bash
  rm -rf ./tmp/pair-smoke/edge008 && mkdir -p ./tmp/pair-smoke/edge008 && CONDUCTOR_HOME="$PWD/tmp/pair-smoke/edge008" node --import tsx/esm -e "import {writeCredentials,credentialsPath} from './daemon/credentials.ts'; import * as fs from 'node:fs'; let threw=false; try { writeCredentials({portalUrl:'http://localhost:8080',deviceId:'d',token:''}); } catch (e) { threw=true; } console.log(JSON.stringify({threw, fileExists: fs.existsSync(credentialsPath())}));"
  ```
- **Expected Result**: Exit 0. JSON output shows `"threw":true` and `"fileExists":false`.
- [x] Pass <!-- 2026-06-14 -->

### UAT-EDGE-009: `readCredentials` returns null for malformed device.json (no throw)
- **Scenario**: A corrupt credentials file must be tolerated, not crash the daemon.
- **Description**: Writes invalid JSON to `device.json` and asserts `readCredentials()` returns `null` and emits a warning rather than throwing.
- **Steps**:
  1. Run the command below as-is.
- **Command**:
  ```bash
  rm -rf ./tmp/pair-smoke/edge009 && mkdir -p ./tmp/pair-smoke/edge009 && printf '%s' 'not json {{{' > ./tmp/pair-smoke/edge009/device.json && CONDUCTOR_HOME="$PWD/tmp/pair-smoke/edge009" node --import tsx/esm -e "import {readCredentials} from './daemon/credentials.ts'; const r=readCredentials(); console.log('result='+JSON.stringify(r));"
  ```
- **Expected Result**: Exit 0. Output includes `result=null` (and a `[conductor] Warning:` line on stderr). The process does not crash.
- [x] Pass <!-- 2026-06-14 -->

### UAT-EDGE-010: `readCredentials` returns null when the file is absent
- **Scenario**: No credentials yet (unpaired device).
- **Description**: Points CONDUCTOR_HOME at an empty dir and asserts `readCredentials()` returns `null`.
- **Steps**:
  1. Run the command below as-is.
- **Command**:
  ```bash
  rm -rf ./tmp/pair-smoke/edge010 && mkdir -p ./tmp/pair-smoke/edge010 && CONDUCTOR_HOME="$PWD/tmp/pair-smoke/edge010" node --import tsx/esm -e "import {readCredentials} from './daemon/credentials.ts'; console.log('result='+JSON.stringify(readCredentials()));"
  ```
- **Expected Result**: Exit 0. Output is `result=null`.
- [x] Pass <!-- 2026-06-14 -->

### UAT-EDGE-011: `pairDevice` surfaces a user-friendly error on portal API failure
- **Scenario**: Redeeming a bad/expired code returns a 400 with `{ error: "invalid_or_expired_code" }`; the daemon must throw a readable error and not write credentials.
- **Description**: Runs a throwaway local HTTP stub that responds 400 `{"error":"invalid_or_expired_code"}` to `POST /api/pair/redeem`, then calls `pairDevice({portalUrl, code})` against it (both flags supplied → no interactive prompt). Asserts the thrown message mentions the failure and that no `device.json` is written.
- **Steps**:
  1. Run the command below as-is. It starts a Node HTTP stub on an ephemeral port, calls `pairDevice`, captures the error, and reports whether credentials were written.
- **Command**:
  ```bash
  rm -rf ./tmp/pair-smoke/edge011 && mkdir -p ./tmp/pair-smoke/edge011 && CONDUCTOR_HOME="$PWD/tmp/pair-smoke/edge011" node --import tsx/esm -e "import http from 'node:http'; import * as fs from 'node:fs'; import {pairDevice} from './daemon/pair.ts'; import {credentialsPath} from './daemon/credentials.ts'; const srv=http.createServer((req,res)=>{res.statusCode=400;res.setHeader('content-type','application/json');res.end(JSON.stringify({error:'invalid_or_expired_code'}));}); srv.listen(0, async ()=>{const port=srv.address().port; let msg=''; try { await pairDevice({portalUrl:'http://localhost:'+port, code:'ABCD-1234'}); } catch(e){ msg=e.message; } console.log(JSON.stringify({error:msg, wroteFile: fs.existsSync(credentialsPath())})); srv.close();});"
  ```
- **Expected Result**: Exit 0. JSON output shows an `error` string containing `Pairing failed: invalid_or_expired_code — generate a new code from the portal.` and `"wroteFile":false`.
- [x] Pass <!-- 2026-06-14 -->

### UAT-EDGE-012: `pairDevice` happy path writes credentials from a stub portal response
- **Scenario**: A successful redeem returns `{ token, deviceId }`; `pairDevice` must persist them via `writeCredentials`.
- **Description**: Runs a local HTTP stub that responds 200 `{"token":"tcd_stub","deviceId":"dev-stub"}`, calls `pairDevice` against it in an isolated git repo + CONDUCTOR_HOME, and asserts `device.json` is created with the returned values and mode 600.
- **Steps**:
  1. Run the command below as-is.
- **Command**:
  ```bash
  rm -rf ./tmp/pair-smoke/edge012 && mkdir -p ./tmp/pair-smoke/edge012/home && git -C ./tmp/pair-smoke/edge012 init -q && CONDUCTOR_HOME="$PWD/tmp/pair-smoke/edge012/home" node --import tsx/esm -e "import http from 'node:http'; import * as fs from 'node:fs'; import {pairDevice} from './daemon/pair.ts'; import {readCredentials,credentialsPath} from './daemon/credentials.ts'; process.chdir('./tmp/pair-smoke/edge012'); const srv=http.createServer((req,res)=>{res.statusCode=200;res.setHeader('content-type','application/json');res.end(JSON.stringify({token:'tcd_stub',deviceId:'dev-stub'}));}); srv.listen(0, async ()=>{const port=srv.address().port; await pairDevice({portalUrl:'http://localhost:'+port, code:'ABCD-1234'}); const c=readCredentials(); const mode=(fs.statSync(credentialsPath()).mode & 0o777).toString(8); console.log(JSON.stringify({creds:c, mode})); srv.close();});"
  ```
- **Expected Result**: Exit 0. JSON output shows `creds.token === "tcd_stub"`, `creds.deviceId === "dev-stub"`, `creds.portalUrl === "http://localhost:<port>"`, and `"mode":"600"`. A `✓ Paired device dev-stub ...` log line is printed.
- [x] Pass <!-- 2026-06-14 -->

### UAT-EDGE-013: daemon typecheck passes
- **Scenario**: `npx tsc --noEmit` over the daemon tsconfig (which includes `credentials.ts` and `pair.ts`) must be clean.
- **Description**: Runs the daemon's strict typecheck and asserts zero errors.
- **Steps**:
  1. Run the command below as-is from the repo root.
- **Command**:
  ```bash
  npx --prefix daemon tsc --noEmit -p daemon/tsconfig.json
  ```
- **Expected Result**: Exit 0 with no output (no type errors reported).
- [x] Pass <!-- 2026-06-14 -->

### UAT-EDGE-014: `bin/conductor` passes bash syntax check
- **Scenario**: The CLI script must be syntactically valid after the pair/unpair additions.
- **Description**: Runs `bash -n` over `bin/conductor`.
- **Steps**:
  1. Run the command below as-is.
- **Command**:
  ```bash
  bash -n bin/conductor
  ```
- **Expected Result**: Exit 0 with no output.
- [x] Pass <!-- 2026-06-14 -->

### UAT-EDGE-015 (OPTIONAL, manual): End-to-end pairing against a live portal
- **Scenario**: Full happy path against a running `app/api` portal with Postgres.
- **Description**: Optional manual test requiring a live portal at `http://localhost:8080`, a signed-in user, and a freshly generated pairing code from `POST /api/pair/code`. Verifies the real `conductor pair` writes `device.json` at `$CONDUCTOR_HOME` with mode 600 and that `.gitignore` lists `device.json`. Skip (mark Pass with a note) if no live portal is available — the stubbed UAT-EDGE-012 covers the same code path deterministically.
- **Steps**:
  1. Start the portal (`app/api`) with a reachable Postgres `DATABASE_URL`.
  2. Sign in and generate a pairing code via the portal UI or `POST /api/pair/code`.
  3. Run `CONDUCTOR_HOME="$PWD/tmp/pair-smoke/live" bash bin/conductor pair --portal http://localhost:8080 --code <CODE>`.
  4. Inspect `./tmp/pair-smoke/live/device.json` perms and contents; inspect repo `.gitignore`.
- **Expected Result**: `conductor pair` prints `✓ Paired device <uuid> to http://localhost:8080.`; `device.json` exists with mode `600` containing `portalUrl`, `deviceId`, `token`; `.gitignore` contains `device.json`.
- [FAIL: auto-judge: manual test requires human verification] <!-- 2026-06-14 -->

---

## Notes

- This task is daemon-side (a Node module pair + a bash CLI), not a dashboard HTTP API, so all tests are EDGE/integration tests driven via `tsx` one-liners and the `bin/conductor` script rather than UAT-API/UAT-UI cases.
- The portal endpoint `POST /api/pair/redeem` (TASK-031) returns `{ token, deviceId }` on success and `400 { error: "invalid_or_expired_code" | "missing_code" }` on failure; UAT-EDGE-011/012 stub these exact responses to exercise `pairDevice` deterministically without Postgres.
- All credential-writing tests pin `CONDUCTOR_HOME` to an isolated path under `./tmp/pair-smoke/` and (where `ensureGitignored` runs) `chdir`/`git init` into an isolated repo, so the developer's real `~/.local/share/tmux-conductor/device.json` and the project `.gitignore` are never modified.
