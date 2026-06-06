import React from 'react';

import { API_BASE } from '../lib/api';

export interface AddTaskFormProps {
  agentName: string;
  onAdded: (task: string) => void;
}

interface ApiErrorBody {
  error?: string;
}

export default function AddTaskForm({ agentName, onAdded }: AddTaskFormProps) {
  const [value, setValue] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/queue/${encodeURIComponent(agentName)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: trimmed }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as ApiErrorBody;
        throw new Error(body.error ?? `HTTP ${res.status.toString()}`);
      }

      setValue('');
      onAdded(trimmed);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to add task';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  const formStyle: React.CSSProperties = {
    display: 'flex',
    gap: '6px',
    marginTop: '8px',
    alignItems: 'center',
  };

  const inputStyle: React.CSSProperties = {
    flex: 1,
    padding: '4px 8px',
    fontSize: '13px',
    fontFamily: 'monospace',
    border: '1px solid #ccc',
    borderRadius: '4px',
  };

  const buttonStyle: React.CSSProperties = {
    padding: '4px 12px',
    fontSize: '13px',
    border: 'none',
    borderRadius: '4px',
    background: '#3b82f6',
    color: '#fff',
    cursor: value.trim() ? 'pointer' : 'not-allowed',
    opacity: value.trim() ? 1 : 0.5,
  };

  return (
    <div>
      <form onSubmit={(e) => { void handleSubmit(e); }} style={formStyle}>
        <input
          type="text"
          placeholder="New task…"
          value={value}
          onChange={e => { setValue(e.target.value); setError(null); }}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void handleSubmit(e as unknown as React.SyntheticEvent<HTMLFormElement>); } }}
          style={inputStyle}
          disabled={submitting}
          aria-label="New task text"
        />
        <button
          type="submit"
          disabled={!value.trim() || submitting}
          style={buttonStyle}
          aria-label="Add task"
        >
          {submitting ? '…' : 'Add'}
        </button>
      </form>
      {error && (
        <p style={{ color: 'red', fontSize: '12px', margin: '4px 0 0' }}>{error}</p>
      )}
    </div>
  );
}
