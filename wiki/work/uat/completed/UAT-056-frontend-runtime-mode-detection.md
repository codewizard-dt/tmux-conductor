---
id: UAT-056
title: "UAT: Frontend runtime mode detection (local-direct vs relay) + API_BASE rewire"
status: passed
task: TASK-056
created: 2026-06-14
updated: 2026-06-14
---

# UAT-056 — UAT: Frontend runtime mode detection (local-direct vs relay) + API_BASE rewire

implements::[[TASK-056]]

> **Source task**: [[TASK-056]]
> **Generated**: 2026-06-14

---

## Scope & approach

TASK-056 added `app/frontend/src/lib/runtime.ts` (pure runtime logic) and wired it into `App.tsx`. The unit under test is module-level logic with three external dependencies: `fetch` (probe), `localStorage` (device persistence), and the `./api` seam (`setRelayConfig` / `getApiBase` / `API_BASE`). There is no HTTP endpoint introduced by this task, so the bulk of verification is **pure-logic tsx harnesses** that mock those dependencies, plus **build/typecheck gates**.

Note on `import.meta.env`: `runtime.ts` and `api.ts` guard `import.meta.env` (`(import.meta as ViteEnv).env ?? {}`), so importing them under `tsx` is safe — under `tsx`, `import.meta.env` is absent, so `viteEnv` is `{}` (no `VITE_API_MODE` / `VITE_DEVICE_ID` override; the probe path is exercised). The `VITE_API_MODE` override path — which is a build-time env read — is verified by a Vite production build with the env var set (UAT-BUILD-002) rather than at tsx runtime.

All harnesses are written under `./tmp/uat-056/` (repo-local scratch, gitignored). Each harness exits non-zero on any failed assertion so `/uat-auto` can judge from the exit code.

---

## Prerequisites

- [ ] `app/frontend` dependencies installed: `cd app/frontend && npm ci` (or `npm install`) has been run
- [ ] `tsx` is runnable via `npx tsx` from the repo root (it is a transitive/dev dependency; `npx tsx --version` succeeds)
- [ ] Scratch directory exists: `mkdir -p ./tmp/uat-056` (harness commands below create their own files there)
- [ ] No conductor / host-server needs to be running — these tests mock all I/O

---

## Test Cases

### UAT-LOGIC-001: Probe reachable → mode resolves to 'direct' and seam goes direct

- **Description**: When `VITE_API_MODE` is unset (tsx default) and the `/api/healthz` probe returns an OK response, `initRuntimeMode()` resolves `'direct'`, `getResolvedMode()` returns `'direct'`, and the api seam (`getApiBase()`) returns the direct base `'/api'` (no relay prefix).
- **Steps**:
  1. Create the harness file shown below (mocks global `fetch` to resolve `{ ok: true }` and stubs `localStorage`).
  2. Run the command. It imports the real `runtime.ts` + `api.ts` and asserts the resolved mode and base.
- **Command**:
  ```bash
  cd /Users/davidtaylor/Repositories/tmux-conductor/app/frontend && cat > ../../tmp/uat-056/probe-direct.ts <<'EOF'
const store = new Map<string, string>()
;(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v) },
  removeItem: (k: string) => { store.delete(k) },
}
let probedUrl = ''
;(globalThis as any).fetch = async (url: string) => {
  probedUrl = url
  return { ok: true } as Response
}
const { initRuntimeMode, getResolvedMode } = await import('./src/lib/runtime.ts')
const { getApiBase } = await import('./src/lib/api.ts')
const mode = await initRuntimeMode()
const assert = (c: boolean, m: string) => { if (!c) { console.error('FAIL:', m); process.exit(1) } }
assert(mode === 'direct', `mode should be 'direct', got '${mode}'`)
assert(getResolvedMode() === 'direct', `getResolvedMode should be 'direct', got '${getResolvedMode()}'`)
assert(getApiBase() === '/api', `getApiBase should be '/api', got '${getApiBase()}'`)
assert(probedUrl === '/api/healthz', `probe URL should be '/api/healthz', got '${probedUrl}'`)
console.log('PASS: probe-reachable → direct, base=/api')
EOF
  npx tsx ../../tmp/uat-056/probe-direct.ts
  ```
