// ---------------------------------------------------------------------------
// Runtime mode detection (TASK-056).
//
// Decides at runtime whether the frontend runs LOCAL-DIRECT (dev / self-hosted,
// talking straight to the host-server via the Vite `/api` proxy) or RELAY
// (hosted on App Platform, conductor calls routed through app/api's
// `/relay/:deviceId/api/...` path). The resolved mode + selected device are
// injected into the api seam via `setRelayConfig()` from `./api`.
//
// Resolution order:
//   1. Explicit override: `VITE_API_MODE` ('direct' | 'relay').
//   2. Probe the host-server's `/api/status` through the direct proxy. If it
//      answers OK, we are local-direct; otherwise we are relay.
//      NOTE: we probe `/api/status`, NOT `/api/healthz`. In production the `/api`
//      ingress trims its prefix and forwards to app/api, which has its OWN
//      `/healthz` route — so `/api/healthz` answers 200 from app/api and would
//      falsely resolve `direct`. `/status` is host-server-exclusive (app/api has
//      no such route → 404), making the probe unambiguous.
//
// Device selection: in relay mode the conductor base depends on the active
// device. The selected `deviceId` is persisted to localStorage so a reload
// restores it; TASK-057's DevicePicker calls `setSelectedDeviceId()`. Changing
// the selection re-applies the relay config (repointing every conductor call)
// and notifies subscribers so React can re-render captured `API_BASE` reads.
// ---------------------------------------------------------------------------

import { setRelayConfig, type ApiMode } from './api'

type ViteEnv = ImportMeta & {
  env: {
    VITE_API_MODE?: string
    VITE_DEVICE_ID?: string
  }
}

const viteEnv = ((import.meta as ViteEnv).env ?? {}) as ViteEnv['env']

const DEVICE_STORAGE_KEY = 'tmux-conductor:selected-device'

/**
 * Probe target — relative so it flows through the dev `/api` proxy to host-server.
 * Host-server-exclusive: app/api answers `/api/healthz` (after the ingress trims
 * `/api`) but has no `/status` route, so this cleanly distinguishes local-direct
 * (200) from relay/production (404).
 */
const PROBE_URL = '/api/status'

let resolvedMode: ApiMode | null = null
const subscribers = new Set<() => void>()

function notify(): void {
  for (const fn of subscribers) fn()
}

/** Subscribe to runtime changes (mode resolved / device switched). Returns an unsubscribe fn. */
export function subscribeRuntime(fn: () => void): () => void {
  subscribers.add(fn)
  return () => { subscribers.delete(fn) }
}

/** Read the persisted selected device id (null if none / not in a browser). */
export function getSelectedDeviceId(): string | null {
  if (typeof localStorage === 'undefined') return null
  return localStorage.getItem(DEVICE_STORAGE_KEY)
}

function persistSelectedDeviceId(deviceId: string | null): void {
  if (typeof localStorage === 'undefined') return
  if (deviceId === null) localStorage.removeItem(DEVICE_STORAGE_KEY)
  else localStorage.setItem(DEVICE_STORAGE_KEY, deviceId)
}

/**
 * Select the active relay device. Persists the choice, re-applies the relay
 * config (only meaningful in relay mode), and notifies subscribers so the UI
 * repoints conductor calls. Called by TASK-057's DevicePicker.
 */
export function setSelectedDeviceId(deviceId: string | null): void {
  persistSelectedDeviceId(deviceId)
  if (resolvedMode === 'relay') {
    setRelayConfig({ mode: 'relay', deviceId })
  }
  notify()
}

/** The mode resolved by `initRuntimeMode()`, or null before it runs. */
export function getResolvedMode(): ApiMode | null {
  return resolvedMode
}

/** Probe the host-server's health endpoint through the direct proxy. */
async function probeDirect(): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => { controller.abort() }, 3000)
    const res = await fetch(PROBE_URL, { signal: controller.signal })
    clearTimeout(timer)
    return res.ok
  } catch {
    return false
  }
}

/**
 * Resolve the runtime mode and inject it into the api seam. Idempotent: the
 * first successful resolution is cached for the session. Returns the mode.
 *
 * - `VITE_API_MODE` is honored as an explicit override.
 * - Otherwise, a reachable host-server `/api/status` means local-direct;
 *   an unreachable one (404 from app/api in production) means relay.
 *
 * In relay mode the persisted selected device (or `VITE_DEVICE_ID` fallback)
 * is applied so a reload restores the prior selection.
 */
export async function initRuntimeMode(): Promise<ApiMode> {
  if (resolvedMode !== null) return resolvedMode

  const override = viteEnv.VITE_API_MODE
  let mode: ApiMode
  if (override === 'relay' || override === 'direct') {
    mode = override
  } else {
    mode = (await probeDirect()) ? 'direct' : 'relay'
  }

  resolvedMode = mode

  if (mode === 'relay') {
    let deviceId = getSelectedDeviceId() ?? viteEnv.VITE_DEVICE_ID ?? null
    if (!deviceId) {
      // No device in localStorage yet — try to auto-select from the API so the
      // relay config is populated on first load without requiring a manual pick.
      try {
        const res = await fetch('/api/devices', { signal: AbortSignal.timeout(3000) })
        if (res.ok) {
          const devices = (await res.json()) as Array<{ id: string; isOnline?: boolean }>
          if (devices.length > 0) {
            const pick = devices.find(d => d.isOnline) ?? devices[0]!
            deviceId = pick.id
            persistSelectedDeviceId(deviceId)
          }
        }
      } catch { /* unauthenticated or network error — leave deviceId null */ }
    }
    setRelayConfig({ mode: 'relay', deviceId })
  } else {
    setRelayConfig({ mode: 'direct', deviceId: null })
  }

  notify()
  return mode
}
