---
topic: Confirm the exact insertion anchor and response-shape convention in host-server/index.ts for a new GET /agents/:id/log endpoint that returns the persisted terminal-log history via TASK-106's listTerminalLog(db, agentId) helper
slug: terminal-log-history-endpoint
researched: 2026-07-06
---

# Primary Sources — GET /agents/:id/log insertion anchor and response shape

| ID | Type | Locator | Accessed | What it contributed |
|----|------|---------|----------|---------------------|
| S1 | codebase | `host-server/index.ts::/agents/:id/usage` route callback (lines 1517-1544 read window) | 2026-07-06 | Exact current line range of `/agents/:id/usage` (1531-1539), its validate-then-404 preamble and `{ agent, sessions }` response shape, the neighboring `/agents/:id/skills` route's `{ agent, workdir, project, user }` shape, the `GET /agents` list-all route immediately following, and the `./db.ts` named-import line (line 13) ending in `getAllAgentUsageTotals, listAgentUsage, type AgentUsageTotals` |
| S2 | codebase | `mcp__serena__search_for_pattern("listTerminalLog\|appendTerminalLogChunk\|AgentTerminalLog")` over `host-server/` | 2026-07-06 | Zero matches — confirms TASK-106's DB layer is not yet implemented in code, only planned in `wiki/work/tasks/TASK-106-agent-terminal-log-table.md` (status `todo`) |

## Excerpts

### S1 — host-server/index.ts, lines 1525-1544 (read via Read tool)
```
1525	    const project = getProjectSkills(entry.workdir);
1526	    const user = getUserSkills();
1527	    return reply.send({ agent: entry.name, workdir: entry.workdir, project, user });
1528	  });
1529	
1530	  // Per-session usage breakdown (agent_usage rows) for the dashboard detail modal.
1531	  api.get<{ Params: { id: string } }>('/agents/:id/usage', (req, reply) => {
1532	    const agentId = parseInt(req.params.id, 10);
1533	    if (isNaN(agentId)) return reply.status(400).send({ error: 'invalid agent id' });
1534	    const entry = getAgentById(db, agentId);
1535	    if (!entry) {
1536	      return reply.status(404).send({ error: `agent ${String(agentId)} not found` });
1537	    }
1538	    return reply.send({ agent: entry.name, sessions: listAgentUsage(db, agentId) });
1539	  });
1540	
1541	  // List all agents from the database.
1542	  api.get('/agents', (_req, reply) => {
1543	    return reply.send(listAgents(db));
1544	  });
```

### S1 — host-server/index.ts, line 13 (import statement, read via Read tool)
```
13	import { openDb, getDbPath, listAgents, getAgentById, createAgent, deleteAgent, updateAgentName, agentWindowName, addTask, deleteTask, reorderTasks, jumpTaskToHead, listTasksForAgentId, listTasksByProject, listProjects, createProject, updateProject, deleteProject, nextAgentName, listSchedules, createSchedule, updateSchedule, deleteSchedule, dueSchedules, fireSchedule, getAllAgentUsageTotals, listAgentUsage, type AgentUsageTotals } from './db.ts';
```

### S2 — search_for_pattern result
```
mcp__serena__search_for_pattern("listTerminalLog|appendTerminalLogChunk|AgentTerminalLog", relative_path="host-server") → {}
```
(empty result object — no matches anywhere under `host-server/`)
