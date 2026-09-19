import { createPortal } from 'react-dom'
import { STATUS_CONFIG } from './AgentList'

interface NotificationStackProps {
  notifications: Array<{ agentId: number; agentName: string; status: 'awaiting' | 'empty' }>
  onDismiss: (agentId: number) => void
  onOpen: (agentId: number) => void
}

// Toast-like stack for agents that have been sitting in `awaiting`/`empty`
// past the grace period (see NOTIFICATION_GRACE_MS in AgentList.tsx). Rendered
// via createPortal into document.body so it floats above the Agents page
// regardless of scroll position.
export default function NotificationStack({ notifications, onDismiss, onOpen }: NotificationStackProps) {
  const latest = notifications.length > 0 ? notifications[notifications.length - 1] : undefined
  return createPortal(
    <div className="fixed top-4 right-4 z-40 flex flex-col gap-2">
      {/* Single persistent, empty-on-mount live region — screen readers won't
          reliably pick up an aria-live attribute and its text landing in the
          same paint, so this element must always be present (never created
          fresh per toast) and only have its text content mirrored in. */}
      <div role="status" aria-live="polite" aria-atomic="false" className="sr-only">
        {latest ? `${latest.agentName} is ${STATUS_CONFIG[latest.status].label}` : ''}
      </div>
      {notifications.map(({ agentId, agentName, status }) => {
        const cfg = STATUS_CONFIG[status]
        return (
          <div
            key={agentId}
            role="button"
            tabIndex={0}
            onClick={() => { onOpen(agentId) }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(agentId) } }}
            className="flex w-[280px] animate-popIn cursor-pointer select-none items-center gap-2 rounded-[10px] border border-line bg-card px-3.5 py-2.5 shadow-pop transition-shadow hover:shadow-card-hover"
            aria-label={`${agentName} ${cfg.label}`}
          >
            <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ background: cfg.dot }} aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-[13px] font-semibold tracking-tight text-ink">{agentName}</span>
            <span
              className="flex-shrink-0 rounded-pill px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em]"
              style={{ background: cfg.bg, color: cfg.color }}
            >
              {cfg.label}
            </span>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onDismiss(agentId) }}
              aria-label={`Dismiss ${agentName} notification`}
              className="flex h-5 w-5 flex-shrink-0 cursor-pointer items-center justify-center rounded-[5px] text-muted-2 transition hover:bg-canvas hover:text-ink"
            >
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        )
      })}
    </div>,
    document.body,
  )
}
