---
id: add-bg-process-form
title: AddBgProcessForm
aliases: [AddBgProcessForm.tsx]
updated: 2026-09-18
sources:
  - ../../../raw/research/agents-page-sidebar-layout/index.md
confidence: extracted
tags: [frontend, component, form, bg-process]
---

# AddBgProcessForm

`AddBgProcessForm` — `frontend/src/components/AddBgProcessForm.tsx:24-234`. Form for spawning a background process (project select, name, workdir, launch command, optional linked agent behind a "Show advanced" disclosure). Unlike `AddAgentForm`, it takes **no `open`/`onClose` props** — it is mounted unconditionally on `AgentsPage` (`<AddBgProcessForm />`, `AgentsPage.tsx:22`) and always renders as an inline card.

**2026-09-18, `derived_from::[[agents-page-sidebar-layout]]`**: identified for conversion into a modal, mirroring `AddAgentForm`'s existing `open`/`onClose` pattern, with its trigger button moving into `derived_from::[[nav-bar]]` alongside "+ Add Agent" — a real (small) code change, not a pure relocation, since the component currently has no open/closed state of its own.

relates_to::[[agents-page-sidebar-layout]]
relates_to::[[nav-bar]]
