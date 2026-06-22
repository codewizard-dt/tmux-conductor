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
import { deleteTask, reorderTasks, jumpTaskToHead, type Task } from '../lib/api';

interface SortableItemProps {
  id: string;
  text: string;
  isProject: boolean;
  onDelete: () => void;
  onJumpHead: () => void;
}

function SortableItem({ id, text, isProject, onDelete, onJumpHead }: SortableItemProps) {
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
      {isProject && (
        <span className="flex-shrink-0 rounded px-1 py-0.5 text-[10px] font-medium bg-violet-100 text-violet-700">
          project
        </span>
      )}
      <button
        type="button"
        onClick={onJumpHead}
        title="Move to front of queue"
        aria-label={`Move to front of queue: ${text}`}
        className="flex h-4 flex-shrink-0 cursor-pointer items-center justify-center rounded-[4px] px-1 text-[10px] leading-none text-muted-2 transition hover:bg-accent/10 hover:text-accent"
      >↑ head</button>
      <button
        type="button"
        onClick={onDelete}
        title="Remove task"
        aria-label={`Remove task: ${text}`}
        className="flex h-4 w-4 flex-shrink-0 cursor-pointer items-center justify-center rounded-[4px] text-[13px] leading-none text-muted-2 transition hover:bg-accent-red/10 hover:text-accent-red"
      >×</button>
    </li>
  );
}

export interface TaskListProps {
  agentName: string;
  tasks: Task[];
  onReorder: (newTasks: Task[]) => void;
}

function ScopedTaskGroup({
  tasks,
  allTasks,
  sensors,
  onReorder,
  onError,
}: {
  tasks: Task[];
  allTasks: Task[];
  sensors: ReturnType<typeof useSensors>;
  onReorder: (newTasks: Task[]) => void;
  onError: (msg: string) => void;
}) {
  const ids = tasks.map((t) => String(t.id));
  const isProject = tasks[0]?.projectId != null;

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = tasks.findIndex((t) => String(t.id) === String(active.id));
    const newIndex = tasks.findIndex((t) => String(t.id) === String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(tasks, oldIndex, newIndex);
    const otherTasks = allTasks.filter((t) =>
      isProject ? t.projectId == null : t.projectId != null
    );
    onReorder(isProject ? [...otherTasks, ...reordered] : [...reordered, ...otherTasks]);
    try {
      await reorderTasks(reordered.map((t) => t.id));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      onError(`Reorder failed: ${msg}`);
      onReorder(allTasks);
    }
  }

  async function handleDelete(task: Task) {
    onReorder(allTasks.filter((t) => t.id !== task.id));
    try {
      await deleteTask(task.id);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      onError(`Delete failed: ${msg}`);
      onReorder(allTasks);
    }
  }

  async function handleJumpHead(task: Task) {
    const otherTasks = allTasks.filter((t) => t.id !== task.id);
    onReorder([task, ...otherTasks]);
    try {
      await jumpTaskToHead(task.id);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      onError(`Move to front failed: ${msg}`);
      onReorder(allTasks);
    }
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => { void handleDragEnd(e); }}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ul className="m-0 list-none p-0">
          {tasks.map((task) => (
            <SortableItem
              key={task.id}
              id={String(task.id)}
              text={task.command}
              isProject={task.projectId != null}
              onDelete={() => { void handleDelete(task); }}
              onJumpHead={() => { void handleJumpHead(task); }}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

export default function TaskList({ tasks, onReorder }: TaskListProps) {
  const [error, setError] = React.useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const agentTasks = tasks.filter((t) => t.projectId == null);
  const projectTasks = tasks.filter((t) => t.projectId != null);

  if (tasks.length === 0) {
    return <p className="my-1 text-[11px] italic text-muted-2">No tasks in queue.</p>;
  }

  return (
    <div>
      {error && <p className="mb-1 text-[11px] text-accent-red">{error}</p>}
      {agentTasks.length > 0 && (
        <ScopedTaskGroup
          tasks={agentTasks}
          allTasks={tasks}
          sensors={sensors}
          onReorder={(next) => { setError(null); onReorder(next); }}
          onError={setError}
        />
      )}
      {projectTasks.length > 0 && (
        <ScopedTaskGroup
          tasks={projectTasks}
          allTasks={tasks}
          sensors={sensors}
          onReorder={(next) => { setError(null); onReorder(next); }}
          onError={setError}
        />
      )}
    </div>
  );
}