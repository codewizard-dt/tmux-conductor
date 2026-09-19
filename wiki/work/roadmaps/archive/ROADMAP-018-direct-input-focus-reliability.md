---
id: ROADMAP-018
title: Direct Input Focus Reliability
aliases: [ROADMAP-018]
status: done
created: 2026-09-13
updated: 2026-09-13
owner: David Taylor
linked_requirements: []
linked_decisions: []
tags: [frontend, terminal, bug]
---

# Roadmap 018: Direct Input Focus Reliability

## Goal

Direct Input reliably captures keystrokes in every state — on modal open, after toggling fullscreen/expand, and across every other focus-transition scenario the Phase 0 audit surfaces — with no silent, unrecoverable focus loss.

## Phase 0: Audit

- [x] [[TASK-136: Audit every Direct Input focus-transition scenario]]

## Phase 1: Fix mount-time autofocus

- [x] [[TASK-137: Fix modal-open Direct Input autofocus race]]

## Phase 2: Fix xterm focus-steal

- [x] [[TASK-138: Fix xterm mousedown focus-steal while Direct Input is active]]

## Phase 3: Regression verification

- [x] [[TASK-139: Verify all Direct Input focus scenarios after the fix]]

## Notes

All 4 tasks closed via `/uat-walk` on 2026-09-13. Note for posterity: UAT-137's CTA/needs-attention autofocus path and UAT-138's `!interacting` click-to-arm path were never independently live-tested (no fabricated evidence was presented for them) — the user reviewed that gap explicitly during the walkthrough and chose to pass those cases anyway. Both originally reported bugs (modal-open autofocus, double-click-to-expand losing Direct Input) are confirmed fixed live.