- **Expected Result**: Exit code 0; final line `PASS: probe-reachable → direct, base=/api`. No `FAIL:` lines.
- [x] Pass <!-- 2026-06-14 -->

---

### UAT-LOGIC-002: Probe unreachable → mode resolves to 'relay'

- **Description**: When the `/api/healthz` probe rejects (network error / host-server down), `initRuntimeMode()` resolves `'relay'`. With no selected device, the relay seam falls back to the direct base (no deviceId), which is the documented `getApiBase()` behavior; the resolved **mode** is the assertion of record here.
- **Steps**:
  1. Create the harness (mocks `fetch` to **reject**).
  2. Run it.
- **Command**:
  ```bash
  cd /Users/davidtaylor/Repositories/tmux-conductor/app/frontend && cat > ../../tmp/uat-056/probe-relay.ts <<'EOF'
const store = new Map<string, string>()
;(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v) },
  removeItem: (k: string) => { store.delete(k) },
}
;(globalThis as any).fetch = async () => { throw new Error('ECONNREFUSED') }
const { initRuntimeMode, getResolvedMode } = await import('./src/lib/runtime.ts')
const mode = await initRuntimeMode()
const assert = (c: boolean, m: string) => { if (!c) { console.error('FAIL:', m); process.exit(1) } }
assert(mode === 'relay', `mode should be 'relay' on unreachable probe, got '${mode}'`)
assert(getResolvedMode() === 'relay', `getResolvedMode should be 'relay', got '${getResolvedMode()}'`)
console.log('PASS: probe-unreachable → relay')
EOF
  npx tsx ../../tmp/uat-056/probe-relay.ts
  ```
- **Expected Result**: Exit code 0; final line `PASS: probe-unreachable → relay`.
- [x] Pass <!-- 2026-06-14 -->

---

### UAT-LOGIC-003: Probe non-OK response (404/500) → mode resolves to 'relay'

- **Description**: `probeDirect()` returns `res.ok`. A reachable proxy that answers a non-2xx (e.g. proxy up but host-server returns 502, or the proxy 404s `/api/healthz`) must be treated as **not** local-direct, so the mode is `'relay'`.
- **Steps**:
  1. Create the harness (mocks `fetch` to resolve `{ ok: false, status: 502 }`).
  2. Run it.
- **Command**:
  ```bash
  cd /Users/davidtaylor/Repositories/tmux-conductor/app/frontend && cat > ../../tmp/uat-056/probe-notok.ts <<'EOF'
const store = new Map<string, string>()
;(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v) },
  removeItem: (k: string) => { store.delete(k) },
}
;(globalThis as any).fetch = async () => ({ ok: false, status: 502 } as Response)
const { initRuntimeMode } = await import('./src/lib/runtime.ts')
const mode = await initRuntimeMode()
const assert = (c: boolean, m: string) => { if (!c) { console.error('FAIL:', m); process.exit(1) } }
assert(mode === 'relay', `non-OK probe should resolve 'relay', got '${mode}'`)
console.log('PASS: probe-non-OK → relay')
EOF
  npx tsx ../../tmp/uat-056/probe-notok.ts
  ```
- **Expected Result**: Exit code 0; final line `PASS: probe-non-OK → relay`.
- [x] Pass <!-- 2026-06-14 -->

---

### UAT-LOGIC-004: Probe times out (>3s) → aborts and resolves 'relay'

