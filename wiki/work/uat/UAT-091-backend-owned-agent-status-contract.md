---
id: UAT-091
title: "UAT: backend-owned agent status contract"
status: passed
task: TASK-091
created: 2026-07-04
updated: 2026-07-04
---

# UAT-091 — UAT: backend-owned agent status contract

implements::[[TASK-091]]

> **Source task**: [[TASK-091]]
> **Generated**: 2026-07-04

---

## Test Cases

### UAT-STATIC-001: Backend emits structured status evidence
- **Command**:
  ```bash
  rg -q "interface AgentStatusContract" host-server/index.ts && rg -q "buildAgentStatusContract" host-server/index.ts && rg -q "stateFile" host-server/index.ts && rg -q "needsAttention" host-server/index.ts
  ```
- **Expected Result**: Command exits 0.
- [x] Pass <!-- 2026-07-04 -->
