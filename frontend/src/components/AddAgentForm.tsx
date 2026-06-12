import { useState } from 'react';
import { API_BASE as API_URL } from '../lib/api';
const DEFAULT_LAUNCH_CMD = 'claude --dangerously-skip-permissions';
const NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

interface ApiErrorBody {
  error?: string;
}

export default function AddAgentForm() {
  const [name, setName] = useState('');
  const [workdir, setWorkdir] = useState('');
  const [launchCmd, setLaunchCmd] = useState(DEFAULT_LAUNCH_CMD);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    // Client-side validation
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
        setName('');
        setWorkdir('');
        setLaunchCmd(DEFAULT_LAUNCH_CMD);
        setShowAdvanced(false);
        setSuccess(true);
        setTimeout(() => { setSuccess(false); }, 4000);
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
    <div style={{ marginBottom: '1.5rem', padding: '1rem', border: '1px solid #ccc', borderRadius: '6px' }}>
      <h2 style={{ marginTop: 0 }}>Add Agent</h2>
      <form onSubmit={(e: React.SyntheticEvent<HTMLFormElement>) => { void handleSubmit(e); }}>
        <div style={{ marginBottom: '0.75rem' }}>
          <label htmlFor="agent-name" style={{ display: 'block', marginBottom: '0.25rem' }}>
            Name
          </label>
          <input
            id="agent-name"
            type="text"
            value={name}
            onChange={(e) => { setName(e.target.value); }}
            placeholder="agent-name"
            pattern="^[a-zA-Z0-9_-]+$"
            required
            style={{ width: '100%', padding: '0.4rem', boxSizing: 'border-box' }}
          />
        </div>

        <div style={{ marginBottom: '0.75rem' }}>
          <label htmlFor="agent-workdir" style={{ display: 'block', marginBottom: '0.25rem' }}>
            Working Directory
          </label>
          <input
            id="agent-workdir"
            type="text"
            value={workdir}
            onChange={(e) => { setWorkdir(e.target.value); }}
            placeholder="/absolute/path"
            required
            style={{ width: '100%', padding: '0.4rem', boxSizing: 'border-box' }}
          />
        </div>

        <div style={{ marginBottom: '0.75rem' }}>
          <button
            type="button"
            onClick={() => { setShowAdvanced((v) => !v); }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#555', padding: 0 }}
          >
            {showAdvanced ? '▾ Hide advanced' : '▸ Show advanced'}
          </button>
          {showAdvanced && (
            <div style={{ marginTop: '0.5rem' }}>
              <label htmlFor="agent-launch-cmd" style={{ display: 'block', marginBottom: '0.25rem' }}>
                Launch Command
              </label>
              <input
                id="agent-launch-cmd"
                type="text"
                value={launchCmd}
                onChange={(e) => { setLaunchCmd(e.target.value); }}
                placeholder={DEFAULT_LAUNCH_CMD}
                style={{ width: '100%', padding: '0.4rem', boxSizing: 'border-box' }}
              />
            </div>
          )}
        </div>

        {error && (
          <div style={{ color: '#c0392b', marginBottom: '0.75rem' }}>
            {error}
          </div>
        )}
        {success && (
          <div style={{ color: '#27ae60', marginBottom: '0.75rem' }}>
            Agent spawned
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          style={{ padding: '0.5rem 1.25rem', cursor: submitting ? 'not-allowed' : 'pointer' }}
        >
          {submitting ? 'Spawning…' : 'Spawn Agent'}
        </button>
      </form>
    </div>
  );
}
