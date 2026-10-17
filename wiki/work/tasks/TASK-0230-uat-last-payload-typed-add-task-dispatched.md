---
id: TASK-0230
aliases: [TASK-0230]
title: "Run UAT for typed, Add Task and queue-dispatched last payloads plus the no-payload empty state"
status: todo
created: 2026-09-20
updated: 2026-09-20
depends_on: [TASK-0229]
blocks: []
parallel_safe_with: []
uat: ""
tags: [last-payload, agents, dashboard, hooks, uat, verification, roadmap-0027]
---

# TASK-0230 — Run UAT for typed, Add Task and queue-dispatched last payloads plus the no-payload empty state

relates_to::[[hook-authoritative-last-prompt]]
relates_to::[[last-user-message-capture]]
depends_on::[[TASK-0229]]

> **Roadmap**: ROADMAP-0027 Phase 4, item 2 (the closing task). Every earlier ROADMAP-0027 task (TASK-0219..0229) defers its live check (real hook, real agents, a browser reload) to this UAT, so it runs last. Research: `raw/research/last-user-message-capture/index.md`, `raw/research/terminal-typed-command-persistence/index.md`.
> **Type**: consolidating UAT task, modelled on TASK-0218. **No production code.** The only files written are the UAT file and this task file.

## Objective

Prove end to end that each agent keeps and shows its last user-written payload: a message typed into Direct Input, a submission through the Add Task box and a queue-dispatched command are each captured (typed and dispatched through the `UserPromptSubmit` hook sidecar `last_prompt` -> host-server `lastPrompt` -> SSE -> `localStorage`; Add Task at submit time), shown in the detail-pane strip and the sidebar agent card in place of `activeTask`, kept per agent, and survive a page reload. Also prove the empty state (an agent with no payload renders no strip and no card line), the storage rules from the TASK-0220 decision (newest `ts` wins, 2000-char cap, first line + ` …` with the full text in `title`, empty never overwrites) and the failure modes (agent delete clears the key, a clone starts empty, throwing `localStorage` degrades silently). Deliverables: one consolidated UAT file, the run results recorded in it, and any failures filed as bugs.

## Approach

- **One consolidated UAT.** Generate `wiki/work/uat/UAT-0230-last-payload-typed-add-task-dispatched.md` via `/uat-generate TASK-0230` (frontmatter `status: pending`, `task: TASK-0230`, `implements::[[TASK-0230]]`, same layout as `UAT-0201`), consolidating the `[DEFERRED-TO-UAT]` lines from TASK-0219..0229. Set this task's `uat:` to `[[UAT-0230]]` and its status to `pending-uat` when the file is written.
- **Unit-backed first, live only where a unit cannot reach.** Each case names its deterministic half in a `Repeatable Unit Test` line and carries a `Gap` note where only the live fleet proves it. The unit-backed halves are: `host-server/hookLastPrompt.test.ts` (hook sidecar write, cap, empty/whitespace/non-string prompt, other events leave `last_prompt` untouched, exit 0 on corrupt sidecar), `host-server/lastPrompt.test.ts` (sidecar reader, defensive nulls, cap), `host-server/agentDiff.test.ts` and the SSE parity test (`sseRolePayloadParity.test.ts` or `sseLastPromptParity.test.ts`, whichever TASK-0222 shipped), `frontend/src/lib/lastPayload.test.ts` (store: newest wins, cap, blank ignored, throwing storage, per-agent isolation, listener/`storage` event, `firstLine`/`firstLinePreview`, `useLastPayload`), `frontend/src/components/AddTaskForm.test.tsx` (Add Task recording, project-scope not recorded, failed submit not recorded) and `frontend/src/components/AgentList.test.tsx` (SSE mirror, strip, card, empty state, multi-line, reload simulation, delete clears the key, clone separate). Re-locate the exact test files and helper names with Serena before writing the UAT; the helper is named `firstLinePreview` in the TASK-0220 decision and `firstLine` in TASK-0224, so use whatever `frontend/src/lib/lastPayload.ts` actually exports.
- **Mixed verification.** Cases with a runnable command (`node --import tsx/esm --test ...`, `npx vitest run ...`, `curl`, `jq`, reading a sidecar file) carry a `**Command**` block and are run with `/uat-auto`. UI cases (strip, card, reload, two browser tabs, theme, truncation) are UAT-UI cases walked with `/uat-walk` (Playwright MCP where possible). Cases that need real Claude Code agents with the freshly installed hook are **manual, human-only** and marked deferred in the UAT with exact steps; an autonomous agent records them as `deferred` and never performs them.
- **Isolation for anything scripted.** Fixtures and scratch files live under `./tmp/uat-0230/` (never `/tmp`). Scripted checks use a temp `CONDUCTOR_STATE_DIR` / `CONDUCTOR_LOG_DIR` under `./tmp/uat-0230/` and spawn the repo's `hooks/on-prompt-submit.js` directly, exactly like `host-server/hookLastPrompt.test.ts`; they never write the real `logs/state/`. Live cases use throwaway agents named `uat0230-*`, and never touch the user's real agents.
- **Slash commands follow TASK-0219's findings.** TASK-0219's `## Findings` decides whether a typed `/command` fires `UserPromptSubmit`. The UAT case is written to that result: if it fires, expect the raw `/command args` text in the strip and card; if it does not and a `UserPromptExpansion` registration was added, expect the reconstructed text; if it does not and no registration exists, expect the payload to stay unchanged and record that as a documented gap, not a failure. Read TASK-0219's Findings (and its manual recipes M2, M3, M5) before drafting this case.
- **Failures.** A failing case is not patched inside this task: file it with `/bug-file` (or fold it into the owning task if still open), record the verdict in the UAT, and leave this task `pending-uat` until re-run.

