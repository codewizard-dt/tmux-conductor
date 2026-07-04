---
id: UAT-092
title: "UAT: dashboard status display uses backend status fields"
status: passed
task: TASK-092
created: 2026-07-04
updated: 2026-07-04
---

# UAT-092 — UAT: dashboard status display uses backend status fields

implements::[[TASK-092]]

> **Source task**: [[TASK-092]]
> **Generated**: 2026-07-04

---

## Test Cases

### UAT-STATIC-001: Dashboard prefers backend status display
- **Command**:
  ```bash
  rg -q "agent.status\\) return agent.status.display" frontend/src/components/AgentList.tsx && rg -q "AgentStatusContract" frontend/src/lib/api.ts
  ```
- **Expected Result**: Command exits 0.
- [x] Pass <!-- 2026-07-04 -->
