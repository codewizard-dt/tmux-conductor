import type { BgProcess } from './AgentList'

type Liveness = NonNullable<BgProcess['liveness']>

interface BgLivenessBadgeProps {
  liveness?: BgProcess['liveness']
  windowPresent: boolean
}

// Theme-aware tokens only (no inline hex). Backgrounds are a light tint of the
// same token via color-mix, so both light and dark themes stay in sync.
const STYLES: Record<Liveness, string> = {
  running:
    'text-accent-green bg-[color-mix(in_srgb,var(--color-accent-green)_12%,transparent)]',
  exited:
    'text-accent-red bg-[color-mix(in_srgb,var(--color-accent-red)_12%,transparent)]',
  stopped:
    'text-[var(--color-status-warn-text)] bg-[color-mix(in_srgb,var(--color-accent-amber)_14%,transparent)]',
}

/**
 * Resolve the displayed liveness. An older host-server may omit the field, in
 * which case fall back to whether the tmux window exists.
 */
function resolveLiveness(liveness: BgProcess['liveness'], windowPresent: boolean): Liveness {
  if (liveness) return liveness
  return windowPresent ? 'running' : 'stopped'
}

/** Pill showing a bg process's real liveness as visible text (never colour alone). */
export function BgLivenessBadge({ liveness, windowPresent }: BgLivenessBadgeProps) {
  const label = resolveLiveness(liveness, windowPresent)
  return (
    <span
      data-liveness={label}
      className={`inline-flex items-center rounded-pill px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] ${STYLES[label]}`}
    >
      {label}
    </span>
  )
}
