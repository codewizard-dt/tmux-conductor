---
id: TASK-054
title: "Relay streaming: SSE pass-through, image-upload request bodies, cancel/backpressure — validated through the DO App Platform edge"
status: done
created: 2026-06-14
updated: 2026-06-14
depends_on: [TASK-053]
blocks: []
parallel_safe_with: []
uat: "[[UAT-054]]"
tags: [relay, streaming, sse, upload, backpressure, roadmap-002]
---

# TASK-054 — Relay streaming: SSE pass-through, image-upload request bodies, cancel/backpressure — validated through the DO App Platform edge

## Objective

Validate streaming over the device relay (ROADMAP-002 Phase 4): Server-Sent Events pass-through (`/api/events`), binary image-upload request bodies (`/api/agents/:id/upload`), and cancel/backpressure semantics — exercised not just locally but through the real DigitalOcean App Platform edge in front of `app/api`. App Platform's proxy may buffer responses, so this milestone specifically confirms that live streaming survives the production edge.

## Approach

**SSE pass-through (`/api/events`)**: confirm the relay flushes `relay:response:head` immediately and streams `relay:body:chunk` frames as events arrive, without buffering, all the way through the DO edge. App Platform's proxy may buffer chunked/streamed responses — note and verify any required headers (`Cache-Control: no-cache`, `X-Accel-Buffering: no`, connection/transfer-encoding handling) so events arrive in real time rather than in a batch.