## Steps

### 1. Read inputs  <!-- agent: Explore -->

- [ ] With Serena, read the final state of TASK-0219..0229 (step notes and every `[DEFERRED-TO-UAT]` line) and list each deferred live check; every one must map to a case below.
- [ ] Read TASK-0219's `## Findings` (slash-command result, `Up`-recall result, dispatch byte-identity, payload shape) and the TASK-0220 `## Decision` rules a-f.
- [ ] Verify by symbol (line numbers drift, other agents edit this repo concurrently): `hooks/lib/write-state.js::writeState` sidecar merge sets `meta.last_prompt`; `host-server/lastPrompt.ts::readLastPrompt` exists; `lastPrompt` is on `Snapshot`, `buildSnapshot`, both SSE builders and the diff predicate in `host-server/index.ts`; `frontend/src/lib/lastPayload.ts` exports `useLastPayload`, `saveLastPayload`, `loadLastPayload`, `clearLastPayload`; the detail strip is in `AgentDetailView` and the card line is in `AgentItem` in `frontend/src/components/AgentList.tsx`.
- [ ] Read `wiki/work/uat/UAT-0201-collapsible-agent-sidebar.md` for the layout and `wiki/work/tasks/TASK-0218-uat-worktree-menu-and-clone-flow.md` for the consolidating-UAT style.

### 2. Generate the UAT file  <!-- agent: general-purpose -->

