---
title: Roadmaps Index
updated: 2026-09-13
---

# Roadmaps — Active Items

Lists **only active** roadmaps (`active`). When a roadmap completes (`done`), delete its line here — the file itself never moves; status lives in its frontmatter. See the [lifecycle](lifecycle.md).

Entry format: `- [ROADMAP-NNN — Title](ROADMAP-NNN-slug.md) — one-line summary · N/M items checked`

- [ROADMAP-0023 — Replace the Agents Page Kanban Board with a Sidebar + Detail-Pane Layout](ROADMAP-0023-agents-page-sidebar-layout.md) — remove the Kanban columns for a project-grouped, status-bordered sidebar with the agent detail view moved into the main content area, Add Agent/Add Background Process moved into NavBar, and inactive agents folded into a collapsible sidebar section · 1/10 items checked
- [ROADMAP-0024 — Project-Linked Background Processes — Agent Access and Restart](ROADMAP-0024-project-bg-process-agent-restart.md) — any agent in a project can list, read output from, and safely restart its project's bg processes (server-side restart, real liveness, project-aware `dev-commands` skill, Background tab in the agent detail tablist) · 4/20 items checked
- [ROADMAP-0025 — Create a Worktree from Any Agent (Menu Action + Clone into New Worktree)](ROADMAP-0025-worktree-on-any-agent.md) — "create worktree" reachable from the agent actions menu with clear disabled states, "Clone into new worktree" on every agent, all worktrees created in a new sibling directory of the project root (never nested), live-agent cwd warning and teardown coverage · 0/10 items checked
- [ROADMAP-0026 — Orchestrator Agent Role — Fleet Lifecycle Management (Windows, Bg Processes, Enqueue, Status Watch)](ROADMAP-0026-orchestrator-role-fleet-control.md) — new `orchestrator` role: via a `fleet-control` skill an agent creates agents, opens/closes/reopens agent windows, opens/closes/restarts/tails bg processes, enqueues to workers (queue only) and watches worker status transitions, with server guardrails, audit log and a dashboard role badge · 0/26 items checked
- [ROADMAP-0027 — Show Each Agent's Last User-Written Payload (Persisted per Agent, Top Strip and Sidebar Card)](ROADMAP-0027-last-user-payload-per-agent.md) — capture the exact submitted prompt via the `UserPromptSubmit` hook, push it over SSE, store it per agent in localStorage, and show it (replacing `activeTask`) in the detail-pane strip and every sidebar card, full width and truncated · 0/12 items checked
