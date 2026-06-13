import React from 'react';
import { createSchedule, type CreateScheduleInput } from '../lib/api';

export interface ScheduleFormProps {
  onCreated?: () => void;
}

export default function ScheduleForm({ onCreated }: ScheduleFormProps) {
  const [name, setName] = React.useState('');
  const [command, setCommand] = React.useState('');
  const [intervalSeconds, setIntervalSeconds] = React.useState(60);
  const [action, setAction] = React.useState<'append' | 'jump'>('append');
  const [skipIfPending, setSkipIfPending] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();

    const trimmedCommand = command.trim();
    if (!trimmedCommand) {
      setError('Command is required.');
      return;
    }
    if (intervalSeconds < 5) {
      setError('Interval must be at least 5 seconds.');
      return;
    }

    setSubmitting(true);
    setError(null);

    const trimmedName = name.trim();
    const input: CreateScheduleInput = {
      command: trimmedCommand,
      intervalSeconds,
      action,
      skipIfPending,
    };
    if (trimmedName) {
      input.name = trimmedName;
    }

    try {
      await createSchedule(input);
      setCommand('');
      onCreated?.();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create schedule';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  const hasCommand = command.trim().length > 0;

  return (
    <div className="mt-2">
      <form onSubmit={(e) => { void handleSubmit(e); }} className="flex flex-col gap-1.5">
        <input
          type="text"
          placeholder="Name (optional)…"
          value={name}
          onChange={e => { setName(e.target.value); setError(null); }}
          className="rounded-[7px] border border-line bg-white px-2.5 py-1 font-mono text-[12px] text-ink placeholder:text-muted-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/10 disabled:opacity-40"
          disabled={submitting}
          aria-label="Schedule name"
        />
        <input
          type="text"
          placeholder="Command…"
          value={command}
          onChange={e => { setCommand(e.target.value); setError(null); }}
          className="rounded-[7px] border border-line bg-white px-2.5 py-1 font-mono text-[12px] text-ink placeholder:text-muted-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/10 disabled:opacity-40"
          disabled={submitting}
          aria-label="Schedule command"
        />
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            min={5}
            value={intervalSeconds}
            onChange={e => { setIntervalSeconds(Number(e.target.value)); setError(null); }}
            className="w-20 rounded-[7px] border border-line bg-white px-2.5 py-1 font-mono text-[12px] text-ink placeholder:text-muted-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/10 disabled:opacity-40"
            disabled={submitting}
            aria-label="Interval in seconds"
          />
          <span className="text-[11px] text-muted-2">sec</span>
          <select
            value={action}
            onChange={e => { setAction(e.target.value === 'jump' ? 'jump' : 'append'); setError(null); }}
            className="rounded-[7px] border border-line bg-white px-2.5 py-1 font-mono text-[12px] text-ink outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/10 disabled:opacity-40"
            disabled={submitting}
            aria-label="Action"
          >
            <option value="append">append</option>
            <option value="jump">jump</option>
          </select>
        </div>
        <label className="flex items-center gap-1.5 text-[11px] text-muted-2">
          <input
            type="checkbox"
            checked={skipIfPending}
            onChange={e => { setSkipIfPending(e.target.checked); setError(null); }}
            disabled={submitting}
            aria-label="Skip if pending"
          />
          Skip if pending
        </label>
        <button
          type="submit"
          disabled={!hasCommand || submitting}
          className="inline-flex h-7 cursor-pointer items-center justify-center rounded-[7px] bg-ink px-3 text-[12px] font-medium text-white transition hover:bg-ink-2 active:scale-[0.985] disabled:pointer-events-none disabled:opacity-40"
          aria-label="Create schedule"
        >
          {submitting ? '…' : 'Create schedule'}
        </button>
      </form>
      {error && (
        <p className="mt-1 text-[11px] text-accent-red">{error}</p>
      )}
    </div>
  );
}