- [ ] Run `/uat-generate TASK-0230` and ensure the resulting `UAT-0230-last-payload-typed-add-task-dispatched.md` contains at least these cases (tag each with the task it verifies):
  1. **Setup** — automated unit gates green first (`cd host-server && npm test`, `cd frontend && npx vitest run`, typecheck and lint for both); dev stack running on the user's ports or an isolated one; scratch dir `./tmp/uat-0230/`; **human-only prerequisite, documented not performed:** `install-hooks.sh` re-run against the real `~/.claude` and the test agents restarted so the hook edit is live (hook config is snapshotted at session start); throwaway agents `uat0230-a`, `uat0230-b` (both hook-capable, distinct windows) and `uat0230-empty` (never sent anything).
  2. **Typed Direct Input message, strip and card, after reload** (0221, 0222, 0225, 0226, 0227) — in `uat0230-a` Direct Input type a message and press Enter; within about 3 s the strip at the top of the detail pane and the sidebar card show it (first line, full width, truncated); `<STATE_DIR>/uat0230-a.meta.json` has `last_prompt.text` equal to the message and an ISO `ts`; reload the page and both places still show it, with no agent activity in between; it stays after the agent goes idle (retained until replaced). Unit-backed by `hookLastPrompt.test.ts`, `lastPrompt.test.ts`, `lastPayload.test.ts`, `AgentList.test.tsx`; **Gap:** the real hook + live SSE round trip.
  3. **Add Task submission recorded** (0223, 0224) — submit a task from `uat0230-a`'s Add Task box (idle agent, so it is typed straight into the pane, and once with a busy agent so it is queued); the strip and card show that text immediately, before the ~2 s poll tick (`localStorage['conductor:lastPayload:<id>']` has `source: 'add-task'`); after the hook delivers the same text with a newer `ts` the source becomes `hook` and the display does not flicker; a project-scoped submit and a failed submit (host-server request rejected) change nothing. Unit-backed by `AddTaskForm.test.tsx`; **Gap:** live display timing.
  4. **Queue-dispatched command recorded** (0221, 0222; mirrors TASK-0219's M4) — queue a task for `uat0230-a` while it is busy, let the monitor/host-server dispatch it when idle; the strip and card switch to the dispatched command text and `last_prompt.text` in the sidecar matches the dispatched text; the dispatch is recorded as a `hook` source (the hook cannot tell typed from dispatched). Cross-check the text against the matching `dispatch.jsonl` record (read-only). Unit-backed by `hookLastPrompt.test.ts`; **Gap:** manual/live only.
  5. **Two agents isolated** (0224, 0225) — type different messages into `uat0230-a` and `uat0230-b`; each agent's strip and card show only its own text, `localStorage` has two distinct `conductor:lastPayload:<id>` keys, and selecting the other agent swaps the strip. Unit-backed by `lastPayload.test.ts` and `AgentList.test.tsx`; **Gap:** live.
  6. **Multi-line: first line + ellipsis, full text in `title`** (0226, 0227; decision c) — submit a multi-line message (Add Task box with real newlines, plus a bracketed paste in Direct Input per TASK-0219's M2 finding); the strip and card show the first non-empty line followed by ` …`; hovering shows the full text as the `title`; a leading blank line is skipped; a payload over 200 characters truncates with an ellipsis and does not widen the 320 px card or the strip. Unit-backed by `lastPayload.test.ts` (`firstLine`/`firstLinePreview`) and `AgentList.test.tsx`.
  7. **No-payload empty state** (0226, 0227) — `uat0230-empty` (and any agent with nothing stored, including hook-less ones): no strip renders (no empty bar, no placeholder), and the sidebar card renders no extra line, so the card looks exactly like it did before; `activeTask` alone does not bring the strip back; clear the key in devtools and reload to re-check. Unit-backed by `AgentList.test.tsx`.
  8. **Newest timestamp wins between sources** (0224, 0225; decision a) — with a stored `add-task` value newer than the incoming SSE `lastPrompt`, the stored value stays; a newer hook value replaces an older Add Task value; an equal `ts` from the hook wins the tie. Because a live run cannot easily force the clock, drive this through the unit tests (`lastPayload.test.ts`, the SSE-mirror cases in `AgentList.test.tsx`) and additionally seed `localStorage` by hand in the browser with a future `ts` and confirm a subsequent hook prompt at real time does not replace it, then remove the seeded key. **Gap:** hand-seeded future timestamp only.
  9. **Agent delete clears the key; clone starts empty** (TASK-0228) — delete `uat0230-b` from the dashboard: `conductor:lastPayload:<id>` is removed and no stale payload appears if the id is reused; clone `uat0230-a`: the clone's strip and card are empty (no key for the clone's id), the source keeps its payload, and a message typed into the clone shows only on the clone. Use only agents clearly named `uat0230-*`; per the known clone-shares-workdir behaviour, do not dispatch queued tasks to a clone without checking its worktree first. Unit-backed by `AgentList.test.tsx`.
  10. **Malformed and throwing `localStorage` degrades silently** (0224, 0225) — corrupt the stored value (invalid JSON, wrong shape, missing `ts`) for an agent and reload: no strip, no console error that breaks the page, no crash, and the next real prompt overwrites it; simulate `localStorage` throwing (devtools/Playwright override of `Storage.prototype.getItem`/`setItem`) and confirm the dashboard still renders and the agent list keeps updating. Unit-backed by `lastPayload.test.ts` (throwing `getItem`/`setItem`/`removeItem`, corrupt JSON).
  11. **Slash-command behaviour per TASK-0219's findings** (0219, 0221) — type `/spike-echo`-style and a built-in slash command in `uat0230-a` Direct Input; the outcome matches the case written from TASK-0219's `## Findings` (see Approach). Record the observed hook events and sidecar value; a documented, expected non-capture is a `pass`-with-note, an unexpected mismatch is a failure. **Gap:** live only; human-only.
  12. **Hook sidecar cap and empty-prompt behaviour** (0221; decisions b, f) — scripted against a temp state dir: feed `hooks/on-prompt-submit.js` a 5000-char prompt (stored `last_prompt.text` is exactly 2000 chars, the `…` marker within the cap), an empty string, whitespace-only, missing and non-string prompts (a previous `last_prompt` is unchanged; none is created when there was none), a multi-line prompt (stored verbatim), and `on-stop.js` with no `prompt` (previous `last_prompt` byte-identical, `meta.ts` refreshed); exit status 0 for a corrupt pre-existing `meta.json`. Command: `cd host-server && node --import tsx/esm --test hookLastPrompt.test.ts` plus a direct `spawnSync`-style repro under `./tmp/uat-0230/`.
  13. **Regressions and cleanup** — `npm test` in `host-server/` and `npx vitest run` in `frontend/` green; no console errors on the Agents page; the sidebar 48 px collapsed rail still shows dots only (no payload text); delete `uat0230-*` agents, `rm -rf ./tmp/uat-0230`, remove any hand-seeded `localStorage` keys, and confirm no `uat0230` tmux windows and no stray sidecars remain and the user's real agents were never touched.
- [ ] Add a **Repeatable Unit Test / Verify script** line to each case pointing at its deterministic half, and a "Gap" note where only the live fleet proves it. Mark the live cases (2, 3, 4, 5, 9, 11 and the live half of 6, 7, 10) as manual/human-only, with exact steps, in the UAT.

### 3. Run and record  <!-- agent: general-purpose -->

- [ ] Run the scripted cases (12, the unit-gate parts of 1 and 13, and any `curl`/sidecar checks) with `/uat-auto` and the browser cases that can be driven without the live fleet (7 empty state with a seeded/blank store, 10 corrupt storage, 6 rendering from a seeded `localStorage` value) with `/uat-walk` against the running dashboard. Do not run the human-only live cases; record them as `deferred` with the reason "requires live hook install and agent restart, performed by a human".
- [ ] Record pass/fail/deferred per case in `UAT-0230-...md`; file failures with `/bug-file`. Confirm the cleanup case left `./tmp/` clean.
- [ ] On an all-pass run (deferred human cases completed by the user) the standard `uat-*` flow closes TASK-0230 and ticks the roadmap item; do not tick it by hand.

## Files

- `wiki/work/tasks/TASK-0230-uat-last-payload-typed-add-task-dispatched.md` (this file)
- `wiki/work/uat/UAT-0230-last-payload-typed-add-task-dispatched.md` (new, created later by `/uat-generate`)
- `wiki/work/uat/index.md` (via `/uat-generate`, orchestrator-owned)

Scratch only (gitignored, deleted in the cleanup case): `./tmp/uat-0230/`. No production code, `hooks/`, `host-server/`, `frontend/`, `scripts/` or `~/.claude` file is touched.

## Dependencies

- TASK-0229

TASK-0229 is the last implementation-side task (the round-trip verification), so by the time it is done TASK-0219..0228 are already merged. This task blocks nothing. It runs against a live browser and, for the human cases, a live fleet, so it must not run in parallel with any task that restarts the dev server or edits `frontend/src/components/AgentList.tsx`.

## Notes

Guardrails for whoever implements this:

- **Never run `install-hooks.sh` against the real `~/.claude`, and never edit `~/.claude/settings.json`.** Re-installing the hooks and restarting agents is a documented human prerequisite in the UAT (case 1), not something an autonomous agent does. Scripted hook checks use a temp `CONDUCTOR_STATE_DIR` under `./tmp/uat-0230/` and the repo copy of the hook scripts.
- **Never kill or restart tmux windows or sessions, or the running host-server / dev servers** (`make dev`); other agents work in them concurrently and the dev servers hot-reload.
- **Live-fleet verification is a documented UAT step for a human, not something an autonomous agent performs.** An agent running this task generates the UAT, runs the scripted and browser-only cases, and records the live cases as `deferred`.
- Temporary files and fixtures go under `./tmp/`, never `/tmp` or `$TMPDIR`. Create files with `Write`, not shell redirection.
- Stored prompts can contain secrets (TASK-0220 decision d: no redaction). Use only innocuous test strings, do not paste real content into the UAT file, and delete `./tmp/uat-0230/` at the end.
- The store key is `conductor:lastPayload:<agentId>`. TASK-0224 types `agentId` as a number and TASK-0225..0228 call it with `agent.id` (reconciled by the orchestrator; the shared helper is `firstLinePreview`). The UAT asserts on the key string only.
- Follow `wiki/guides/mcp-tools.md`: Serena for code exploration, `Read`/`Edit`/`Write` for markdown and config files.
