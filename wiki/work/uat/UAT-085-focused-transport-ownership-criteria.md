---
id: UAT-085
title: "UAT: focused transport ownership acceptance criteria"
status: passed
task: TASK-085
created: 2026-07-04
updated: 2026-07-04
---

# UAT-085 — UAT: focused transport ownership acceptance criteria

implements::[[TASK-085]]

> **Source task**: [[TASK-085]]
> **Generated**: 2026-07-04

---

## Test Cases

### UAT-STATIC-001: Ownership contract is documented
- **Description**: Verifies the wiki names WebSocket ownership, SSE fallback, and regression evidence.
- **Command**:
  ```bash
  rg -q "Focused Ownership Contract" wiki/knowledge/concepts/focused-terminal-transport.md && rg -q "WebSocket-owned state" wiki/knowledge/concepts/focused-terminal-transport.md && rg -q "Fallback state" wiki/knowledge/concepts/focused-terminal-transport.md && rg -q "Regression evidence" wiki/knowledge/concepts/focused-terminal-transport.md
  ```
- **Expected Result**: Command exits 0.
- [x] Pass <!-- 2026-07-04 -->
