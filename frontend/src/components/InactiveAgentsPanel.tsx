import { useState } from 'react';
import { API_BASE as API_URL } from '../lib/api';
import { useAgents } from '../lib/useAgents';
import { deriveStatus, getStatusColor, isInactiveStatus, ProjectBadge, type Agent } from './AgentList';
import ConfirmDialog from './ConfirmDialog';

interface ApiErrorBody {
  error?: string;
}

interface InactiveAgentsPanelProps {
  /** Selects an inactive agent so its detail renders in the main pane (same as an active row). */
  onOpenDetail: (agentId: number) => void;
  /** The agent currently shown in the detail pane, so a matching row can be highlighted. */
  selectedId?: number | null;
}

export default function InactiveAgentsPanel({ onOpenDetail, selectedId = null }: InactiveAgentsPanelProps) {
  const [collapsed, setCollapsed] = useState(true);
  const [rowBusy, setRowBusy] = useState<number | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [pendingRemove, setPendingRemove] = useState<Agent | null>(null);
  const { agents } = useAgents();

  const inactiveAgents = agents.filter((a) => isInactiveStatus(deriveStatus(a)));

  async function handleWake(a: Agent) {
    setRowBusy(a.id);
    setRowError(null);
    try {
      if (a.windowPresent) {
        const del = await fetch(`${API_URL}/agents/${a.id.toString()}/window`, { method: 'DELETE' });
        if (!del.ok) {
          const body = await del.json().catch(() => ({})) as ApiErrorBody;
          throw new Error(body.error ?? `HTTP ${del.status.toString()}`);
        }
      }
      const res = await fetch(`${API_URL}/agents/${a.id.toString()}/window`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as ApiErrorBody;
        throw new Error(body.error ?? `HTTP ${res.status.toString()}`);
      }
    } catch (err: unknown) {
      setRowError(err instanceof Error ? err.message : 'Failed to wake agent');
    } finally {
      setRowBusy(null);
    }
  }

  async function doRemoveInactive(a: Agent) {
    setPendingRemove(null);
    setRowBusy(a.id);
    setRowError(null);
    try {
      const res = await fetch(`${API_URL}/agents/${a.id.toString()}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as ApiErrorBody;
        throw new Error(body.error ?? `HTTP ${res.status.toString()}`);
      }
    } catch (err: unknown) {
      setRowError(err instanceof Error ? err.message : 'Failed to remove agent');
    } finally {
      setRowBusy(null);
    }
  }

  return (
    <div
      className="animate-riseIn mb-4 cursor-pointer border-b border-line pb-3"
      onClick={() => { setCollapsed((v) => !v); }}
    >
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setCollapsed((v) => !v); }}
        className="flex cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-left"
        aria-expanded={!collapsed}
      >
        <span className="flex items-center gap-1.5 text-muted">
          <span className="text-[14px] leading-none font-semibold">{collapsed ? '▸' : '▾'}</span>
          <span className="text-[10px] font-semibold uppercase tracking-[0.08em]">Inactive Agents ({inactiveAgents.length})</span>
        </span>
      </button>
      {!collapsed && (
        <div className="mt-2" onClick={(e) => { e.stopPropagation(); }}>
          {inactiveAgents.length === 0 ? (
            <p className="text-[12px] text-muted-2">None</p>
          ) : (
            <>
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                {inactiveAgents.map((a) => {
                  const status = deriveStatus(a);
                  const busy = rowBusy === a.id;
                  const selected = selectedId === a.id;
                  return (
                    <li
                      key={a.id}
                      className={`flex cursor-pointer items-center gap-2 rounded-[8px] border border-r-[4px] border-line bg-canvas px-2.5 py-1.5${selected ? ' ring-2 ring-accent-blue/50' : ''}`}
                      style={{ borderRightColor: getStatusColor(status) }}
                      title={a.workdir}
                      aria-current={selected ? 'true' : undefined}
                      onClick={() => { onOpenDetail(a.id); }}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <ProjectBadge name={a.projectName ?? null} />
                          <span className="min-w-0 truncate font-mono text-[12px] text-ink">{a.name}</span>
                        </span>
                        <span className="block text-[10px] font-semibold uppercase tracking-[0.06em] text-muted">
                          {status === 'no-window' ? 'closed' : status}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); void handleWake(a); }}
                        disabled={busy}
                        aria-label={`Wake agent ${a.name}`}
                        className="inline-flex h-7 flex-shrink-0 cursor-pointer items-center rounded-[7px] bg-accent-blue-solid px-2.5 text-[12px] font-medium text-white transition hover:opacity-85 active:scale-[0.985] disabled:pointer-events-none disabled:opacity-40"
                      >
                        {busy ? '…' : 'Wake'}
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setPendingRemove(a); }}
                        disabled={busy}
                        aria-label={`Remove agent ${a.name}`}
                        className="inline-flex h-7 w-7 flex-shrink-0 cursor-pointer items-center justify-center rounded-[7px] border border-line bg-card text-accent-red transition hover:border-accent-red/30 hover:bg-accent-red/5 active:scale-[0.985] disabled:pointer-events-none disabled:opacity-40"
                      >
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M2.5 4h11M6 4V2.5h4V4M4 4l.6 9h6.8L12 4M6.5 6.5v4M9.5 6.5v4" />
                        </svg>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {rowError && <p className="mt-1.5 text-[12px] text-accent-red">{rowError}</p>}
            </>
          )}
        </div>
      )}
      <ConfirmDialog
        open={pendingRemove !== null}
        message={pendingRemove ? `Remove agent "${pendingRemove.name}"? This deletes it from conductor.conf and drops its queued tasks.` : ''}
        confirmLabel="Remove"
        onConfirm={() => { if (pendingRemove) void doRemoveInactive(pendingRemove); }}
        onCancel={() => { setPendingRemove(null); }}
      />
    </div>
  );
}
