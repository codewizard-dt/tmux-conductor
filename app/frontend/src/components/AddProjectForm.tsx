import { useState } from 'react';
import { createProject } from '../lib/api';

const DEFAULT_LAUNCH_CMD = 'claude --dangerously-skip-permissions';
const NAME_PATTERN = /^[A-Za-z0-9_-]+$/;

const fieldCls = 'flex flex-col gap-1.5';
const labelCls = 'text-[10px] font-semibold uppercase tracking-[0.08em] text-muted';
const inputCls = [
  'w-full rounded-[8px] border border-line bg-white px-3 py-1.5',
  'font-mono text-[12px] text-ink placeholder:text-muted-2',
  'outline-none transition',
  'focus:border-accent focus:ring-2 focus:ring-accent/10',
  'disabled:opacity-40',
].join(' ');

export default function AddProjectForm() {
  const [name, setName] = useState('');
  const [workdir, setWorkdir] = useState('');
  const [defaultLaunchCmd, setDefaultLaunchCmd] = useState(DEFAULT_LAUNCH_CMD);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (!NAME_PATTERN.test(name)) {
      setError('Name must match ^[A-Za-z0-9_-]+$ (letters, digits, hyphens, underscores)');
      return;
    }
    if (!workdir.startsWith('/')) {
      setError('Working directory must be an absolute path (start with /)');
      return;
    }

    setSubmitting(true);
    try {
      await createProject({ name, workdir, defaultLaunchCmd });
      setName('');
      setWorkdir('');
      setDefaultLaunchCmd(DEFAULT_LAUNCH_CMD);
      setSuccess(true);
      setTimeout(() => { setSuccess(false); }, 4000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create project');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="animate-riseIn rounded-card border border-line bg-white px-5 py-4 shadow-card">
      <h2 className="mb-4 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
        Add Project
      </h2>
      <form
        onSubmit={(e: React.SyntheticEvent<HTMLFormElement>) => { void handleSubmit(e); }}
        className="flex flex-col gap-3"
      >
        <div className="grid grid-cols-2 gap-3">
          <div className={fieldCls}>
            <label htmlFor="project-name" className={labelCls}>Name</label>
            <input
              id="project-name"
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value); }}
              placeholder="project-name"
              pattern="^[A-Za-z0-9_-]+$"
              required
              className={inputCls}
            />
          </div>
          <div className={fieldCls}>
            <label htmlFor="project-workdir" className={labelCls}>Working Directory</label>
            <input
              id="project-workdir"
              type="text"
              value={workdir}
              onChange={(e) => { setWorkdir(e.target.value); }}
              placeholder="/absolute/path"
              required
              className={inputCls}
            />
          </div>
        </div>

        <div className={fieldCls}>
          <label htmlFor="project-launch-cmd" className={labelCls}>Default Launch Command</label>
          <input
            id="project-launch-cmd"
            type="text"
            value={defaultLaunchCmd}
            onChange={(e) => { setDefaultLaunchCmd(e.target.value); }}
            placeholder={DEFAULT_LAUNCH_CMD}
            className={inputCls}
          />
        </div>

        <div className="flex items-center gap-3 pt-0.5">
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex h-8 cursor-pointer items-center justify-center rounded-[8px] bg-ink px-4 text-[13px] font-medium text-white shadow-[0_1px_2px_0_rgb(16_17_26/0.06),inset_0_1px_0_0_rgb(255_255_255/0.1)] transition hover:bg-ink-2 active:scale-[0.985] disabled:pointer-events-none disabled:opacity-50"
          >
            {submitting ? 'Creating…' : 'Create Project'}
          </button>
          {error && <p className="text-[12px] text-accent-red">{error}</p>}
          {success && <p className="text-[12px] text-accent-green">Project created ✓</p>}
        </div>
      </form>
    </div>
  );
}