- **Description**: `probeDirect()` arms a 3s `AbortController`. A hung host-server (fetch that never settles) must be aborted and treated as unreachable → `'relay'`. The harness mocks `fetch` to reject when its `AbortSignal` fires, proving the abort path resolves to relay (and within a bounded time).
- **Steps**:
  1. Create the harness (mock `fetch` returns a promise that rejects on `signal` abort and never resolves otherwise).
  2. Run it; the run should complete in ~3s, not hang.
- **Command**:
  ```bash
  cd /Users/davidtaylor/Repositories/tmux-conductor/app/frontend && cat > ../../tmp/uat-056/probe-timeout.ts <<'EOF'
const store = new Map<string, string>()
;(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v) },
  removeItem: (k: string) => { store.delete(k) },
}
;(globalThis as any).fetch = (_url: string, init?: { signal?: AbortSignal }) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new Error('AbortError')))
  })
const { initRuntimeMode } = await import('./src/lib/runtime.ts')
const started = Date.now()
const mode = await initRuntimeMode()
const elapsed = Date.now() - started
const assert = (c: boolean, m: string) => { if (!c) { console.error('FAIL:', m); process.exit(1) } }
assert(mode === 'relay', `timeout should resolve 'relay', got '${mode}'`)
assert(elapsed >= 2900 && elapsed < 6000, `abort should fire near 3s, elapsed=${elapsed}ms`)
console.log('PASS: probe-timeout → relay (elapsed ' + elapsed + 'ms)')
EOF
  npx tsx ../../tmp/uat-056/probe-timeout.ts
  ```
- **Expected Result**: Exit code 0; final line `PASS: probe-timeout → relay (elapsed ~3000ms)`. Run does not hang.
- [x] Pass <!-- 2026-06-14 -->

---

### UAT-LOGIC-005: `initRuntimeMode()` is idempotent (memoized) — probe runs once

- **Description**: `resolvedMode` is cached after the first resolution; a second `initRuntimeMode()` call must return the cached value **without** re-probing.
- **Steps**:
  1. Create the harness; count `fetch` invocations.
  2. Call `initRuntimeMode()` twice and assert one probe.
- **Command**:
  ```bash
  cd /Users/davidtaylor/Repositories/tmux-conductor/app/frontend && cat > ../../tmp/uat-056/idempotent.ts <<'EOF'
const store = new Map<string, string>()
;(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v) },
  removeItem: (k: string) => { store.delete(k) },
}
let calls = 0
;(globalThis as any).fetch = async () => { calls++; return { ok: true } as Response }
const { initRuntimeMode } = await import('./src/lib/runtime.ts')
const m1 = await initRuntimeMode()
const m2 = await initRuntimeMode()
const assert = (c: boolean, m: string) => { if (!c) { console.error('FAIL:', m); process.exit(1) } }
assert(m1 === m2 && m1 === 'direct', `both calls should return 'direct', got '${m1}'/'${m2}'`)
assert(calls === 1, `probe should run exactly once, ran ${calls} times`)
console.log('PASS: idempotent — probe ran once')
EOF
  npx tsx ../../tmp/uat-056/idempotent.ts
  ```
- **Expected Result**: Exit code 0; final line `PASS: idempotent — probe ran once`.
- [x] Pass <!-- 2026-06-14 -->

---

### UAT-LOGIC-006: Device selection persists to localStorage under the documented key

- **Description**: `setSelectedDeviceId('dev-abc')` writes the value to `localStorage` key `tmux-conductor:selected-device`, and `getSelectedDeviceId()` reads it back. Passing `null` removes the key.
- **Steps**:
  1. Create the harness (probe reachable so mode is `direct`; device store stubbed).
  2. Set, read, clear, re-read.
