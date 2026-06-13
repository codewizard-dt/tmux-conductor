import React from 'react';
import { API_BASE } from '../lib/api';

export interface AddTaskFormProps {
  agentName: string;
  onAdded: (task: string) => void;
}

interface ApiErrorBody {
  error?: string;
}

interface AddTaskResponse {
  ok: boolean;
  line?: string;
  task?: unknown;
  dispatched?: boolean;
}

export default function AddTaskForm({ agentName, onAdded }: AddTaskFormProps) {
  const [value, setValue] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [dispatched, setDispatched] = React.useState(false);

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

      const body = await res.json().catch(() => ({})) as AddTaskResponse;
      setValue('');

      if (body.dispatched) {
        setDispatched(true);
        setTimeout(() => { setDispatched(false); }, 2000);
      } else {
        onAdded(trimmed);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to add task';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  const hasValue = value.trim().length > 0;

  return (
    <div className="mt-2">
      <form onSubmit={(e) => { void handleSubmit(e); }} className="flex gap-1.5">
        <input
          type="text"
          placeholder="New task…"
          value={value}
          onChange={e => { setValue(e.target.value); setError(null); }}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void handleSubmit(e as unknown as React.SyntheticEvent<HTMLFormElement>);
            }
          }}
          className="flex-1 rounded-[7px] border border-line bg-white px-2.5 py-1 font-mono text-[12px] text-ink placeholder:text-muted-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/10 disabled:opacity-40"
          disabled={submitting}
          aria-label="New task text"
        />
        <button
          type="submit"
          disabled={!hasValue || submitting}
          className="inline-flex h-7 cursor-pointer items-center rounded-[7px] bg-ink px-3 text-[12px] font-medium text-white transition hover:bg-ink-2 active:scale-[0.985] disabled:pointer-events-none disabled:opacity-40"
          aria-label="Add task"
        >
          {submitting ? '…' : 'Add'}
        </button>
      </form>
      {error && (
        <p className="mt-1 text-[11px] text-accent-red">{error}</p>
      )}
      {dispatched && (
        <p className="mt-1 text-[11px] text-green-600">Started immediately</p>
      )}
    </div>
  );
}