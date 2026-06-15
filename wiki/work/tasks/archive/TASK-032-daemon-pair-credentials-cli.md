---
id: TASK-032
title: "daemon/pair.ts + daemon/credentials.ts; conductor pair / conductor unpair CLI"
status: done
created: 2026-06-13
updated: 2026-06-14
depends_on: [TASK-031]
blocks: []
parallel_safe_with: []
uat: "[[UAT-032]]"
tags: [daemon, pairing, cli, credentials, relay, roadmap-002]
---

# TASK-032 — daemon/pair.ts + daemon/credentials.ts; conductor pair / conductor unpair CLI

## Objective

Add the local-daemon side of device pairing (ROADMAP-002 Phase 3, second item): `daemon/credentials.ts` — persists the device token and portal URL to a local credentials file (`$CONDUCTOR_HOME/device.json`); `daemon/pair.ts` — orchestrates the pairing flow (prompt user for a pairing code, call `POST /api/pair/redeem` on the portal, store the returned token); and two new `bin/conductor` subcommands: `conductor pair` (interactively pairs a device or accepts a `--code` flag for non-interactive use, e.g. from `install.sh`) and `conductor unpair` (deletes the local device credentials and optionally revokes the device on the portal via the devices API, TASK-033). Once paired, the daemon reads credentials from `$CONDUCTOR_HOME/device.json` and uses the device token to authenticate outbound relay connections (Phase 4).

## Approach

**Credentials file**: `$CONDUCTOR_HOME/device.json` — JSON object `{ "portalUrl": "https://...", "deviceId": "<uuid>", "token": "tcd_..." }`. Written atomically (write to `.tmp`, then `fs.renameSync` — avoids partial writes). Read by the relay connector (Phase 4) at startup. Never committed to git (gitignored).

**Pairing flow** (`daemon/pair.ts`):
1. Prompt the user for their portal URL (skip if `--portal` flag supplied).
2. Prompt for the pairing code (skip if `--code` flag supplied); normalise (uppercase, strip dashes).
3. POST `{ code }` to `<portalUrl>/api/pair/redeem`.
4. On success (`{ token, deviceId }`), call `writeCredentials({ portalUrl, deviceId, token })`.
5. Print success message: `Paired! Device ID: <uuid>. Credentials saved to $CONDUCTOR_HOME/device.json.`
6. On error: print the portal's `error` field + instructions to generate a new code.

