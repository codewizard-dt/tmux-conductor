---
id: TASK-002
title: "Add better-sqlite3 dependency, data/ gitignore entry, and DB_PATH setting"
status: done
created: 2026-06-12
updated: 2026-06-12
depends_on: []
blocks: [TASK-003, TASK-004, TASK-005]
parallel_safe_with: [TASK-001]
uat: ""
tags: [backend, sqlite, config]
---

# TASK-002 — Add better-sqlite3 dependency, data/ gitignore entry, and DB_PATH setting

## Objective

Install the `better-sqlite3` npm package and its TypeScript types into the backend, add the `data/` directory to `.gitignore` so the SQLite database file is never committed, and add a `DB_PATH` config setting to `conductor.conf`. These three changes are the prerequisite foundation before any DB code can be written in Phase 1.

## Approach

Straightforward dependency and config plumbing:
- `better-sqlite3` is a synchronous SQLite bindings library for Node.js — the chosen driver per ROADMAP-001 design decisions.
- `@types/better-sqlite3` provides TypeScript typings.
- `data/` gitignore entry prevents `./data/conductor.db` (WAL file + shm file) from leaking into version control.
- `DB_PATH` in `conductor.conf` makes the path overridable without code changes; backend resolves it relative to the conf file's directory (same pattern as `LOG_DIR`).

## Steps

### 1. Install npm dependencies  <!-- agent: general-purpose -->

- [x] In `backend/package.json`, add `"better-sqlite3": "^12.0.0"` to `dependencies` <!-- Completed: 2026-06-12 — bumped to ^12.0.0 for Node 26 support; added engines field and .nvmrc pinned to 26 -->
- [x] In `backend/package.json`, add `"@types/better-sqlite3": "^7.6.0"` to `devDependencies`
- [x] Run `cd backend && npm install` to update `package-lock.json` <!-- native binary built OK -->

### 2. Add data/ to .gitignore  <!-- agent: general-purpose -->

- [x] Read `.gitignore` at repo root <!-- Completed: 2026-06-12 -->
- [x] Add `data/` on a new line in the appropriate section (alongside other generated/runtime directories)
- [x] Use `Edit` tool (markdown/config file — not Serena)

### 3. Add DB_PATH to conductor.conf  <!-- agent: general-purpose -->

- [x] Read `conductor.conf` at repo root <!-- Completed: 2026-06-12 -->
- [x] Add `DB_PATH="./data/conductor.db"` after the `LOG_DIR` / `STATE_DIR` settings block
- [x] Use `Edit` tool (config file — not Serena)

### 4. Static verification  <!-- agent: general-purpose -->

- [x] Run `cd backend && npx tsc --noEmit` — passed clean <!-- Completed: 2026-06-12 -->
- [x] Confirm `data/` appears in `.gitignore` by running `git check-ignore -v data/conductor.db`
