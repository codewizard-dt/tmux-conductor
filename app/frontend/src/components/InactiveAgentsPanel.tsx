import { useState } from 'react';
import { API_BASE as API_URL } from '../lib/api';
import { useAgents } from '../lib/useAgents';
import { deriveStatus, type Agent, type AgentStatus } from './AgentList';

const INACTIVE_STATUSES: AgentStatus[] = ['no-window', 'exited', 'error', 'unknown'];

interface ApiErrorBody {
  error?: string;
}

export default function InactiveAgentsPanel() {
  const [collapsed, setCollapsed] = useState(true);
  const [rowBusy, setRowBusy] = useState<number | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const { agents } = useAgents();

  const inactiveAgents = agents.filter((a) => INACTIVE_STATUSES.includes(deriveStatus(a)));

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

  async function handleRemoveInactive(a: Agent) {
    const confirmed = window.confirm(
      `Remove agent "${a.name}"? This deletes it from conductor.conf and drops its queued tasks.`,
    );
    if (!confirmed) return;
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
      className="animate-riseIn rounded-card border border-line bg-white px-5 py-4 shadow-card cursor-pointer"
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
        <div className="mt-3" onClick={(e) => { e.stopPropagation(); }}>
          {inactiveAgents.length === 0 ? (
            <p className="text-[12px] text-muted-2">None</p>
          ) : (
            <>
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                {inactiveAgents.map((a) => {
                  const status = deriveStatus(a);
                  const busy = rowBusy === a.id;
                  return (
                    <li key={a.id} className="flex items-center gap-3 rounded-[8px] border border-line bg-canvas px-3 py-2">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-mono text-[12px] font-semibold text-ink">{a.name}</span>
                        <span className="block truncate text-[10px] text-muted-2">{a.workdir}</span>
                      </span>
                      <span className="flex-shrink-0 text-[10px] font-semibold uppercase tracking-[0.06em] text-muted">
                        {status === 'no-window' ? 'closed' : status}
                      </span>
                      <button
                        type="button"
                        onClick={() => { void handleWake(a); }}
                        disabled={busy}
                        className="inline-flex h-7 flex-shrink-0 cursor-pointer items-center rounded-[7px] bg-accent-blue px-3 text-[12px] font-medium text-white transition hover:opacity-85 active:scale-[0.985] disabled:pointer-events-none disabled:opacity-40"
                      >
                        {busy ? 'Working…' : 'Wake agent'}
                      </button>
                      <button
                        type="button"
                        onClick={() => { void handleRemoveInactive(a); }}
                        disabled={busy}
                        className="inline-flex h-7 flex-shrink-0 cursor-pointer items-center rounded-[7px] border border-line bg-white px-3 text-[12px] font-medium text-accent-red transition hover:border-accent-red/30 hover:bg-accent-red/5 active:scale-[0.985] disabled:pointer-events-none disabled:opacity-40"
                      >
                        Remove agent
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
    </div>
  );
}
