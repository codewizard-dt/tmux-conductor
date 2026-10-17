import { useState, useEffect } from 'react';
import { API_BASE as API_URL, listProjects, type Project } from '../lib/api';
import { useGitRoot } from '../lib/useGitRoot';

const NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

interface ApiErrorBody {
  error?: string;
}

const fieldCls = 'flex flex-col gap-1.5';
const labelCls = 'text-[10px] font-semibold uppercase tracking-[0.08em] text-muted';
const inputCls = [
  'w-full rounded-[8px] border border-line-input bg-card px-3 py-1.5',
  'font-mono text-[12px] text-ink placeholder:text-muted-2',
  'outline-none transition',
  'focus:border-accent focus:ring-2 focus:ring-accent/10',
  'disabled:opacity-40',
].join(' ');

interface AddBgProcessFormProps {
  open: boolean;
  onClose: () => void;
  /** Preselects this project in the Project dropdown (used when opened from an agent's menu). */
  defaultProjectId?: number | null;
}

export default function AddBgProcessForm({ open, onClose, defaultProjectId = null }: AddBgProcessFormProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  useEffect(() => {
    void (async () => {
      try {
        setProjects(await listProjects());
      } catch {
        /* best-effort */
      }
    })();
  }, []);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(defaultProjectId);
  const [name, setName] = useState('');
  const [workdir, setWorkdir] = useState('');
  const [launchCmd, setLaunchCmd] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const gitRoot = useGitRoot(workdir);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => { document.removeEventListener('keydown', handler); };
  }, [open, onClose]);

  const selectedProject =
    selectedProjectId === null ? null : projects.find((p) => p.id === selectedProjectId) ?? null;

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (!NAME_PATTERN.test(name)) {
      setError('Name must match ^[a-zA-Z0-9_-]+$ (letters, digits, hyphens, underscores)');
      return;
    }
    const effectiveWorkdir = selectedProject !== null ? selectedProject.workdir : workdir;
    if (!effectiveWorkdir.startsWith('/')) {
      setError('Working directory must be an absolute path (start with /)');
      return;
    }
    if (!launchCmd.trim()) {
      setError('Launch command is required');
      return;
    }
    if (selectedProjectId === null) {
      setError('Project is required');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${API_URL}/bg-processes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, workdir: effectiveWorkdir, launchCmd, projectId: selectedProjectId }),
      });

      if (res.status === 201) {
        setName('');
        setWorkdir('');
        setLaunchCmd('');
        setSelectedProjectId(null);
        onClose();
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

  if (!open) return null;

  function handleOverlayClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={handleOverlayClick}
    >
      <div className="animate-riseIn flex max-h-[90vh] w-[560px] flex-col overflow-y-auto rounded-card border border-line bg-card px-5 py-4 shadow-pop">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
          Add Background Process
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="cursor-pointer rounded-[6px] border-0 bg-transparent p-1 text-muted hover:text-ink transition"
        >
          ✕
        </button>
      </div>
      <form
        onSubmit={(e: React.SyntheticEvent<HTMLFormElement>) => { void handleSubmit(e); }}
        className="flex flex-col gap-3"
      >
        <div className={fieldCls}>
          <label htmlFor="bg-project" className={labelCls}>Project</label>
          <select
            id="bg-project"
            value={selectedProjectId === null ? '' : selectedProjectId.toString()}
            onChange={(e) => {
              const v = e.target.value;
              setSelectedProjectId(v === '' ? null : Number(v));
            }}
            required
            className={inputCls}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>

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
                  className="ml-auto cursor-pointer rounded border border-amber-300 bg-card px-2 py-0.5 text-[10px] font-medium hover:bg-amber-100"
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

        <div className="flex items-center gap-3 pt-0.5">
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex h-8 cursor-pointer items-center justify-center rounded-[8px] bg-button-primary px-4 text-[13px] font-medium text-button-primary-text shadow-[0_1px_2px_0_rgb(16_17_26/0.06),inset_0_1px_0_0_rgb(255_255_255/0.1)] transition hover:opacity-90 active:scale-[0.985] disabled:pointer-events-none disabled:opacity-50"
          >
            {submitting ? 'Spawning…' : 'Spawn Process'}
          </button>
          {error && <p className="text-[12px] text-accent-red">{error}</p>}
        </div>
      </form>
      </div>
    </div>
  );
}
