---
id: UAT-092
title: "UAT: add local diagnostic bundle command"
status: passed
task: TASK-092
created: 2026-07-04
updated: 2026-07-04
---

# UAT-092 — UAT: add local diagnostic bundle command

implements::[[TASK-092]]

## Test Cases

### UAT-STATIC-001: Diagnostic script syntax passes
- **Command**:
  ```bash
  bash -n scripts/collect-diagnostics.sh
  ```
- **Expected Result**: Command exits 0.
- [x] Pass <!-- 2026-07-04 -->

### UAT-RUNTIME-001: Diagnostic bundle command exits successfully
- **Command**:
  ```bash
  npm run diagnostics:bundle
  ```
- **Expected Result**: Command exits 0 and writes a timestamped directory under `./tmp/diagnostics/`.
- [x] Pass <!-- 2026-07-04 -->