- **Command**:
  ```bash
  cd /Users/davidtaylor/Repositories/tmux-conductor/app/frontend && cat > ../../tmp/uat-056/device-persist.ts <<'EOF'
const store = new Map<string, string>()
;(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v) },
  removeItem: (k: string) => { store.delete(k) },
}
;(globalThis as any).fetch = async () => ({ ok: true } as Response)
const rt = await import('./src/lib/runtime.ts')
const assert = (c: boolean, m: string) => { if (!c) { console.error('FAIL:', m); process.exit(1) } }
rt.setSelectedDeviceId('dev-abc')
assert(store.get('tmux-conductor:selected-device') === 'dev-abc', `key not written, store=${JSON.stringify([...store])}`)
assert(rt.getSelectedDeviceId() === 'dev-abc', `getSelectedDeviceId should read 'dev-abc', got '${rt.getSelectedDeviceId()}'`)
rt.setSelectedDeviceId(null)
assert(store.has('tmux-conductor:selected-device') === false, 'null should remove the key')
assert(rt.getSelectedDeviceId() === null, 'getSelectedDeviceId should be null after clear')
console.log('PASS: device persists/clears under tmux-conductor:selected-device')
EOF
  npx tsx ../../tmp/uat-056/device-persist.ts
  ```
- **Expected Result**: Exit code 0; final line `PASS: device persists/clears under tmux-conductor:selected-device`.
- [x] Pass <!-- 2026-06-14 -->

---

### UAT-LOGIC-007: Persisted device is restored on init in relay mode and repoints the base

- **Description**: When `localStorage` already holds a selected device (simulating a prior session) **and** the probe is unreachable (relay), `initRuntimeMode()` reads the persisted id and calls `setRelayConfig({ mode:'relay', deviceId })`, so `getApiBase()` returns `/relay/<deviceId>/api`.
- **Steps**:
  1. Pre-seed the store with `tmux-conductor:selected-device = dev-restored` before importing the module.
  2. Mock `fetch` to reject (relay), init, assert the base.
- **Command**:
  ```bash
  cd /Users/davidtaylor/Repositories/tmux-conductor/app/frontend && cat > ../../tmp/uat-056/device-restore.ts <<'EOF'
const store = new Map<string, string>([['tmux-conductor:selected-device', 'dev-restored']])
;(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v) },
  removeItem: (k: string) => { store.delete(k) },
}
;(globalThis as any).fetch = async () => { throw new Error('down') }
const { initRuntimeMode } = await import('./src/lib/runtime.ts')
const { getApiBase } = await import('./src/lib/api.ts')
const mode = await initRuntimeMode()
const assert = (c: boolean, m: string) => { if (!c) { console.error('FAIL:', m); process.exit(1) } }
assert(mode === 'relay', `mode should be 'relay', got '${mode}'`)
assert(getApiBase() === '/relay/dev-restored/api', `base should be '/relay/dev-restored/api', got '${getApiBase()}'`)
console.log('PASS: persisted device restored → base=/relay/dev-restored/api')
EOF
  npx tsx ../../tmp/uat-056/device-restore.ts
  ```
- **Expected Result**: Exit code 0; final line `PASS: persisted device restored → base=/relay/dev-restored/api`.
- [x] Pass <!-- 2026-06-14 -->

---

### UAT-LOGIC-008: Switching the selected device in relay mode repoints conductor calls

- **Description**: After resolving relay mode with `dev-1`, calling `setSelectedDeviceId('dev-2')` must re-apply the relay config so `getApiBase()` flips from `/relay/dev-1/api` to `/relay/dev-2/api` (the live `API_BASE` binding follows).
- **Steps**:
  1. Pre-seed store with `dev-1`, mock `fetch` to reject (relay), init.
  2. Switch to `dev-2`, assert base flips. Also assert the exported `API_BASE` live binding tracks it.
