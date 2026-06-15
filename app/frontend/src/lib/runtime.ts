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
//   2. Probe the host-server's `/api/healthz` through the direct proxy. If it
//      answers OK, we are local-direct; otherwise we are relay.
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

/** Probe target — relative so it flows through the dev `/api` proxy to host-server. */
const HEALTHZ_URL = '/api/healthz'

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
    const res = await fetch(HEALTHZ_URL, { signal: controller.signal })
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
 * - Otherwise, a reachable host-server `/api/healthz` means local-direct;
 *   an unreachable one means relay.
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
    const deviceId = getSelectedDeviceId() ?? viteEnv.VITE_DEVICE_ID ?? null
    setRelayConfig({ mode: 'relay', deviceId })
  } else {
    setRelayConfig({ mode: 'direct', deviceId: null })
  }

  notify()
  return mode
}
