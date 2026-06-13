import React from 'react';
import { listSchedules, deleteSchedule, type Schedule } from '../lib/api';
import { useSSEEvent } from '../hooks/useSSE';
import ScheduleForm from './ScheduleForm';

interface ScheduleFiredPayload {
  scheduleId: number;
  name: string | null;
  command: string;
}

function formatInterval(seconds: number): string {
  if (seconds % 3600 === 0) {
    const hours = seconds / 3600;
    return `every ${hours.toString()}h`;
  }
  if (seconds % 60 === 0) {
    const minutes = seconds / 60;
    return `every ${minutes.toString()}m`;
  }
  return `every ${seconds.toString()}s`;
}

function formatLastFired(lastEnqueuedAt: number | null): string {
  if (lastEnqueuedAt === null) {
    return 'never';
  }
  const date = new Date(lastEnqueuedAt * 1000);
  const deltaMs = Date.now() - date.getTime();
  return `${formatRelative(deltaMs)} (${date.toLocaleString()})`;
}

function formatNextFire(schedule: Schedule): string {
  if (schedule.lastEnqueuedAt === null) {
    return 'due now';
  }
  const nextDate = new Date((schedule.lastEnqueuedAt + schedule.intervalSeconds) * 1000);
  const deltaMs = nextDate.getTime() - Date.now();
  if (deltaMs <= 0) {
    return 'due now';
  }
  return `in ${formatDuration(deltaMs)} (${nextDate.toLocaleString()})`;
}

function formatRelative(deltaMs: number): string {
  if (deltaMs < 0) {
    return 'just now';
  }
  return `${formatDuration(deltaMs)} ago`;
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) {
    return `${seconds.toString()}s`;
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes.toString()}m`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours.toString()}h`;
  }
  const days = Math.round(hours / 24);
  return `${days.toString()}d`;
}

export default function ScheduleList() {
  const [schedules, setSchedules] = React.useState<Schedule[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [flashingId, setFlashingId] = React.useState<number | null>(null);
  const flashTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const refetch = React.useCallback(async () => {
    try {
      const next = await listSchedules();
      setSchedules(next);
      setError(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setError(`Failed to load schedules: ${msg}`);
    }
  }, []);

  React.useEffect(() => {
    void refetch();
  }, [refetch]);

  React.useEffect(() => {
    return () => {
      if (flashTimer.current !== null) {
        clearTimeout(flashTimer.current);
      }
    };
  }, []);

  useSSEEvent<ScheduleFiredPayload>('schedule-fired', (payload) => {
    void refetch();
    setFlashingId(payload.scheduleId);
    if (flashTimer.current !== null) {
      clearTimeout(flashTimer.current);
    }
    flashTimer.current = setTimeout(() => {
      setFlashingId(null);
      flashTimer.current = null;
    }, 1200);
  });

  async function handleDelete(schedule: Schedule) {
    const original = schedules;
    setSchedules(schedules.filter((s) => s.id !== schedule.id));
    setError(null);

    try {
      await deleteSchedule(schedule.id);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setError(`Delete failed: ${msg}`);
      setSchedules(original);
    }
  }

  return (
    <div>
      <ScheduleForm onCreated={() => { void refetch(); }} />
      {error && <p className="mb-1 text-[11px] text-accent-red">{error}</p>}
      {schedules.length === 0 ? (
        <p className="my-1 text-[11px] italic text-muted-2">No schedules.</p>
      ) : (
        <ul className="m-0 list-none p-0">
          {schedules.map((schedule) => (
            <li
              key={schedule.id}
              className={`mb-1 flex flex-col gap-1 rounded-[6px] border px-2 py-1.5 transition-colors ${schedule.id === flashingId ? 'border-accent/40 bg-accent/10' : 'border-line bg-white'}`}
            >
              <div className="flex items-center gap-2">
                <span className="flex-1 font-mono text-[11px] text-ink-2">{schedule.command}</span>
                <span className="flex-shrink-0 text-[10px] text-muted-2">{formatInterval(schedule.intervalSeconds)}</span>
                <button
                  type="button"
                  onClick={() => { void handleDelete(schedule); }}
                  title="Remove schedule"
                  aria-label={`Remove schedule: ${schedule.command}`}
                  className="flex h-4 w-4 flex-shrink-0 cursor-pointer items-center justify-center rounded-[4px] text-[13px] leading-none text-muted-2 transition hover:bg-accent-red/10 hover:text-accent-red"
                >×</button>
              </div>
              <div className="flex gap-3 text-[10px] text-muted-2">
                <span>last: {formatLastFired(schedule.lastEnqueuedAt)}</span>
                <span>next: {formatNextFire(schedule)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
