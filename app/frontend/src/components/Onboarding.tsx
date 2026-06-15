import { useCallback, useState } from 'react'
import { createPairingCode } from '../lib/devices'

const sectionCls = 'rounded-card border border-line bg-white px-5 py-5 shadow-card'
const sectionTitleCls = 'mb-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted'
const cmdBlockCls = 'overflow-x-auto rounded-md border border-line bg-canvas px-3 py-2 font-mono text-[12px] text-ink'

// Canonical install one-liner. The exact install URL is finalized in TASK-059;
// this is the canonical form.
const INSTALL_COMMAND =
  'curl -fsSL https://raw.githubusercontent.com/codewizard-dt/tmux-conductor/main/install.sh | bash'

export default function Onboarding() {
  const [copied, setCopied] = useState(false)
  const [pairing, setPairing] = useState<{ code: string; expiresAt: string } | null>(null)
  const [pairingLoading, setPairingLoading] = useState(false)
  const [pairingError, setPairingError] = useState<string | null>(null)

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

  const handleCopy = useCallback(() => {
    void navigator.clipboard
      .writeText(INSTALL_COMMAND)
      .then(() => {
        setCopied(true)
        setTimeout(() => { setCopied(false) }, 2000)
      })
      .catch(() => { setCopied(false) })
  }, [])

  return (
    <div className="flex flex-col gap-4">
      <div className={`${sectionCls} animate-riseIn`}>
        <h2 className={sectionTitleCls}>Get started</h2>
        <h1 className="text-[17px] font-semibold text-ink">No devices yet</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">
          You haven&apos;t paired any devices yet. A device is a host machine running the
          conductor agent. Install the conductor on a machine, then pair it with this account to
          start orchestrating agents from here.
        </p>
      </div>

      <div className={sectionCls}>
        <h2 className={sectionTitleCls}>1 · Install the conductor</h2>
        <p className="mb-3 text-[13px] leading-relaxed text-muted">
          Run this one-liner on the host machine you want to control:
        </p>
        <div className="flex items-start gap-2">
          <pre className={`${cmdBlockCls} flex-1`}>
            <code>{INSTALL_COMMAND}</code>
          </pre>
          <button
            type="button"
            onClick={handleCopy}
            className="flex-shrink-0 rounded-md bg-accent px-3 py-1.5 text-[12px] font-semibold text-white transition hover:opacity-90"
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <p className="mt-2 text-[11px] text-muted-2">
          The exact install URL is finalized in TASK-059; this is the canonical form.
        </p>
      </div>

      <div className={sectionCls}>
        <h2 className={sectionTitleCls}>2 · Pair the device</h2>
        <p className="mb-3 text-[13px] leading-relaxed text-muted">
          After installing, pair the host with this account. Generate a code below, then run on the host:
        </p>
        <pre className={`${cmdBlockCls} mb-3`}>
          <code>conductor pair --portal {'<portal-url>'} --code XXXX-XXXX</code>
        </pre>

        <div className="mb-3 flex flex-col gap-2">
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

        <p className="text-[13px] leading-relaxed text-muted">
          Once paired, the device shows up here automatically.
        </p>
      </div>
    </div>
  )
}
