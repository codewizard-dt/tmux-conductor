// Pure ordering + localStorage persistence for the Agents page sidebar (TASK-0183).
// Agents are alphabetical by default; a user drag writes a flat list of agent ids, and only the
// relative order *within* a project group matters, so a single flat list is sufficient.
export const AGENT_ORDER_STORAGE_KEY = 'conductor:agentOrder'

export function compareByName(a: { name: string }, b: { name: string }): number {
  return a.name.toLowerCase().localeCompare(b.name.toLowerCase())
}

// Saved-order members first (in saved order), then everything else alphabetically. Saved ids with
// no matching agent are ignored. Neither input is mutated.
export function orderAgents<T extends { id: number; name: string }>(
  agents: readonly T[],
  saved: readonly number[],
): T[] {
  const savedIndex = new Map<number, number>()
  saved.forEach((id, index) => {
    if (!savedIndex.has(id)) savedIndex.set(id, index)
  })

  const ordered: T[] = []
  const rest: T[] = []
  for (const agent of agents) {
    if (savedIndex.has(agent.id)) ordered.push(agent)
    else rest.push(agent)
  }

  ordered.sort((a, b) => (savedIndex.get(a.id) ?? 0) - (savedIndex.get(b.id) ?? 0))
  rest.sort(compareByName)
  return [...ordered, ...rest]
}

// Returns the new stored list after moving `activeId` to `overId`'s slot within a project group.
// `fullGroupIds` is the group's complete current order (including rows hidden by filters), so
// hidden members keep their relative positions. Ids belonging to other groups already in `saved`
// are preserved. Returns `saved` unchanged for a no-op drop.
export function reorderGroup(
  fullGroupIds: readonly number[],
  activeId: number,
  overId: number,
  saved: readonly number[],
): number[] {
  const from = fullGroupIds.indexOf(activeId)
  const to = fullGroupIds.indexOf(overId)
  if (activeId === overId || from === -1 || to === -1) return [...saved]

  const moved = fullGroupIds.filter((id) => id !== activeId)
  moved.splice(to, 0, activeId)

  const group = new Set(fullGroupIds)
  return [...saved.filter((id) => !group.has(id)), ...moved]
}

export function loadOrder(): number[] {
  try {
    const raw = localStorage.getItem(AGENT_ORDER_STORAGE_KEY)
    if (raw === null) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const seen = new Set<number>()
    for (const entry of parsed as unknown[]) {
      if (typeof entry === 'number' && Number.isInteger(entry)) seen.add(entry)
    }
    return [...seen]
  } catch {
    return []
  }
}

export function saveOrder(ids: readonly number[]): void {
  try {
    localStorage.setItem(AGENT_ORDER_STORAGE_KEY, JSON.stringify(ids))
  } catch {
    // storage unavailable (private mode / quota) — the in-memory order still works for this session
  }
}

export function clearOrder(): void {
  try {
    localStorage.removeItem(AGENT_ORDER_STORAGE_KEY)
  } catch {
    // storage unavailable — nothing to clear
  }
}
