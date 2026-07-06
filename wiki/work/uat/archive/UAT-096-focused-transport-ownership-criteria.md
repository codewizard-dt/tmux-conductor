---
id: UAT-096
title: "UAT: focused transport ownership acceptance criteria"
status: passed
task: TASK-096
created: 2026-07-04
updated: 2026-07-04
---

# UAT-096 — UAT: focused transport ownership acceptance criteria

implements::[[TASK-096]]

> **Source task**: [[TASK-096]]
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

### Renumbering note

Originally filed as `UAT-085`. Renumbered to `UAT-096` on 2026-07-06 to resolve an ID collision with an unrelated ROADMAP-016 UAT that was independently assigned the same number the same day.
