---
topic: Redesign the AgentDetail modal — terminal front-and-center/larger, reduce non-terminal noise, shrink Queued Tasks, default to Direct Input on open, double-click terminal to fullscreen
slug: agent-detail-modal-redesign
researched: 2026-08-15
---

# Primary Sources — AgentDetail Modal Redesign

| ID | Type | Locator | Accessed | What it contributed |
|----|------|---------|----------|---------------------|
| S1 | codebase | `frontend/src/components/AgentList.tsx::AgentDetailModal` (lines 514-869) | 2026-08-15 | Full modal structure: header row, top Details+Queued Tasks grid, LogTail slot, Skills/DiffPanel/UsageBreakdown/CheckpointList stack, `logExpanded`/`interacting` state ownership |
| S2 | codebase | `frontend/src/components/AgentList.tsx::isLogExpandShortcut` (lines 74-76) | 2026-08-15 | Modal-level ⌥F detection: `e.altKey && !e.metaKey && !e.ctrlKey && (e.code === 'KeyF' \|\| e.key.toLowerCase() === 'f')` |
| S3 | codebase | `frontend/src/components/LogTail.tsx::LogTail` (lines 135-749) | 2026-08-15 | `interacting` state init (`useState(false)`), `interactSignal` mount effect (~419-424), click-to-interact handler on `xtermContainerRef` (~660-664), `handleKeyDown`/`isExpandShortcut` wiring, header Live/History toggle, ⌥F kbd hint + icon button (~695-725), Direct Input toggle button in the bottom form (~742) |
| S4 | codebase | `frontend/src/components/LogTail.tsx::isExpandShortcut` (lines 12-14) | 2026-08-15 | Confirms LogTail's own ⌥F check is byte-identical duplicate logic to S2 |
| S5 | codebase | `mcp__serena__search_for_pattern` for `<LogTail` across `frontend/src/components` | 2026-08-15 | Confirms `LogTail` has exactly one render call site in the whole components tree — `AgentList.tsx:807` — so default-behavior changes inside `LogTail` have no other consumer to protect |
| S6 | codebase | `frontend/src/components/DiffPanel.tsx` (line 76) | 2026-08-15 | Confirms DiffPanel is already `<details className="mt-3 flex-shrink-0">`, collapsed by default |
| S7 | codebase | `frontend/src/components/CheckpointList.tsx` (lines 24, 84) | 2026-08-15 | Confirms CheckpointList is already `<details className="mt-3 flex-shrink-0">`; its own comment states it's a "Structural mirror of DiffPanel.tsx (both are agent-scoped `<details>` panels…)" |
| S8 | codebase | `frontend/src/components/AgentList.tsx::UsageBreakdown` (lines 365-424) | 2026-08-15 | Confirms UsageBreakdown is already `<details className="mt-3 flex-shrink-0">`, collapsed by default, returns `null` when no sessions |
| S9 | codebase | `frontend/src/components/AgentList.tsx` lines 926-938 (`AgentItem`, needs-attention CTA) | 2026-08-15 | Source of `armInteract` → the "Direct Input — needs you" card CTA that arms `interactSignal` on modal open today |
| S10 | codebase (image) | User-supplied screenshot, `tmp/dashboard-drops/1786832661409-Screenshot-2026-08-15-at-5.24.15-PM.png` | 2026-08-15 | Current rendered layout: header badges/buttons row, two-column Details+Queued Tasks block, Log Output header with Live/History + DEBUG + ⌥F hint + fullscreen icon, xterm terminal, bottom Send/Direct-Input bar, collapsed Skills/Changes/Usage rows |
