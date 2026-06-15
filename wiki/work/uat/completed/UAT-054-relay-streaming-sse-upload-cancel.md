---
id: UAT-054
title: "UAT: Relay streaming — SSE pass-through, image-upload bodies, cancel/backpressure"
status: passed
task: TASK-054
created: 2026-06-14
updated: 2026-06-14
---

# UAT-054 — UAT: Relay streaming — SSE pass-through, image-upload bodies, cancel/backpressure

implements::[[TASK-054]]

> **Source task**: [[TASK-054]]
> **Generated**: 2026-06-14

---

## Scope & deferrals

TASK-054 fixed five app/api relay defects, all in `app/api/relay/mux.ts` and `app/api/index.ts`:

1. **Idle-based timeout** — the unconditional 30s `REQUEST_TIMEOUT_MS` was replaced with an inactivity timer rearmed on `onHead` and every `onChunk`, so long-lived SSE streams are no longer reaped while data flows.
2. **Raw-body parser** — `app/api/index.ts` now registers `addContentTypeParser('application/octet-stream', { parseAs: 'buffer' })` (mirroring host-server); previously `req.body` was `undefined` for relayed binary uploads so the body was silently dropped.
3. **Cancel on client disconnect** — `req.raw.on('close')` now emits a `relay:cancel` frame (guarded by a `finalized` flag) so a browser disconnect aborts the upstream request.
4. **Portal→browser backpressure** — a bounded write-queue honours `reply.raw.write()`'s return value and resumes on `'drain'`.
5. **SSE edge headers** — `Cache-Control: no-cache` and `X-Accel-Buffering: no` are injected onto `text/event-stream` response heads.

**These tests exercise the fixes through the LOCAL relay chain only:**

```
curl  →  app/api :8090 (relay)  →  outbound WSS  →  daemon connector  →  host-server :8788
```

> **DO-edge validation is DEFERRED** to the live DigitalOcean App Platform deploy (held-back TASK-050). The App Platform proxy-buffering check called for in the task objective cannot run until `app/api` is live behind the public edge. Every test here uses `app/api` on **port 8090** (8080 is occupied on this machine).

Host-server endpoints under test: `GET /api/events` (SSE) and `POST /api/agents/:id/upload` (raw octet-stream body; note the route param is the numeric **agent id**, not the agent name).

---

## Prerequisites

- [ ] **host-server is running on :8788** and `GET http://127.0.0.1:8788/api/status` returns 200 JSON. (`make dev` or run host-server natively.)
- [ ] **app/api is running on :8090** under `tsx watch` with the TASK-054 changes loaded. Bring it up with `DATABASE_URL` and `API_PORT=8090` sourced from the root `.env` (`set -a; . ./.env; set +a`). Never read `.env` with a file tool — source it inline.
- [ ] **A paired test device exists** and the standalone connector is running, isolated under `CONDUCTOR_HOME=./tmp/relay-streaming/conductor-home`. Reuse the TASK-053 harness pattern (`tmp/relay-e2e/README.md`): seed a `devices` row, write `device.json` pointing `portalUrl` at `http://localhost:8090`, then launch `npx tsx tmp/relay-e2e/run-connector.ts` and wait for `[relay] connected` in its log. Set the shell var the tests use:
  ```bash
  export DEVICE_ID="$(cat tmp/relay-streaming/device-id.txt)"
  ```
- [ ] **At least one agent row exists** in the conductor SQLite DB so the upload test has a real id. Capture it:
  ```bash
  export AGENT_ID="$(curl -sS 'http://127.0.0.1:8788/api/agents' | jq -r '.[0].id')"
  ```
- [ ] All scratch/captures go under `./tmp/relay-streaming/` — never `/tmp`.

---

## Test Cases