- **Command**:
  ```bash
  cd /Users/davidtaylor/Repositories/tmux-conductor/app/frontend && cat > ../../tmp/uat-056/device-switch.ts <<'EOF'
const store = new Map<string, string>([['tmux-conductor:selected-device', 'dev-1']])
;(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v) },
  removeItem: (k: string) => { store.delete(k) },
}
;(globalThis as any).fetch = async () => { throw new Error('down') }
const rt = await import('./src/lib/runtime.ts')
const api = await import('./src/lib/api.ts')
await rt.initRuntimeMode()
const assert = (c: boolean, m: string) => { if (!c) { console.error('FAIL:', m); process.exit(1) } }
assert(api.getApiBase() === '/relay/dev-1/api', `initial base should be '/relay/dev-1/api', got '${api.getApiBase()}'`)
rt.setSelectedDeviceId('dev-2')
assert(api.getApiBase() === '/relay/dev-2/api', `after switch base should be '/relay/dev-2/api', got '${api.getApiBase()}'`)
assert(api.API_BASE === '/relay/dev-2/api', `live API_BASE binding should be '/relay/dev-2/api', got '${api.API_BASE}'`)
console.log('PASS: device switch repoints base dev-1 → dev-2')
EOF
  npx tsx ../../tmp/uat-056/device-switch.ts
  ```
- **Expected Result**: Exit code 0; final line `PASS: device switch repoints base dev-1 → dev-2`.
- [x] Pass <!-- 2026-06-14 -->

---

### UAT-LOGIC-009: `subscribeRuntime` fires on device switch and on mode resolution; unsubscribe works

- **Description**: `subscribeRuntime(fn)` registers a callback invoked by `notify()` (called from `initRuntimeMode()` and `setSelectedDeviceId()`). The returned unsubscribe must stop further notifications. This is what `App.tsx`'s `Dashboard` relies on to re-key the conductor subtree.
- **Steps**:
  1. Subscribe before init; mock `fetch` to reject (relay).
  2. Init (expect 1 notify), switch device (expect 2nd notify), unsubscribe, switch again (count must not increase).
- **Command**:
  ```bash
  cd /Users/davidtaylor/Repositories/tmux-conductor/app/frontend && cat > ../../tmp/uat-056/subscribe.ts <<'EOF'
const store = new Map<string, string>()
;(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v) },
  removeItem: (k: string) => { store.delete(k) },
}
;(globalThis as any).fetch = async () => { throw new Error('down') }
const rt = await import('./src/lib/runtime.ts')
let count = 0
const unsub = rt.subscribeRuntime(() => { count++ })
await rt.initRuntimeMode()
const assert = (c: boolean, m: string) => { if (!c) { console.error('FAIL:', m); process.exit(1) } }
assert(count === 1, `init should notify once, count=${count}`)
rt.setSelectedDeviceId('dev-x')
assert(count === 2, `device switch should notify (count should be 2), count=${count}`)
unsub()
rt.setSelectedDeviceId('dev-y')
assert(count === 2, `after unsubscribe count should stay 2, count=${count}`)
console.log('PASS: subscribeRuntime fires on init + switch; unsubscribe stops it')
EOF
  npx tsx ../../tmp/uat-056/subscribe.ts
  ```
- **Expected Result**: Exit code 0; final line `PASS: subscribeRuntime fires on init + switch; unsubscribe stops it`.
- [x] Pass <!-- 2026-06-14 -->

---

### UAT-LOGIC-010: Direct-mode device switch does NOT relay-prefix the base

- **Description**: `setSelectedDeviceId()` only re-applies relay config when `resolvedMode === 'relay'`. In direct mode (probe reachable), setting a device must still persist it (for a later relay session) but must NOT change the conductor base away from `/api`.
- **Steps**:
  1. Mock `fetch` to resolve `{ ok: true }` (direct), init.
  2. Set a device; assert base stays `/api` but the value is persisted.
