import React from 'react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { API_BASE } from '../lib/api';

interface SortableItemProps {
  id: string;
  text: string;
}

function SortableItem({ id, text }: SortableItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });

  return (
    <li
      ref={setNodeRef}
      className={`mb-1 flex items-center gap-2 rounded-[6px] border px-2 py-1.5 select-none transition-opacity ${isDragging ? 'border-accent/20 bg-surface opacity-80' : 'border-line bg-white'}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <span
        className="flex-shrink-0 cursor-grab text-[14px] leading-none text-muted-2"
        title="Drag to reorder"
        {...attributes}
        {...listeners}
      >⠿</span>
      <span className="flex-1 font-mono text-[11px] text-ink-2">{text}</span>
    </li>
  );
}

export interface TaskListProps {
  agentName: string;
  tasks: string[];
  onReorder: (newTasks: string[]) => void;
}

interface ApiErrorBody {
  error?: string;
}

export default function TaskList({ agentName, tasks, onReorder }: TaskListProps) {
  const [error, setError] = React.useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const ids = tasks.map((_, i) => String(i));

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = Number(active.id);
    const newIndex = Number(over.id);
    const newTasks = arrayMove(tasks, oldIndex, newIndex);
    const newOrder = arrayMove(tasks.map((_, i) => i), oldIndex, newIndex);

    onReorder(newTasks);
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/queue/${encodeURIComponent(agentName)}/reorder`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order: newOrder }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as ApiErrorBody;
        throw new Error(body.error ?? `HTTP ${res.status.toString()}`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setError(`Reorder failed: ${msg}`);
      onReorder(tasks);
    }
  }

  if (tasks.length === 0) {
    return <p className="my-1 text-[11px] italic text-muted-2">No tasks in queue.</p>;
  }

  return (
    <div>
      {error && <p className="mb-1 text-[11px] text-accent-red">{error}</p>}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => { void handleDragEnd(e); }}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <ul className="m-0 list-none p-0">
            {tasks.map((task, i) => (
              <SortableItem key={i} id={String(i)} text={task} />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
    </div>
  );
}