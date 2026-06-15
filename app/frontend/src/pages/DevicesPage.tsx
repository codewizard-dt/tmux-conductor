import { useEffect, useState } from 'react'
import DevicePicker from '../components/DevicePicker'
import Onboarding from '../components/Onboarding'
import { listDevices, type Device } from '../lib/devices'

export default function DevicesPage() {
  const [devices, setDevices] = useState<Device[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    listDevices()
      .then((result) => {
        if (!cancelled) setDevices(result)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load devices')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  return (
    <main className="mx-auto flex max-w-[1280px] flex-col gap-6 px-6 py-8">
      {loading && <p className="text-[13px] text-muted-2">Loading…</p>}
      {error && <p className="text-[12px] text-accent-red">{error}</p>}
      {!loading && !error && devices !== null && (
        devices.length === 0 ? <Onboarding /> : <DevicePicker />
      )}
    </main>
  )
}