- **Command**:
  ```bash
  cd /Users/davidtaylor/Repositories/tmux-conductor/app/frontend && cat > ../../tmp/uat-056/direct-switch.ts <<'EOF'
const store = new Map<string, string>()
;(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v) },
  removeItem: (k: string) => { store.delete(k) },
}
;(globalThis as any).fetch = async () => ({ ok: true } as Response)
const rt = await import('./src/lib/runtime.ts')
const api = await import('./src/lib/api.ts')
await rt.initRuntimeMode()
const assert = (c: boolean, m: string) => { if (!c) { console.error('FAIL:', m); process.exit(1) } }
rt.setSelectedDeviceId('dev-z')
assert(api.getApiBase() === '/api', `direct mode base must stay '/api', got '${api.getApiBase()}'`)
assert(rt.getSelectedDeviceId() === 'dev-z', 'device should still persist in direct mode')
console.log('PASS: direct-mode switch keeps base=/api, still persists device')
EOF
  npx tsx ../../tmp/uat-056/direct-switch.ts
  ```
- **Expected Result**: Exit code 0; final line `PASS: direct-mode switch keeps base=/api, still persists device`.
- [x] Pass <!-- 2026-06-14 -->

---

### UAT-BUILD-001: Typecheck passes cleanly

- **Description**: Acceptance criterion — `npx tsc --noEmit` exits 0 with zero errors in `app/frontend`.
- **Steps**:
  1. Run the command from `app/frontend`.
- **Command**:
  ```bash
  cd /Users/davidtaylor/Repositories/tmux-conductor/app/frontend && npx tsc --noEmit
  ```
- **Expected Result**: Exit code 0; no TypeScript diagnostics printed.
- [x] Pass <!-- 2026-06-14 -->

---

### UAT-BUILD-002: Production build succeeds with `VITE_API_MODE=relay` override (override path compiled)

- **Description**: The `VITE_API_MODE` override is a build-time env read. A Vite production build with `VITE_API_MODE=relay` must succeed, confirming the override branch in `runtime.ts` / `api.ts` compiles and is wired (the override is honored at build/runtime, not at tsx import). The build must emit assets.
- **Steps**:
  1. Run the production build with the env var set.
- **Command**:
  ```bash
  cd /Users/davidtaylor/Repositories/tmux-conductor/app/frontend && VITE_API_MODE=relay npm run build
  ```
- **Expected Result**: Exit code 0; Vite prints `built in <time>` and emits `dist/` assets; no build errors.
- [x] Pass <!-- 2026-06-14 -->

---

### UAT-CLEANUP-001: Remove scratch harnesses

- **Description**: Housekeeping — remove the tsx harness files created during this UAT.
- **Steps**:
  1. Remove the scratch dir.
- **Command**:
  ```bash
  rm -rf /Users/davidtaylor/Repositories/tmux-conductor/tmp/uat-056
  ```
- **Expected Result**: Exit code 0; `./tmp/uat-056` no longer exists.
- [x] Pass <!-- 2026-06-14 -->

---

## Gaps / not covered

- **Runtime `VITE_API_MODE` override under tsx**: not directly assertable because `import.meta.env` is undefined under tsx (the guard yields `{}`), so the override branch cannot be exercised from a tsx harness. It is instead covered indirectly by UAT-BUILD-002 (build with the env var set compiles and honors the override branch) and by source inspection of `initRuntimeMode()` (lines 108–114). A full runtime assertion would require a Vite-served browser test (Playwright against a build started with `VITE_API_MODE`), which is heavier than warranted for a single env branch.
- **`VITE_DEVICE_ID` fallback**: same constraint — the fallback reads `import.meta.env.VITE_DEVICE_ID`, undefined under tsx. UAT-LOGIC-007 covers the localStorage-restore path (the primary mechanism); the env fallback is the secondary path and is only reachable via a build-time env, not the tsx harness.
- **`App.tsx` gating render (`return null` until `ready`) and `Dashboard` re-key**: these are React rendering behaviors. The underlying contract they depend on (`initRuntimeMode()` resolves, `subscribeRuntime` fires) is fully covered by UAT-LOGIC-001/009. A DOM-level assertion of "router not mounted until ready" would need React Testing Library / Playwright, which the project does not currently set up.