### UAT-API-001: SSE head flushes immediately with edge anti-buffering headers
- **Endpoint**: `GET /relay/:deviceId/api/events`
- **Description**: Confirms the relay flushes `relay:response:head` immediately for an SSE stream and injects `Cache-Control: no-cache` + `X-Accel-Buffering: no` onto the `text/event-stream` head (fix #5). The `: connected` preamble and the initial state snapshot must arrive within the first second — not batched at stream end — proving the head is not buffered.
- **Steps**:
  1. Ensure the connector is connected and `$DEVICE_ID` is set.
  2. Run the curl below. `--max-time 5` ends the otherwise-infinite SSE stream after 5s; headers are dumped to stderr via `-D -`.
  3. Inspect the dumped headers and the first body lines (record into `./tmp/relay-streaming/sse-headers.txt`).
- **Command**:
  ```bash
  curl -sS -N -D - --max-time 5 "http://localhost:8090/relay/$DEVICE_ID/api/events"
  ```
- **Expected Result**: Status `200`. Response headers include `content-type: text/event-stream`, `cache-control: no-cache`, and `x-accel-buffering: no`. The body begins with `: connected` followed by `event: session-update` / `event: agent-update` SSE frames that appear immediately (well before the 5s cutoff), confirming the head was flushed and not buffered.
- [x] Pass <!-- 2026-06-14 -->
  - HTTP/1.1 200; headers `content-type: text/event-stream`, `cache-control: no-cache`, `X-Accel-Buffering: no` all present. Body opened with `: connected` then `event: session-update`/`event: agent-update` frames; 87KB streamed within the 5s window (not batched at end).

### UAT-EDGE-001: Long-lived SSE stream survives past the old 30s timeout
- **Scenario**: Idle-based timeout (fix #1). Before the fix, the unconditional 30s `REQUEST_TIMEOUT_MS` sent `relay:cancel` and closed every relayed request at 30s — killing SSE. The timer is now rearmed on head + each chunk, and the host-server SSE route emits a `: ping` heartbeat every 15s, so the stream must stay open well past 30s.
- **Steps**:
  1. Open the relayed SSE stream for 40s (longer than the old 30s reap) and capture the timeline into `./tmp/relay-streaming/sse-longlived.txt`.
  2. Confirm the stream is still alive at 40s and that at least two `: ping` heartbeats (one ~15s, one ~30s) were received — i.e. the connection was NOT torn down at 30s.
- **Command**:
  ```bash
  curl -sS -N --max-time 40 "http://localhost:8090/relay/$DEVICE_ID/api/events"
  ```
- **Expected Result**: The stream stays open for the full 40s and is terminated only by curl's `--max-time` (exit code 28), not by a server close near 30s. At least two `: ping` lines appear (~15s and ~30s). No `relay:cancel`-driven close occurs before 40s. (Contrast: pre-fix, the connection closes at ~30s.)
- [x] Pass <!-- 2026-06-14 -->
  - Stream stayed open the full 40s; terminated by curl `--max-time` (exit code 28, time_total 40.001s), not a server close at ~30s. Exactly 2 `: ping` heartbeats received (~15s, ~30s); 1.22MB received, no early `relay:cancel`.

### UAT-API-002: Relayed image upload body reaches host-server and the file lands
- **Endpoint**: `POST /relay/:deviceId/api/agents/:id/upload?type=image/png&filename=uat054&paneInsert=false`
- **Description**: Confirms the octet-stream raw-body parser (fix #2) lets a relayed binary request body flow app/api → connector → host-server, where the host-server reconstructs and saves the file. `paneInsert=false` skips the tmux `send-keys` step so the test does not require a live agent window — it isolates the body-forwarding + file-landing behaviour. Expected save dir: host-server's `tmp/dashboard-drops/`.
- **Steps**:
  1. Ensure `$DEVICE_ID` and `$AGENT_ID` are set.
  2. Create a small valid PNG to upload (1x1 PNG):
     ```bash
     printf '\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n\x2d\xb4\x00\x00\x00\x00IEND\xaeB\x60\x82' > tmp/relay-streaming/dot.png
     ```
  3. Run the upload curl and record the JSON response into `./tmp/relay-streaming/upload.txt`.
  4. Confirm the returned `path` exists on disk.
- **Command**:
  ```bash
  curl -sS -X POST "http://localhost:8090/relay/$DEVICE_ID/api/agents/$AGENT_ID/upload?type=image/png&filename=uat054&paneInsert=false" -H 'Content-Type: application/octet-stream' --data-binary '@tmp/relay-streaming/dot.png'
  ```
- **Expected Result**: Status `200`, body `{ "ok": true, "path": "<repo>/tmp/dashboard-drops/<timestamp>-uat054.png" }`. The file at `path` exists and its bytes match the uploaded PNG (non-empty). This proves the request body was NOT dropped (the pre-fix behaviour).
- [x] Pass <!-- 2026-06-14 -->
  - Re-run after relay POST fix (mux.ts now listens on `reply.raw.on('close')` with a `writableFinished` guard). Relayed POST returned HTTP 200 `{"ok":true,"path":"/Users/davidtaylor/Repositories/tmux-conductor/tmp/dashboard-drops/1781485389726-uat054.png"}`; the file landed on disk (67 bytes, non-empty). Body forwarded app/api → connector → host-server and the file was reconstructed — the pre-fix empty-200 regression is resolved.

### UAT-EDGE-002: Upload with no body still reaches host-server validation (not silently dropped)
- **Scenario**: Negative control for fix #2. With a declared `application/octet-stream` content-type but an empty body, the parser produces a zero-length Buffer that reaches the host-server, which rejects it with its own 400. The point is that app/api forwards the request and the host-server's body validation runs — versus the pre-fix path where the body was `undefined` regardless.
- **Steps**:
  1. POST to the relayed upload endpoint with `--data-binary ''` (empty body) and `type=image/png`.
  2. Record the response into `./tmp/relay-streaming/upload-empty.txt`.
- **Command**:
  ```bash
  curl -sS -X POST "http://localhost:8090/relay/$DEVICE_ID/api/agents/$AGENT_ID/upload?type=image/png&paneInsert=false" -H 'Content-Type: application/octet-stream' --data-binary ''
  ```
- **Expected Result**: Status `400` with the host-server's body-validation error `{ "error": "request body must be the raw image bytes (application/octet-stream)" }` — confirming the request reached the host-server upload handler (it was forwarded, not dropped at app/api).
- [x] Pass <!-- 2026-06-14 -->
  - Re-run after relay POST fix. Relayed empty-body POST returned HTTP 400 with the host-server's exact validation error `{"error":"request body must be the raw image bytes (application/octet-stream)"}` — proving the request was forwarded to the host-server upload handler and its body validation ran (versus the pre-fix empty-200). The POST is no longer aborted at app/api.

### UAT-EDGE-003: Closing the client mid-SSE delivers relay:cancel to the daemon
- **Scenario**: Cancel on client disconnect (fix #3). Opening a relayed SSE stream and killing the client mid-stream must trigger `req.raw.on('close')` in mux.ts, which sends a `relay:cancel` frame; the connector aborts the matching upstream fetch via `AbortController`, leaving no lingering host-server request.
- **Steps**:
  1. Truncate the connector log first so the new cancel is unambiguous:
     ```bash
     : > tmp/relay-streaming/connector.log
     ```
     (the connector must be running with stdout/stderr redirected to this log).
  2. Open the relayed SSE stream and force a hard client close after ~3s (long enough for head + a chunk, short enough to be mid-stream). The single command below opens, waits, then kills curl:
  3. After the client dies, inspect `./tmp/relay-streaming/connector.log` for the abort signal and confirm no orphaned request remains.
- **Command**:
  ```bash
  curl -sS -N --max-time 3 "http://localhost:8090/relay/$DEVICE_ID/api/events" -o tmp/relay-streaming/cancel-stream.txt
  ```
- **Expected Result**: After curl exits (client gone), the connector aborts the upstream request: `tmp/relay-streaming/connector.log` shows the in-flight entry being aborted for the stream's correlationId (the connector's `handleCancel` runs `controller.abort()`), and no host-server `/api/events` request is left running. The mux deregisters the in-flight entry (no `relay:timeout` 504, no double-cancel). Capture the relevant log lines into `./tmp/relay-streaming/cancel.txt`.
- [FAIL: auto-judge: not machine-verifiable — the standalone connector emits no log line on handleCancel/controller.abort(), and the host-server exposes no in-flight-request introspection, so the "connector aborts upstream / no orphaned request" assertion cannot be confirmed from deterministic evidence. Re-run client-side close fired correctly (relayed GET SSE, curl exit 28 at 3s, 40931 bytes received mid-stream) and the mux `reply.raw.on('close')` sends relay:cancel for a genuine mid-stream disconnect, but the abort effect remains unobservable here. Observational/not-fully-machine-verifiable per the task brief — does NOT block completion. Requires /uat-walk with connector instrumentation or host-server in-flight visibility.] <!-- 2026-06-14 -->

### UAT-EDGE-004: Large streamed response stays memory-bounded (backpressure)
- **Scenario**: Backpressure (fix #4 portal-side write-queue + fix already present daemon-side `ws.bufferedAmount` pause/resume). A large streamed response must not cause unbounded memory growth in `app/api`: `onChunk` enqueues buffers and the flusher pauses when `reply.raw.write()` returns `false`, resuming on `'drain'`; the connector throttles its upstream read while `ws.bufferedAmount > 1 MiB`.
- **Steps**:
  1. Note this is an observational test (no hard byte threshold the relay exposes). Pick the largest streamed host-server response available through the relay (e.g. an `/api/agents/:id/tail` SSE stream, or a long-running `/api/events` stream under activity). Record the host-server response chosen into `./tmp/relay-streaming/backpressure.txt`.
  2. Start `app/api` with a sampler on RSS before streaming, then consume the relayed large/long stream slowly (a slow reader provokes backpressure). One way: pipe through a rate-limited reader.
  3. Sample `app/api` process RSS during the stream (e.g. `ps -o rss= -p <app/api pid>` a few times) and record the series.
  4. Confirm RSS stays bounded (does not grow roughly linearly with bytes streamed) — the write-queue + drain and the daemon `bufferedAmount` watermark hold memory flat.
- **Command**:
  ```bash
  curl -sS -N --limit-rate 8k --max-time 20 "http://localhost:8090/relay/$DEVICE_ID/api/events" -o tmp/relay-streaming/backpressure-stream.txt
  ```
- **Expected Result**: While the slow reader (`--limit-rate 8k`) consumes the relayed stream, `app/api` RSS stays bounded (no continuous linear growth) and the stream keeps flowing without app/api OOM or unbounded buffer accumulation. The connector log shows no runaway buffering. Record the RSS samples and the conclusion in `./tmp/relay-streaming/backpressure.txt`.
- [FAIL: auto-judge: observational test requires human verification — no hard byte/RSS threshold the relay exposes; conclusion depends on interpreting an RSS sample series during a slow-reader stream. Per the task brief UAT-EDGE-004 is explicitly observational and does NOT block completion. Use /uat-walk.] <!-- 2026-06-14 -->

---

## Deferred (DO App Platform edge — TASK-050)

The following acceptance items from TASK-054 cannot be validated until `app/api` is live behind the public DigitalOcean App Platform edge (held-back TASK-050). They are explicitly **out of scope** for this local UAT and must be re-run post-deploy:

- SSE events arrive in real time **through the DO App Platform proxy** (the proxy may buffer chunked/streamed responses; the `Cache-Control: no-cache` + `X-Accel-Buffering: no` headers added in fix #5 are intended to defeat that buffering — only the public edge can confirm it).
- End-to-end streaming, upload, cancel, and backpressure behaviour **through the public edge URL** rather than `localhost:8090`.
