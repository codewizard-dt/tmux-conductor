import { useState, useEffect } from 'react';
import { API_BASE as API_URL } from '../lib/api';
import { useGitRoot } from '../lib/useGitRoot';

const NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

interface ApiErrorBody {
  error?: string;
}

interface Agent {
  name: string;
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

export default function AddBgProcessForm() {
  const [agents, setAgents] = useState<Agent[]>([]);
  useEffect(() => {
    void fetch(`${API_URL}/status`)
      .then((r) => r.json())
      .then((d: { agents?: Agent[] }) => { if (d.agents) setAgents(d.agents); })
      .catch(() => { /* best-effort */ });
  }, []);
  const [name, setName] = useState('');
  const [workdir, setWorkdir] = useState('');
  const [launchCmd, setLaunchCmd] = useState('');
  const [linkedAgent, setLinkedAgent] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const gitRoot = useGitRoot(workdir);

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (!NAME_PATTERN.test(name)) {
      setError('Name must match ^[a-zA-Z0-9_-]+$ (letters, digits, hyphens, underscores)');
      return;
    }
    if (!workdir.startsWith('/')) {
      setError('Working directory must be an absolute path (start with /)');
      return;
    }
    if (!launchCmd.trim()) {
      setError('Launch command is required');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${API_URL}/bg-processes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, workdir, launchCmd, linkedAgent: linkedAgent || undefined }),
      });

      if (res.status === 201) {
        setName('');
        setWorkdir('');
        setLaunchCmd('');
        setLinkedAgent('');
        setShowAdvanced(false);
        setSuccess(true);
        setTimeout(() => { setSuccess(false); }, 4000);
      } else if (res.status === 409) {
        const body = await res.json() as ApiErrorBody;
        setError(body.error ?? 'Conflict error');
      } else {
        const body = await res.json().catch(() => ({})) as ApiErrorBody;
        setError(body.error ?? 'Failed to spawn bg process');
      }
    } catch {
      setError('Failed to spawn bg process');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="animate-riseIn rounded-card border border-line bg-white px-5 py-4 shadow-card">
      <h2 className="mb-4 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
        Add Background Process
      </h2>
      <form
        onSubmit={(e: React.SyntheticEvent<HTMLFormElement>) => { void handleSubmit(e); }}
        className="flex flex-col gap-3"
      >
        <div className="grid grid-cols-2 gap-3">
          <div className={fieldCls}>
            <label htmlFor="bg-name" className={labelCls}>Name</label>
            <input
              id="bg-name"
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value); }}
              placeholder="bg-process-name"
              pattern="^[a-zA-Z0-9_-]+$"
              required
              className={inputCls}
            />
          </div>
          <div className={fieldCls}>
            <label htmlFor="bg-workdir" className={labelCls}>Working Directory</label>
            <input
              id="bg-workdir"
              type="text"
              value={workdir}
              onChange={(e) => { setWorkdir(e.target.value); }}
              placeholder="/absolute/path"
              required
              className={inputCls}
            />
            {gitRoot.isInsideRepo && gitRoot.gitRoot && gitRoot.gitRoot !== workdir && (
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

        <div className={fieldCls}>
          <label htmlFor="bg-launch-cmd" className={labelCls}>Launch Command</label>
          <input
            id="bg-launch-cmd"
            type="text"
            value={launchCmd}
            onChange={(e) => { setLaunchCmd(e.target.value); }}
            placeholder="npm run dev"
            required
            className={inputCls}
          />
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
              <label htmlFor="bg-linked-agent" className={labelCls}>Link to Agent (optional)</label>
              <select
                id="bg-linked-agent"
                value={linkedAgent}
                onChange={(e) => { setLinkedAgent(e.target.value); }}
                className={inputCls}
              >
                <option value="">— none —</option>
                {agents.map((a) => (
                  <option key={a.name} value={a.name}>{a.name}</option>
                ))}
              </select>
              <p className="text-[10px] text-muted">
                The linked agent will receive <code>CONDUCTOR_BG_NAME</code>, <code>CONDUCTOR_BG_LOG</code>, and <code>CONDUCTOR_BG_STATE</code> env vars at next startup.
              </p>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 pt-0.5">
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex h-8 cursor-pointer items-center justify-center rounded-[8px] bg-ink px-4 text-[13px] font-medium text-white shadow-[0_1px_2px_0_rgb(16_17_26/0.06),inset_0_1px_0_0_rgb(255_255_255/0.1)] transition hover:bg-ink-2 active:scale-[0.985] disabled:pointer-events-none disabled:opacity-50"
          >
            {submitting ? 'Spawning…' : 'Spawn Process'}
          </button>
          {error && <p className="text-[12px] text-accent-red">{error}</p>}
          {success && <p className="text-[12px] text-accent-green">Process spawned ✓</p>}
        </div>
      </form>
    </div>
  );
}
