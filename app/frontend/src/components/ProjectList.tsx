import { useEffect, useState } from 'react';
import { listProjects, spawnAgentInProject, type Project } from '../lib/api';

export default function ProjectList() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rowBusy, setRowBusy] = useState<number | null>(null);
  const [rowError, setRowError] = useState<number | null>(null);
  const [rowErrorMsg, setRowErrorMsg] = useState<string | null>(null);

  async function refetch() {
    try {
      const list = await listProjects();
      setError(null);
      setProjects(list);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load projects');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refetch();
  }, []);

  async function handleSpawn(project: Project) {
    setRowBusy(project.id);
    setRowError(null);
    setRowErrorMsg(null);
    try {
      await spawnAgentInProject(project.id);
      // No project-* SSE event exists, so refetch after the mutation.
      // The spawned agent surfaces in AgentList via the monitor SSE loop.
      await refetch();
    } catch (err: unknown) {
      setRowError(project.id);
      setRowErrorMsg(err instanceof Error ? err.message : 'Failed to spawn agent');
    } finally {
      setRowBusy(null);
    }
  }

  return (
    <div className="animate-riseIn rounded-card border border-line bg-white px-5 py-4 shadow-card">
      <h2 className="mb-4 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
        Projects
      </h2>

      {error && <p className="text-[12px] text-accent-red">{error}</p>}

      {loading ? (
        <p className="text-[12px] text-muted-2">Loading projects…</p>
      ) : projects.length === 0 ? (
        <p className="text-[12px] text-muted-2">No projects yet</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {projects.map((project) => {
            const busy = rowBusy === project.id;
            const failed = rowError === project.id;
            return (
              <li
                key={project.id}
                className="flex flex-col gap-1.5 rounded-[8px] border border-line bg-canvas px-3 py-2"
              >
                <div className="flex items-center gap-3">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-[12px] font-semibold text-ink">{project.name}</span>
                    <span className="block truncate text-[10px] text-muted-2">{project.workdir}</span>
                    <span className="block truncate text-[10px] text-muted-2">{project.defaultLaunchCmd}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => { void handleSpawn(project); }}
                    disabled={busy}
                    className="inline-flex h-7 flex-shrink-0 cursor-pointer items-center rounded-[7px] bg-accent-blue px-3 text-[12px] font-medium text-white transition hover:opacity-85 active:scale-[0.985] disabled:pointer-events-none disabled:opacity-40"
                  >
                    {busy ? 'Spawning…' : 'Spawn agent'}
                  </button>
                </div>
                {failed && rowErrorMsg && (
                  <p className="m-0 text-[12px] text-accent-red">{rowErrorMsg}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
