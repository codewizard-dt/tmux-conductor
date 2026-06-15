import { useEffect, useState } from 'react';
import { API_BASE as API_URL, listProjects, spawnAgentInProject, createProject, type Project } from '../lib/api';
import {
  commandForPreset,
  DEFAULT_LAUNCH_COMMAND,
  LAUNCH_COMMAND_PRESETS,
  presetForCommand,
  type LaunchCommandSelection,
} from '../lib/launchCommands';
import { useGitRoot } from '../lib/useGitRoot';

const NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

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
  const [launchCmd, setLaunchCmd] = useState<string>(DEFAULT_LAUNCH_COMMAND);
  const [launchPreset, setLaunchPreset] = useState<LaunchCommandSelection>('claude');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [collapsed, setCollapsed] = useState(true);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [showAddProject, setShowAddProject] = useState(false);
  const [newProjName, setNewProjName] = useState('');
  const [newProjWorkdir, setNewProjWorkdir] = useState('');
  const [newProjLaunchCmd, setNewProjLaunchCmd] = useState<string>(DEFAULT_LAUNCH_COMMAND);
  const [newProjLaunchPreset, setNewProjLaunchPreset] = useState<LaunchCommandSelection>('claude');
  const [addProjError, setAddProjError] = useState<string | null>(null);
  const [addProjSubmitting, setAddProjSubmitting] = useState(false);
  const gitRoot = useGitRoot(workdir);

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

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    function clearOnSuccess() {
      setName('');
      setWorkdir('');
      setLaunchCmd(DEFAULT_LAUNCH_COMMAND);
      setLaunchPreset('claude');
      setShowAdvanced(false);
      setSuccess(true);
      setTimeout(() => { setSuccess(false); }, 4000);
    }

    if (selectedProject !== null) {
      setSubmitting(true);
      try {
        await spawnAgentInProject(selectedProject.id, name.trim() || undefined, launchCmd);
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

  async function handleAddProject() {
    if (!/^[A-Za-z0-9_-]+$/.test(newProjName)) {
      setAddProjError('Name must contain only letters, numbers, hyphens, and underscores.');
      return;
    }
    if (!newProjWorkdir.startsWith('/')) {
      setAddProjError('Working directory must be an absolute path starting with /.');
      return;
    }
    setAddProjError(null);
    setAddProjSubmitting(true);
    try {
      const newProject = await createProject({ name: newProjName, workdir: newProjWorkdir, defaultLaunchCmd: newProjLaunchCmd });
      const newList = await listProjects();
      setProjects(newList);
      setSelectedProjectId(newProject.id);
      setLaunchCmd(newProject.defaultLaunchCmd);
      setLaunchPreset(presetForCommand(newProject.defaultLaunchCmd));
      setNewProjName('');
      setNewProjWorkdir('');
      setNewProjLaunchCmd(DEFAULT_LAUNCH_COMMAND);
      setNewProjLaunchPreset('claude');
      setAddProjError(null);
      setShowAddProject(false);
    } catch (err: unknown) {
      setAddProjError(err instanceof Error ? err.message : 'Failed to create project.');
    } finally {
      setAddProjSubmitting(false);
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
          <span className="text-[10px] font-semibold uppercase tracking-[0.08em]">Add Agent</span>
        </span>
      </button>
      {!collapsed && (
        <form
          onClick={(e) => { e.stopPropagation(); }}
          onSubmit={(e: React.SyntheticEvent<HTMLFormElement>) => { void handleSubmit(e); }}
          className="mt-4 flex flex-col gap-3"
        >
          <div className={fieldCls}>
            <label htmlFor="agent-project" className={labelCls}>Project</label>
            <div className="flex items-center gap-2">
              <select
                id="agent-project"
                value={selectedProjectId === null ? '' : selectedProjectId.toString()}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === '') {
                    setSelectedProjectId(null);
                    return;
                  }
                  const projectId = Number(v);
                  const project = projects.find((p) => p.id === projectId);
                  setSelectedProjectId(projectId);
                  if (project !== undefined) {
                    setLaunchCmd(project.defaultLaunchCmd);
                    setLaunchPreset(presetForCommand(project.defaultLaunchCmd));
                  }
                }}
                className={inputCls}
              >
                <option value="">— None (free-form) —</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => {
                  if (!showAddProject) {
                    setNewProjName('');
                    setNewProjWorkdir('');
                    setNewProjLaunchCmd(DEFAULT_LAUNCH_COMMAND);
                    setNewProjLaunchPreset('claude');
                    setAddProjError(null);
                  }
                  setShowAddProject((v) => !v);
                }}
                className="inline-flex h-[var(--input-h,32px)] items-center gap-1 rounded-[6px] border border-line bg-canvas px-2.5 text-[12px] font-medium text-muted hover:text-ink hover:border-ink/30 transition cursor-pointer flex-shrink-0"
              >
                {showAddProject ? '✕ Cancel' : '+ Add project'}
              </button>
            </div>
            {showAddProject && (
              <div className="mt-2 rounded-[8px] border border-line bg-canvas p-3">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="mb-0.5 block text-[11px] font-medium text-muted">Name</label>
                    <input
                      type="text"
                      value={newProjName}
                      onChange={(e) => { setNewProjName(e.target.value); }}
                      placeholder="my-project"
                      required
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className="mb-0.5 block text-[11px] font-medium text-muted">Working Directory</label>
                    <input
                      type="text"
                      value={newProjWorkdir}
                      onChange={(e) => { setNewProjWorkdir(e.target.value); }}
                      placeholder="/absolute/path"
                      required
                      className={inputCls}
                    />
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <div>
                    <label className="mb-0.5 block text-[11px] font-medium text-muted">Launch Agent</label>
                    <select
                      value={newProjLaunchPreset}
                      onChange={(e) => {
                        const next = e.target.value as LaunchCommandSelection;
                        setNewProjLaunchPreset(next);
                        if (next !== 'custom') {
                          setNewProjLaunchCmd(commandForPreset(next));
                        }
                      }}
                      className={inputCls}
                    >
                      {LAUNCH_COMMAND_PRESETS.map((preset) => (
                        <option key={preset.id} value={preset.id}>{preset.label}</option>
                      ))}
                      <option value="custom">Custom</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-0.5 block text-[11px] font-medium text-muted">Launch Command</label>
                    <input
                      type="text"
                      value={newProjLaunchCmd}
                      onChange={(e) => {
                        setNewProjLaunchCmd(e.target.value);
                        setNewProjLaunchPreset(presetForCommand(e.target.value));
                      }}
                      placeholder={DEFAULT_LAUNCH_COMMAND}
                      required
                      className={inputCls}
                    />
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => { void handleAddProject(); }}
                    disabled={addProjSubmitting}
                    className="inline-flex h-[var(--input-h,32px)] items-center rounded-[6px] bg-ink px-3 text-[12px] font-medium text-white hover:bg-ink/80 transition disabled:opacity-50 cursor-pointer"
                  >
                    {addProjSubmitting ? 'Adding…' : 'Add project'}
                  </button>
                  {addProjError && (
                    <span className="text-[12px] text-red-500">{addProjError}</span>
                  )}
                </div>
              </div>
            )}
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
                <label htmlFor="agent-launch-preset" className={labelCls}>Launch Agent</label>
                <select
                  id="agent-launch-preset"
                  value={launchPreset}
                  onChange={(e) => {
                    const next = e.target.value as LaunchCommandSelection;
                    setLaunchPreset(next);
                    if (next !== 'custom') {
                      setLaunchCmd(commandForPreset(next));
                    }
                  }}
                  className={inputCls}
                >
                  {LAUNCH_COMMAND_PRESETS.map((preset) => (
                    <option key={preset.id} value={preset.id}>{preset.label}</option>
                  ))}
                  <option value="custom">Custom</option>
                </select>
                <label htmlFor="agent-launch-cmd" className={labelCls}>Launch Command</label>
                <input
                  id="agent-launch-cmd"
                  type="text"
                  value={launchCmd}
                  onChange={(e) => {
                    setLaunchCmd(e.target.value);
                    setLaunchPreset(presetForCommand(e.target.value));
                  }}
                  placeholder={DEFAULT_LAUNCH_COMMAND}
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
            {error && <p className="text-[12px] text-accent-red">{error}</p>}
            {success && <p className="text-[12px] text-accent-green">Agent spawned ✓</p>}
          </div>
        </form>
      )}
    </div>
  );
}
