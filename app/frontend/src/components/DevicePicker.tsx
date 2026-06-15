import { useCallback, useEffect, useState } from 'react'
import { createPairingCode, listDevices, renameDevice, revokeDevice, type Device } from '../lib/devices'
import { getSelectedDeviceId, setSelectedDeviceId, subscribeRuntime } from '../lib/runtime'

const sectionCls = 'rounded-card border border-line bg-white px-5 py-5 shadow-card'
const sectionTitleCls = 'mb-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted'

interface PairingCode {
  code: string
  expiresAt: string
}

export default function DevicePicker() {
  const [devices, setDevices] = useState<Device[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(getSelectedDeviceId())
  const [pairing, setPairing] = useState<PairingCode | null>(null)
  const [pairingError, setPairingError] = useState<string | null>(null)
  const [pairingLoading, setPairingLoading] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [confirmingId, setConfirmingId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setDevices(await listDevices())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load devices')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    return subscribeRuntime(() => { setSelectedId(getSelectedDeviceId()) })
  }, [])

  const handleSelect = useCallback((id: string) => {
    setSelectedDeviceId(id)
  }, [])

  const handleGenerateCode = useCallback(async () => {
    setPairingLoading(true)
    setPairingError(null)
    try {
      setPairing(await createPairingCode())
    } catch (err) {
      setPairing(null)
      setPairingError(err instanceof Error ? err.message : 'Failed to generate code')
    } finally {
      setPairingLoading(false)
    }
  }, [])

  const startEdit = useCallback((device: Device) => {
    setEditingId(device.id)
    setEditName(device.name ?? '')
  }, [])

  const submitRename = useCallback(async (id: string) => {
    const name = editName.trim()
    if (!name) {
      setEditingId(null)
      return
    }
    setError(null)
    try {
      await renameDevice(id, name)
      setEditingId(null)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rename device')
    }
  }, [editName, refresh])

  const handleRevoke = useCallback(async (id: string) => {
    setError(null)
    try {
      await revokeDevice(id)
      setConfirmingId(null)
      if (getSelectedDeviceId() === id) setSelectedDeviceId(null)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke device')
    }
  }, [refresh])

  return (
    <div className={sectionCls}>
      <h2 className={sectionTitleCls}>Devices</h2>

      <div className="mb-4 flex flex-col gap-2">
        <button
          type="button"
          onClick={() => { void handleGenerateCode() }}
          disabled={pairingLoading}
          className="self-start rounded-md bg-accent px-3 py-1.5 text-[13px] font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {pairingLoading ? 'Generating…' : 'Generate pairing code'}
        </button>
        {pairing && (
          <div className="rounded-md border border-line bg-canvas px-3 py-2">
            <p className="font-mono text-[18px] font-semibold tracking-[0.12em] text-ink">{pairing.code}</p>
            <p className="text-[11px] text-muted-2">
              Expires {new Date(pairing.expiresAt).toLocaleString()}
            </p>
          </div>
        )}
        {pairingError && <p className="text-[12px] text-accent-red">{pairingError}</p>}
      </div>

      {loading && <p className="text-[13px] text-muted-2">Loading…</p>}
      {error && <p className="mb-2 text-[12px] text-accent-red">{error}</p>}

      {!loading && devices.length === 0 && !error && (
        <p className="text-[13px] text-muted-2">No devices paired yet.</p>
      )}

      <ul className="flex flex-col gap-2">
        {devices.map((device) => {
          const isSelected = device.id === selectedId
          return (
            <li
              key={device.id}
              className="flex items-center gap-3 rounded-md border border-line px-3 py-2"
            >
              <input
                type="radio"
                name="active-device"
                checked={isSelected}
                onChange={() => { handleSelect(device.id) }}
                aria-label={`Use ${device.name ?? 'device'}`}
                className="accent-accent"
              />

              <div className="min-w-0 flex-1">
                {editingId === device.id ? (
                  <input
                    type="text"
                    value={editName}
                    autoFocus
                    onChange={(e) => { setEditName(e.target.value) }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void submitRename(device.id)
                      if (e.key === 'Escape') setEditingId(null)
                    }}
                    className="w-full rounded border border-line px-2 py-1 text-[13px] text-ink"
                  />
                ) : (
                  <p className="truncate text-[13px] font-medium text-ink">
                    {device.name ?? 'Unnamed device'}
                  </p>
                )}
                <span className="flex items-center gap-1.5 text-[11px]">
                  {device.connected ? (
                    <>
                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent-green" />
                      <span className="text-accent-green">connected</span>
                    </>
                  ) : (
                    <>
                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-muted-2" />
                      <span className="text-muted-2">offline</span>
                    </>
                  )}
                </span>
              </div>

              <div className="flex flex-shrink-0 items-center gap-2">
                {editingId === device.id ? (
                  <button
                    type="button"
                    onClick={() => { void submitRename(device.id) }}
                    className="text-[12px] font-medium text-accent transition hover:opacity-80"
                  >
                    Save
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => { startEdit(device) }}
                    className="text-[12px] font-medium text-muted transition hover:text-ink"
                  >
                    Rename
                  </button>
                )}
                {confirmingId === device.id ? (
                  <button
                    type="button"
                    onClick={() => { void handleRevoke(device.id) }}
                    className="text-[12px] font-medium text-accent-red transition hover:opacity-80"
                  >
                    Confirm revoke
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => { setConfirmingId(device.id) }}
                    className="text-[12px] font-medium text-muted transition hover:text-accent-red"
                  >
                    Revoke
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
