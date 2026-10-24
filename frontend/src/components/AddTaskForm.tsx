import React from 'react';
import { addTask, uploadImageForPath, type Task } from '../lib/api';
import { saveLastPayload } from '../lib/lastPayload';

export interface AddTaskFormProps {
  agentId: number;
  onAdded: (task: Task) => void;
  projectId?: number | null;
  projectName?: string | null;
  /** Root element classes; defaults to `mt-2`. */
  className?: string;
}

export default function AddTaskForm({ agentId, onAdded, projectId, projectName, className }: AddTaskFormProps) {
  const [value, setValue] = React.useState(() => {
    try { return localStorage.getItem(`conductor:taskDraft:${agentId.toString()}`) ?? '' } catch { return '' }
  });
  const [scope, setScope] = React.useState<'agent' | 'project'>('agent');
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [dispatched, setDispatched] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [dragOver, setDragOver] = React.useState(false);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const uploadQueueRef = React.useRef<Promise<void>>(Promise.resolve());

  React.useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    // AgentInfoTabs keeps every tab panel mounted and toggles `hidden` (display:none)
    // rather than unmounting the inactive ones (TASK-157-ish "always mounted" tab
    // design), so this effect can fire while the Terminal panel (or the no-window
    // fallback in it) — and this textarea inside it — is display:none. scrollHeight reads 0 for any element
    // in a display:none subtree; writing that straight to `style.height` would
    // pin the textarea at ~0px (masked only by the CSS min-h-7 floor) until the
    // next value change recomputes it. Skip the write when scrollHeight is 0 so a
    // hidden mount never clobbers the height — it gets measured for real once the
    // tab is switched to and the textarea is actually laid out (its own next
    // value change, or the layout effect below, re-runs the measurement).
    const maxH = 88;
    if (el.scrollHeight > 0) {
      el.style.height = `${String(Math.min(el.scrollHeight, maxH))}px`;
      el.style.overflowY = el.scrollHeight > maxH ? 'auto' : 'hidden';
    }
  }, [value]);

  // Re-measure once the textarea actually becomes visible (e.g. switching into the
  // Terminal tab after mounting while its panel was `hidden`), since the effect
  // above only re-runs on `value` changes and may have skipped its write while
  // hidden. A ResizeObserver fires when a display:none element's box resolves to
  // its real size, which naturally covers the tab-switch case with no visibility
  // plumbing threaded down from AgentInfoTabs.
  React.useEffect(() => {
    const el = textareaRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const maxH = 88;
    const observer = new ResizeObserver(() => {
      if (el.scrollHeight === 0) return;
      el.style.height = 'auto';
      el.style.height = `${String(Math.min(el.scrollHeight, maxH))}px`;
      el.style.overflowY = el.scrollHeight > maxH ? 'auto' : 'hidden';
    });
    observer.observe(el);
    return () => { observer.disconnect(); };
  }, []);

  function insertAtCaret(text: string) {
    const el = textareaRef.current;
    if (!el) {
      setValue((v) => v + text);
      return;
    }
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const next = value.slice(0, start) + text + value.slice(end);
    setValue(next);
    try { localStorage.setItem(`conductor:taskDraft:${agentId.toString()}`, next) } catch { /**/ }
    // Restore caret after state update
    requestAnimationFrame(() => {
      el.selectionStart = el.selectionEnd = start + text.length;
    });
  }

  function enqueueImageUploads(files: FileList): boolean {
    const images = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (images.length === 0) return false;
    setUploading(true);
    setError(null);
    for (const file of images) {
      uploadQueueRef.current = uploadQueueRef.current
        .then(() => uploadImageForPath(agentId, file))
        .then((filePath) => { insertAtCaret(`${filePath} `); })
        .catch((err: unknown) => {
          setError(err instanceof Error ? err.message : 'Failed to upload image');
        });
    }
    uploadQueueRef.current = uploadQueueRef.current.then(() => { setUploading(false); });
    return true;
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    setDragOver(true);
  }

  function handleDragLeave() { setDragOver(false); }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    if (!enqueueImageUploads(e.dataTransfer.files)) {
      setError('Only image files can be dropped here');
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    if (e.clipboardData.files.length > 0 && enqueueImageUploads(e.clipboardData.files)) {
      e.preventDefault();
    }
  }

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;

    setSubmitting(true);
    setError(null);

    try {
      const projectScoped = scope === 'project' && projectId != null;
      const opts = projectScoped ? { projectId } : { agentId };
      const result = await addTask(trimmed, opts);
      // Agent-scoped submits only. A project-scoped task is run by whichever project
      // agent pops it first, so it is not this agent's payload; the form cannot create
      // global tasks. The hook later re-delivers the same text with a newer ts, and the
      // store's newest-ts-wins rule reconciles the two.
      if (!projectScoped) {
        saveLastPayload(agentId, { text: trimmed, ts: new Date().toISOString(), source: 'add-task' });
      }
      setValue('');
      try { localStorage.removeItem(`conductor:taskDraft:${agentId.toString()}`) } catch { /**/ }

      if (result.dispatched) {
        setDispatched(true);
        setTimeout(() => { setDispatched(false); }, 2000);
      } else if (result.task) {
        onAdded(result.task);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to add task';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  const hasValue = value.trim().length > 0;
  const busy = submitting || uploading;

  return (
    <div className={className ?? 'mt-2'}>
      {projectId != null && projectName != null && (
        <div className="mb-1.5 flex gap-1">
          <button
            type="button"
            onClick={() => { setScope('agent'); }}
            className={`inline-flex gap-1 h-6 cursor-pointer items-center rounded-[7px] px-2.5 text-[11px] font-medium transition active:scale-[0.985] ${scope === 'agent'
              ? 'bg-accent-blue text-white'
              : 'border border-line bg-card text-ink-2 hover:bg-canvas'
              }`}
          >
            <b>this agent</b> <span className="opacity-50">(local)</span>
          </button>
          <button
            type="button"
            onClick={() => { setScope('project'); }}
            className={`inline-flex gap-1 h-6 cursor-pointer items-center rounded-[7px] px-2.5 text-[11px] font-medium transition active:scale-[0.985] ${scope === 'project'
              ? 'bg-accent-blue text-white'
              : 'border border-line bg-card text-ink-2 hover:bg-canvas'
              }`}
          >
            <b>{projectName}</b> <span className="opacity-50">(project)</span>
          </button>
        </div>
      )}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`rounded-[7px] transition ${dragOver ? 'ring-[3px] ring-accent-blue' : ''}`}
      >
        <form onSubmit={(e) => { void handleSubmit(e); }} className="flex items-end gap-1.5">
          <textarea
            ref={textareaRef}
            placeholder={uploading ? 'Uploading image…' : 'New task…'}
            value={value}
            rows={1}
            onChange={e => {
              const v = e.target.value;
              setValue(v);
              setError(null);
              try { localStorage.setItem(`conductor:taskDraft:${agentId.toString()}`, v) } catch { /**/ }
            }}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void handleSubmit(e as unknown as React.SyntheticEvent<HTMLFormElement>);
              }
            }}
            onPaste={handlePaste}
            className="min-h-7 flex-1 resize-none overflow-hidden rounded-[7px] border border-line-input bg-card px-2.5 py-1 font-mono text-[12px] text-ink placeholder:text-muted-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/10 disabled:opacity-40"
            disabled={busy}
            aria-label="New task text"
          />
          <button
            type="submit"
            disabled={!hasValue || busy}
            className="inline-flex h-7 cursor-pointer items-center rounded-[7px] bg-button-primary px-3 text-[12px] font-medium text-button-primary-text transition hover:opacity-90 active:scale-[0.985] disabled:pointer-events-none disabled:opacity-40"
            aria-label="Add task"
          >
            {submitting ? '…' : 'Add'}
          </button>
        </form>
      </div>
      {error && (
        <p className="mt-1 text-[11px] text-accent-red">{error}</p>
      )}
      {dispatched && (
        <p className="mt-1 text-[11px] text-green-600">Started immediately</p>
      )}
    </div>
  );
}
