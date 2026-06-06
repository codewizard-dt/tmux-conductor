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

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 8px',
    background: isDragging ? '#f0f4ff' : '#fff',
    border: '1px solid #ddd',
    borderRadius: '4px',
    marginBottom: '4px',
    opacity: isDragging ? 0.8 : 1,
    cursor: 'default',
    userSelect: 'none',
  };

  const handleStyle: React.CSSProperties = {
    cursor: 'grab',
    color: '#888',
    fontSize: '16px',
    lineHeight: 1,
    padding: '0 2px',
    flexShrink: 0,
  };

  return (
    <li ref={setNodeRef} style={style}>
      <span
        style={handleStyle}
        title="Drag to reorder"
        {...attributes}
        {...listeners}
      >
        ⠿
      </span>
      <span style={{ flex: 1, fontSize: '13px', fontFamily: 'monospace' }}>{text}</span>
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
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    })
  );

  // Use index-based IDs so each item is uniquely identified even with duplicate text
  const ids = tasks.map((_, i) => String(i));

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = Number(active.id);
    const newIndex = Number(over.id);

    const newTasks = arrayMove(tasks, oldIndex, newIndex);

    // Build index order array: newOrder[i] = original index that now sits at position i
    const newOrder = arrayMove(
      tasks.map((_, i) => i),
      oldIndex,
      newIndex
    );

    // Optimistically update
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
      // Rollback
      onReorder(tasks);
    }
  }

  if (tasks.length === 0) {
    return (
      <p style={{ fontSize: '12px', color: '#999', margin: '4px 0' }}>
        No tasks in queue.
      </p>
    );
  }

  return (
    <div>
      {error && (
        <p style={{ color: 'red', fontSize: '12px', margin: '4px 0' }}>{error}</p>
      )}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => { void handleDragEnd(e); }}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {tasks.map((task, i) => (
              <SortableItem key={i} id={String(i)} text={task} />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
    </div>
  );
}