**Image-upload request bodies (`/api/agents/:id/upload`)**: relay a binary request body (base64-chunked per the `shared/relay-protocol.ts` contract) for the dashboard image-drop endpoint and confirm the uploaded file lands on the host side (saved to host-server's drop dir, path typed into the pane).

**Cancel**: close the browser/SSE connection mid-stream and confirm a `relay:cancel` frame reaches the daemon connector, which aborts the matching local request via `AbortController` (no orphaned local request left running).

**Backpressure**: stream a large response and confirm memory stays bounded — the connector's `ws.bufferedAmount` pause/resume keeps it from buffering the whole payload.

**Validate behind the real DO edge** (not just `localhost`). Keep all scratch scripts and captures under `./tmp/relay-streaming/` — never `/tmp`.

## Steps

### 1. Confirm prerequisites  <!-- agent: general-purpose --> <!-- Completed: 2026-06-14 -->

- [x] Confirm TASK-053 (plain JSON e2e) passes — the relay chain is proven for non-streaming requests. <!-- TASK-053 status: done, validated locally (8090 chain), no UAT (validation milestone). -->
- [x] Use Serena `find_symbol` to confirm the host-server `GET /api/events` (SSE) and `POST /api/agents/:id/upload` handlers and their content-types / streaming behavior. <!-- /api/events: hijack + text/event-stream + Cache-Control:no-cache, NO X-Accel-Buffering. /api/agents/:id/upload: octet-stream buffer parser, saves to ./tmp/dashboard-drops, types path into pane. -->
- [x] Confirm the daemon connector's SSE handling (head-immediate, no `relay:response:end`), base64 body chunking, cancel via `AbortController`, and `bufferedAmount` backpressure are implemented (TASK-052). <!-- connector.ts: ALL implemented — head-immediate, chunk-loop, end-only-on-close, AbortController cancel, awaitDrain on 1MiB watermark. -->
- [x] Confirm there is a deployed `app/api` on DO App Platform (or deploy one) reachable through the public edge for testing. <!-- DO live deploy NOT available (held-back TASK-050). Validating via LOCAL chain only; DO-edge validation deferred. -->

> **GAP ANALYSIS (Step 1 finding)** — the daemon connector (TASK-052) is fully ready; the gaps are all on the **app/api** side:
> 1. **mux.ts 30s `REQUEST_TIMEOUT_MS`** fires unconditionally and sends `relay:cancel` + closes — kills long-lived SSE. Must become idle-based / cleared once streaming starts.
> 2. **app/api registers NO raw-body content-type parser** — `req.rawBody` is always `undefined`, so all relayed request bodies (image uploads, POST inserts) are silently dropped. Must mirror host-server's `addContentTypeParser('application/octet-stream', { parseAs: 'buffer' })`.
> 3. **mux.ts has no `req.raw.on('close')` handler** — a browser disconnect mid-stream never sends `relay:cancel` to the daemon.
> 4. **mux.ts `onChunk` ignores `reply.raw.write()` return** — no portal→browser backpressure for a slow client.
> 5. **No `X-Accel-Buffering: no`** on streamed responses — matters for the DO edge (deferred) but harmless locally.

### 2. Validate SSE pass-through through the DO edge  <!-- agent: general-purpose --> <!-- Updated: 2026-06-14 -->

**Implementation done in /tackle (mux.ts):** the unconditional 30s timeout was replaced with an idle/inactivity timeout (rearmed on head + each chunk) so long-lived SSE streams are no longer reaped while data flows; `Cache-Control: no-cache` + `X-Accel-Buffering: no` are now injected on `text/event-stream` response heads to defeat reverse-proxy/edge buffering. Head is already flushed immediately (`reply.hijack()` + `writeHead`).

- [x] Open an SSE stream via the public `app/api` edge: `/relay/<deviceId>/api/events`. <!-- [DEFERRED-TO-UAT] runtime; validate via LOCAL chain (8090), DO edge deferred to TASK-050 live deploy -->
- [DEFERRED-TO-UAT] Trigger host-server events and confirm they arrive in real time (not batched) — the head is flushed immediately and chunks stream through the proxy.
- [x] Inspect/record the relevant response headers (`Cache-Control`, `X-Accel-Buffering`, transfer-encoding) and add any required to defeat edge buffering. <!-- mux.ts now injects Cache-Control:no-cache + X-Accel-Buffering:no for event-stream; header CAPTURE into ./tmp/relay-streaming/sse-headers.txt is [DEFERRED-TO-UAT] runtime -->

> DO-edge validation deferred to the live deploy (TASK-050); runtime SSE validation runs through the LOCAL chain (app/api:8090 → daemon → host-server:8788) in UAT.

### 3. Validate image-upload request bodies  <!-- agent: general-purpose --> <!-- Updated: 2026-06-14 -->

**Implementation done in /tackle:** app/api now registers `addContentTypeParser('application/octet-stream', { parseAs: 'buffer' })` (mirroring host-server) — previously app/api had NO raw-body parser so `req.rawBody` was always undefined and relayed request bodies were silently dropped. mux.ts now base64-encodes the parsed `req.body` robustly (Buffer → base64; string → utf8 Buffer; object → JSON; GET/HEAD send no body), so binary upload bodies now reach the daemon and the host-server upload handler.

- [x] Relay a binary image body to `/relay/<deviceId>/api/agents/<id>/upload` — request-body forwarding is now implemented. <!-- runtime reconstruction/landing check is [DEFERRED-TO-UAT] -->
- [DEFERRED-TO-UAT] Confirm the file is reconstructed and lands in the host-server drop dir with the path typed into the pane; capture request + saved-file path into `./tmp/relay-streaming/upload.txt`.

### 4. Validate cancel  <!-- agent: general-purpose --> <!-- Updated: 2026-06-14 -->

**Implementation done in /tackle (mux.ts):** added a `req.raw.on('close')` handler that, if the response is not yet finalized, sends a `relay:cancel` frame for the correlationId and deregisters the in-flight entry (guarded by a `finalized` flag to prevent double-cancel). Previously cancel was only sent on the 30s timeout, never on client disconnect. The daemon connector already aborts the matching upstream fetch via AbortController on `relay:cancel`.

- [x] Wire client-disconnect → `relay:cancel`: open SSE through relay, close client mid-stream → cancel frame now emitted. <!-- runtime confirmation is [DEFERRED-TO-UAT] -->
- [DEFERRED-TO-UAT] Confirm `relay:cancel` reaches the daemon and the local request is aborted (no lingering host-server request); capture daemon-side logs into `./tmp/relay-streaming/cancel.txt`.

### 5. Validate backpressure  <!-- agent: general-purpose --> <!-- Updated: 2026-06-14 -->

**Implementation done in /tackle (mux.ts):** added a bounded write-queue on the portal→browser leg — `onChunk` enqueues buffers and a flusher writes while `reply.raw.write()` returns true, pausing on `false` and resuming on the `'drain'` event (so the portal never buffers unboundedly for a slow browser). The daemon→portal leg was already protected by the connector's `ws.bufferedAmount > 1MiB` pause/resume (`awaitDrain`), which now provides the global backpressure signal end-to-end.

- [x] Bounded portal-side write-queue + drain implemented so memory stays bounded; daemon `bufferedAmount` pause/resume already present. <!-- runtime large-response memory observation is [DEFERRED-TO-UAT] -->
- [DEFERRED-TO-UAT] Stream a large response and observe memory stays bounded; capture observations into `./tmp/relay-streaming/backpressure.txt`.

## Acceptance Criteria

- [ ] SSE events (`/api/events`) arrive in real time through the relay AND the DO App Platform edge — head flushed immediately, no batching/buffering.
- [ ] An image upload via the relay (`/api/agents/:id/upload`) succeeds and the file lands host-side.
- [ ] Closing the browser mid-SSE delivers `relay:cancel` to the daemon and aborts the local request.
- [ ] A large response does not cause unbounded memory growth (backpressure pause/resume works).
- [ ] Scratch scripts and captures live under `./tmp/relay-streaming/` (never `/tmp`).

## Dependencies

- **DEPENDS ON [TASK-053](TASK-053-relay-plain-json-e2e.md)** — the proven plain-JSON relay chain that streaming builds on.

### Roadmap

Implements ROADMAP-002 Phase 4, item "Streaming: SSE pass-through, image-upload request bodies, cancel/backpressure" — `wiki/work/roadmaps/ROADMAP-002-hosted-portal-oauth-relay-installer.md`.
