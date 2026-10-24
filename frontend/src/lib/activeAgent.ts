// The Agents page's selected agent's project id, shared with NavBar (TASK-0232).
// NavBar renders above the routes and cannot see AgentList's local selection state, so
// AgentList publishes only the derived projectId here and NavBar reads it to preselect the
// Project in the Add Agent modal. A no-op set keeps unrelated agent updates from re-rendering NavBar.
import { useSyncExternalStore } from 'react'

let activeProjectId: number | null = null
const listeners = new Set<() => void>()

export function getActiveAgentProjectId(): number | null {
  return activeProjectId
}

export function subscribeActiveAgent(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function setActiveAgentProjectId(id: number | null): void {
  if (id === activeProjectId) return
  activeProjectId = id
  for (const listener of [...listeners]) listener()
}

export function useActiveAgentProjectId(): number | null {
  return useSyncExternalStore(subscribeActiveAgent, getActiveAgentProjectId)
}