**`conductor pair` subcommand**: thin CLI wrapper around `daemon/pair.ts`. Reads `--code` / `--portal` flags. If neither is supplied, prompts interactively via `readline` (reads from `/dev/tty` to work correctly even when stdin is piped — mirrors install.sh's pairing section).

**`conductor unpair` subcommand**: removes `$CONDUCTOR_HOME/device.json`. If `--revoke` flag passed, reads the file first and calls `DELETE /api/devices/:deviceId` on the portal with `Authorization: Bearer <token>` before deleting locally. Prints a confirmation line either way.

**Security**: the token is written to disk with `fs.chmodSync(path, 0o600)` immediately after write. The `device.json` path is added to `.gitignore` if not already present (check and append idempotently in the write helper).

## Steps

### 1. Confirm prerequisites  <!-- agent: general-purpose -->

- [x] Use Serena `list_dir` on `daemon/` to confirm the daemon service structure (likely `daemon/index.ts`, maybe existing `daemon/` submodules). Note how the daemon boots and what utilities exist.
- [x] Use Serena `find_file` for `bin/conductor` to note the existing subcommand dispatch pattern (the `install` and `daemon` subcommands serve as the template).
- [x] Use Serena `search_for_pattern` for `CONDUCTOR_HOME` in `bin/conductor` and `daemon/` — confirm how the home dir is resolved (likely `${CONDUCTOR_HOME:-$HOME/.local/share/tmux-conductor}`).
- [x] Check `.gitignore` for any existing `device.json` or `*.json` credential entries.

### 2. Implement `daemon/credentials.ts`  <!-- agent: general-purpose -->

- [x] Create `daemon/credentials.ts` with:
  - `type DeviceCredentials = { portalUrl: string; deviceId: string; token: string }`.
  - `credentialsPath(): string` — resolves `$CONDUCTOR_HOME/device.json` (default `$HOME/.local/share/tmux-conductor/device.json`); use `process.env.CONDUCTOR_HOME` with a fallback.
  - `readCredentials(): DeviceCredentials | null` — reads and JSON-parses the file; returns `null` if the file doesn't exist or is malformed (log a warning in the latter case; do not throw).
  - `writeCredentials(creds: DeviceCredentials): void` — validates all three fields are non-empty strings; writes JSON (2-space indent) atomically: `fs.writeFileSync(tmpPath, json)`  → `fs.renameSync(tmpPath, path)`; then `fs.chmodSync(path, 0o600)`.
  - `deleteCredentials(): void` — removes the file if it exists (no-op if absent).
  - Export `ensureGitignored(gitignorePath: string): void` — reads the file, appends `device.json` on a new line if not already present (uses `fs.appendFileSync`). Call this from `writeCredentials` (pass `path.join(credentialsDir, '..', '..', '.gitignore')` or the repo root — detect via `git rev-parse --show-toplevel`).
- [x] All imports from Node builtins only (`node:fs`, `node:path`, `node:child_process` for git root).

### 3. Implement `daemon/pair.ts`  <!-- agent: general-purpose -->

- [x] Create `daemon/pair.ts` exporting `async function pairDevice(opts: { portalUrl?: string; code?: string }): Promise<void>`.
- [x] If `opts.portalUrl` is absent: prompt `Enter portal URL [https://...]: ` via readline (open `/dev/tty`); validate it starts with `https://` or `http://localhost` (warn if http on non-localhost).
- [x] If `opts.code` is absent: prompt `Enter pairing code (XXXX-XXXX): ` via readline.
- [x] Normalise the code: uppercase, strip dashes and spaces.
- [x] POST to `${portalUrl}/api/pair/redeem` with `Content-Type: application/json` body `{ code: normalised }`. Use the built-in Node `fetch` (Node ≥22 global — no axios dependency).
- [x] Handle non-200 responses: parse the body's `error` field and throw a user-friendly `Error` (e.g. `Pairing failed: invalid_or_expired_code — generate a new code from the portal.`).
- [x] On success: call `writeCredentials({ portalUrl, deviceId: resp.deviceId, token: resp.token })`.
- [x] Log: `✓ Paired device ${resp.deviceId} to ${portalUrl}. Credentials saved to ${credentialsPath()}.`

### 4. Wire `conductor pair` and `conductor unpair` into `bin/conductor`  <!-- agent: general-purpose -->

- [x] In `bin/conductor`, add a `pair)` case in the main subcommand dispatch:
  - Parse `--portal <url>` and `--code <code>` flags from `$@`.
  - Call `node --import tsx/esm daemon/pair.ts --portal "$PORTAL" --code "$CODE"` (pass flags through; the TS module handles missing values via interactive prompt).
- [x] Add an `unpair)` case:
  - Parse `--revoke` flag.
  - If `--revoke`: read credentials from `device.json` and call `DELETE <portalUrl>/api/devices/<deviceId>` with `Authorization: Bearer <token>` via curl or Node fetch (shell curl is simplest for a one-liner in the bash CLI script).
  - Delete `$CONDUCTOR_HOME/device.json` via `rm -f`.
  - Print `Unpaired. Credentials removed from $CONDUCTOR_HOME/device.json.`
- [x] Add both to the `conductor help` output.
- [x] Ensure `bash -n bin/conductor` passes after changes.

### 5. Typecheck and smoke test  <!-- agent: general-purpose -->

- [x] Run `npx tsc --noEmit` from the daemon root (or whichever tsconfig covers `daemon/`). Zero type errors.
- [x] Smoke test `conductor pair --help` / `conductor unpair --help` print their usage lines.
- [x] Smoke test `conductor unpair` with no `device.json` present — should print "Unpaired" (no error, idempotent).
- [ ] Manual smoke test (require a live portal if available; document as optional): run `conductor pair --portal http://localhost:8080 --code XXXX-XXXX`; confirm `device.json` is created at `$CONDUCTOR_HOME/device.json` with `chmod 600`; confirm `.gitignore` contains `device.json`.
- [x] Any scratch output goes under `./tmp/pair-smoke/`. Never `/tmp`.

## Acceptance Criteria

- [x] `daemon/credentials.ts` exports `readCredentials`, `writeCredentials`, `deleteCredentials`, `credentialsPath`; writes atomically with `chmod 600`; appends `device.json` to `.gitignore` idempotently on write.
- [x] `daemon/pair.ts` exports `pairDevice(opts)`: prompts for portal URL / code when not supplied, POSTs to `/api/pair/redeem`, calls `writeCredentials` on success, throws a user-friendly error on API failure.
- [x] `conductor pair` subcommand passes `--portal` and `--code` flags through to `daemon/pair.ts`, prompts interactively when flags are absent.
- [x] `conductor unpair` removes `device.json`; with `--revoke` calls `DELETE /api/devices/:id` before deletion.
- [x] `bash -n bin/conductor` and `npx tsc --noEmit` both pass cleanly.

## Dependencies

- **DEPENDS ON [TASK-031](TASK-031-portal-pairing-code-api-redeem.md)** — the `POST /api/pair/redeem` endpoint this task calls must exist. The portal must also have a `DELETE /api/devices/:deviceId` route (if `--revoke` is used — TASK-033 adds the full Devices API; `conductor unpair --revoke` should degrade gracefully if the route is absent until TASK-033 lands).

### Roadmap

Implements ROADMAP-002 Phase 3, item "daemon/pair.ts + daemon/credentials.ts; `conductor pair` / `conductor unpair` CLI" — `wiki/work/roadmaps/ROADMAP-002-hosted-portal-oauth-relay-installer.md`.
