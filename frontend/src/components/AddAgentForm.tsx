import { useEffect, useState } from 'react';
import { API_BASE as API_URL, listProjects, spawnAgentInProject, type Project } from '../lib/api';
import { useAgents } from '../lib/useAgents';
import { useGitRoot } from '../lib/useGitRoot';
import { deriveStatus, type Agent, type AgentStatus } from './AgentList';

const DEFAULT_LAUNCH_CMD = 'claude --dangerously-skip-permissions';
const NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

// Statuses that mean "not on the board" — closed windows, dead processes,
// undetectable states. These agents live in the Inactive list, not a column.
const INACTIVE_STATUSES: AgentStatus[] = ['no-window', 'exited', 'error', 'unknown'];

interface ApiErrorBody {
  error?: string;
}

const fieldCls = 'flex flex-col gap-1.5';
const labelCls = 'text-[10px] font-semibold uppercase tracking-[0.08em] text-muted';
const inputCls = [
  'w-full rounded-[8px] border border-line bg-white px-3 py-1.5',
  'font-mono text-[12px] text-ink placeholder:text-muted-2',
  'outline-none transition',
  'focus:border-accent focus:ring-2 focus:ring-accent/10',
  'disabled:opacity-40',
].join(' ');

export default function AddAgentForm() {
  const [name, setName] = useState('');
  const [workdir, setWorkdir] = useState('');
  const [launchCmd, setLaunchCmd] = useState(DEFAULT_LAUNCH_CMD);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const gitRoot = useGitRoot(workdir);
  const { agents } = useAgents();

  useEffect(() => {
    void (async () => {
      try {
        setProjects(await listProjects());
      } catch {
        // Non-fatal: project list stays empty, free-form path still works.
      }
    })();
  }, []);

  const selectedProject =
    selectedProjectId === null ? null : projects.find((p) => p.id === selectedProjectId) ?? null;

  const inactiveAgents = agents.filter((a) => INACTIVE_STATUSES.includes(deriveStatus(a)));

  async function handleWake(a: Agent) {
    setRowBusy(a.name);
    setRowError(null);
    try {
      if (a.windowPresent) {
        // exited/unknown with a dead window — clear it before relaunching
        const del = await fetch(`${API_URL}/agents/${encodeURIComponent(a.name)}/window`, { method: 'DELETE' });
        if (!del.ok) {
          const body = await del.json().catch(() => ({})) as ApiErrorBody;
          throw new Error(body.error ?? `HTTP ${del.status.toString()}`);
        }
      }
      const res = await fetch(`${API_URL}/agents/${encodeURIComponent(a.name)}/window`, { method: 'POST' });
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
    setRowBusy(a.name);
    setRowError(null);
    try {
      const res = await fetch(`${API_URL}/agents/${encodeURIComponent(a.name)}`, { method: 'DELETE' });
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

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    function clearOnSuccess() {
      setName('');
      setWorkdir('');
      setLaunchCmd(DEFAULT_LAUNCH_CMD);
      setShowAdvanced(false);
      setSuccess(true);
      setTimeout(() => { setSuccess(false); }, 4000);
    }

    if (selectedProject !== null) {
      // Project-scoped path: name is optional (backend auto-names), workdir +
      // launchCmd come from the project itself, so skip the free-form validation.
      setSubmitting(true);
      try {
        await spawnAgentInProject(selectedProject.id, name.trim() || undefined);
        clearOnSuccess();
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to spawn agent');
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (!NAME_PATTERN.test(name)) {
      setError('Name must match ^[a-zA-Z0-9_-]+$ (letters, digits, hyphens, underscores)');
      return;
    }
    if (!workdir.startsWith('/')) {
      setError('Working directory must be an absolute path (start with /)');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${API_URL}/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, workdir, launchCmd }),
      });

      if (res.status === 201) {
        clearOnSuccess();
      } else if (res.status === 409) {
        const body = await res.json() as ApiErrorBody;
        setError(body.error ?? 'Conflict error');
      } else {
        const body = await res.json().catch(() => ({})) as ApiErrorBody;
        setError(body.error ?? 'Failed to spawn agent');
      }
    } catch {
      setError('Failed to spawn agent');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="animate-riseIn rounded-card border border-line bg-white px-5 py-4 shadow-card">
      <h2 className="mb-4 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
        Add Agent
      </h2>
      <form
        onSubmit={(e: React.SyntheticEvent<HTMLFormElement>) => { void handleSubmit(e); }}
        className="flex flex-col gap-3"
      >
        <div className={fieldCls}>
          <label htmlFor="agent-project" className={labelCls}>Project</label>
          <select
            id="agent-project"
            value={selectedProjectId === null ? '' : selectedProjectId.toString()}
            onChange={(e) => {
              const v = e.target.value;
              setSelectedProjectId(v === '' ? null : Number(v));
            }}
            className={inputCls}
          >
            <option value="">— None (free-form) —</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className={fieldCls}>
            <label htmlFor="agent-name" className={labelCls}>Name</label>
            <input
              id="agent-name"
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value); }}
              placeholder={selectedProject !== null ? `(auto: ${selectedProject.name}-N)` : 'agent-name'}
              pattern="^[a-zA-Z0-9_-]+$"
              required={selectedProject === null}
              className={inputCls}
            />
          </div>
          <div className={fieldCls}>
            <label htmlFor="agent-workdir" className={labelCls}>Working Directory</label>
            <input
              id="agent-workdir"
              type="text"
              value={selectedProject !== null ? selectedProject.workdir : workdir}
              onChange={(e) => { setWorkdir(e.target.value); }}
              placeholder="/absolute/path"
              required={selectedProject === null}
              disabled={selectedProject !== null}
              className={inputCls}
            />
            {selectedProject === null && gitRoot.isInsideRepo && gitRoot.gitRoot && gitRoot.gitRoot !== workdir && (
              <div className="mt-1 flex items-center gap-2 rounded-[6px] border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800">
                <span>⚠ Inside a git repo — nearest root:</span>
                <code className="font-mono">{gitRoot.gitRoot}</code>
                <button
                  type="button"
                  onClick={() => { setWorkdir(gitRoot.gitRoot ?? '') }}
                  className="ml-auto cursor-pointer rounded border border-amber-300 bg-white px-2 py-0.5 text-[10px] font-medium hover:bg-amber-100"
                >
                  Use this path ↑
                </button>
              </div>
            )}
          </div>
        </div>

        <div>
          <button
            type="button"
            onClick={() => { setShowAdvanced((v) => !v); }}
            className="border-0 bg-transparent p-0 text-[12px] font-medium text-muted transition-colors hover:text-ink cursor-pointer leading-none"
          >
            {showAdvanced ? '▾ Hide advanced' : '▸ Show advanced'}
          </button>
          {showAdvanced && (
            <div className={`mt-2.5 ${fieldCls}`}>
              <label htmlFor="agent-launch-cmd" className={labelCls}>Launch Command</label>
              <input
                id="agent-launch-cmd"
                type="text"
                value={selectedProject !== null ? selectedProject.defaultLaunchCmd : launchCmd}
                onChange={(e) => { setLaunchCmd(e.target.value); }}
                placeholder={DEFAULT_LAUNCH_CMD}
                disabled={selectedProject !== null}
                className={inputCls}
              />
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 pt-0.5">
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex h-8 cursor-pointer items-center justify-center rounded-[8px] bg-ink px-4 text-[13px] font-medium text-white shadow-[0_1px_2px_0_rgb(16_17_26/0.06),inset_0_1px_0_0_rgb(255_255_255/0.1)] transition hover:bg-ink-2 active:scale-[0.985] disabled:pointer-events-none disabled:opacity-50"
          >
            {submitting ? 'Spawning…' : 'Spawn Agent'}
          </button>
          {inactiveAgents.length > 0 && (
            <button
              type="button"
              onClick={() => { setShowInactive((v) => !v); }}
              className="inline-flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-[8px] border border-line bg-white px-4 text-[13px] font-medium text-ink transition hover:bg-canvas active:scale-[0.985]"
              aria-expanded={showInactive}
            >
              {showInactive ? '▾' : '▸'} Inactive Agents ({inactiveAgents.length})
            </button>
          )}
          {error && <p className="text-[12px] text-accent-red">{error}</p>}
          {success && <p className="text-[12px] text-accent-green">Agent spawned ✓</p>}
        </div>
      </form>

      {showInactive && inactiveAgents.length > 0 && (
        <div className="mt-3 border-t border-line pt-3">
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {inactiveAgents.map((a) => {
              const status = deriveStatus(a);
              const busy = rowBusy === a.name;
              return (
                <li key={a.name} className="flex items-center gap-3 rounded-[8px] border border-line bg-canvas px-3 py-2">
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
        </div>
      )}
    </div>
  );
}