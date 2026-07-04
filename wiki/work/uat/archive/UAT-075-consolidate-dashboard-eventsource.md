---
id: UAT-075
title: "UAT: consolidate dashboard EventSource usage"
status: passed
task: TASK-075
created: 2026-06-28
updated: 2026-06-28
---

# UAT-075 — UAT: consolidate dashboard EventSource usage

implements::[[TASK-075]]

> **Source task**: [[TASK-075]]
> **Generated**: 2026-06-28

---

## Test Cases

### UAT-STATIC-001: Frontend typecheck passes
- **Command**:
  ```bash
  npm --prefix frontend run typecheck
  ```
- **Expected Result**: Command exits 0.
- [x] Pass <!-- 2026-06-28 -->

### UAT-STATIC-002: Frontend lint passes
- **Command**:
  ```bash
  npm --prefix frontend run lint
  ```
- **Expected Result**: Command exits 0.
- [x] Pass <!-- 2026-06-28 -->

### UAT-STATIC-003: Dashboard consumers do not instantiate EventSource directly
- **Command**:
  ```bash
  node -e "const fs=require('fs'); for (const file of ['frontend/src/lib/useAgents.ts','frontend/src/components/AgentList.tsx']) { if (fs.readFileSync(file,'utf8').includes('new EventSource')) process.exit(1) }"
  ```
- **Expected Result**: Command exits 0.
- [x] Pass <!-- 2026-06-28 -->
