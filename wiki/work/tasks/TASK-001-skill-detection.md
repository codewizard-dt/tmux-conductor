---
id: TASK-001
title: "Skill detection — backend scanner + dashboard surfacing"
status: in-progress
created: 2026-06-12
updated: 2026-06-12
depends_on: []
blocks: []
parallel_safe_with: []
uat: "../uat/UAT-001-skill-detection.md"
tags: [backend, frontend, skills]
---

# TASK-001 — Skill detection — backend scanner + dashboard surfacing

## Objective

Add Claude Code skill detection to the conductor system. The backend scans `~/.claude/skills` (user-global skills) and per-agent `<workdir>/.claude/skills` (project skills), exposes two new Fastify endpoints, and the frontend surfaces the skill list inside the existing `AgentDetailModal` so operators can see what skills each agent has available — and optionally dispatch a skill invocation directly from the dashboard.

## Approach

- **Detection method:** filesystem scan only — no `claude --list-skills` CLI command exists; directory scanning is the canonical approach. Each skill is a directory containing `SKILL.md`; the directory name is the invocation name.
- **Frontmatter parsing:** hand-rolled (no new deps). Split on `---` delimiters, parse `key: value` lines; handle the `|` block-scalar for multi-line `description`. Fits the repo's dependency-light style.
- **Caching:** TTL-based (60 s), mirroring the `readConductorConf()` pattern in `backend/config.ts`.
- **Scope:** user skills (`~/.claude/skills`) are global; project skills are scoped to the agent's `workdir` (walk up to git root to catch parent-repo `.claude/skills` dirs).
- **Plugin skills:** scan defensively (`~/.claude/plugins/*/skills/`) but expect empty in most environments — returned as `plugin: Skill[]` in `/skills`.
- **Frontend:** augment the existing `AgentDetailModal` in `frontend/src/components/AgentList.tsx`; lazy-fetch on open, same pattern as the existing `/diff` fetch.

## Steps

### 1. Create `backend/skills.ts`  <!-- agent: general-purpose -->

- [x] Define `Skill` interface:
  ```ts
  interface Skill {
    name: string;           // dir name = invocation name
    title?: string;         // frontmatter `name:` field
    description?: string;
    userInvocable: boolean; // frontmatter `user-invocable:` (default true)
    autoOnly: boolean;      // frontmatter `disable-model-invocation:` (default false)
    source: 'user' | 'project' | 'plugin';
  }
  ```
- [x] Implement `parseFrontmatter(content: string): Record<string, string>`:
  - Find first and second `---` delimiter lines.
  - Between them, split by line; collect `key: value` pairs (trim whitespace).
  - Handle YAML block scalar `|`: the value starts on the next line(s) indented with at least two spaces; join them into a single string.
  - Return empty object if no valid frontmatter found.
- [x] Implement `scanSkillDir(dir: string, source: Skill['source']): Skill[]`:
  - `readdirSync(dir, { withFileTypes: true })` — catch ENOENT, return `[]`.
  - For each entry that is a directory, check `<dir>/<entry>/SKILL.md` exists.
  - Read the file, call `parseFrontmatter`, map to `Skill`.
  - Boolean frontmatter fields: `user-invocable` defaults to `true`; `disable-model-invocation` defaults to `false`.
- [x] Implement `getUserSkills(): Skill[]` — scan `path.join(os.homedir(), '.claude', 'skills')` with source `'user'`.
- [x] Implement `getPluginSkills(): Skill[]` — glob `~/.claude/plugins/*/skills/*/SKILL.md` defensively (readdirSync two levels, catch ENOENT), source `'plugin'`.
- [x] Implement `getProjectSkills(workdir: string): Skill[]`:
  - Determine git root: `spawnSync('git', ['-C', workdir, 'rev-parse', '--show-toplevel'])`. If non-zero, use `workdir` as root.
  - Collect candidate dirs: `workdir` and each parent up to git root (inclusive).
  - For each candidate, call `scanSkillDir(<candidate>/.claude/skills, 'project')`.
  - Deduplicate by `name` (child overrides parent — first-seen wins as we walk up from `workdir`).
- [x] Add a `Map<string, { data: Skill[]; at: number }>` cache keyed by dir path; TTL 60 000 ms. `scanSkillDir` reads from/writes to this cache.
- [x] Export `getUserSkills`, `getPluginSkills`, `getProjectSkills` and the `Skill` type.

### 2. Add `GET /skills` route to `backend/index.ts`  <!-- agent: general-purpose -->

- [x] Import `getUserSkills`, `getPluginSkills` from `./skills`.
- [x] Inside the `api.register()` callback (after the existing `/healthz` route), add:
  ```ts
  api.get('/skills', async (_req, reply) => {
    reply.send({ user: getUserSkills(), plugin: getPluginSkills() });
  });
  ```
- [x] No auth or query params needed — this endpoint is read-only and non-sensitive.

### 3. Add `GET /agents/:agent/skills` route to `backend/index.ts`  <!-- agent: general-purpose -->

- [x] Import `getProjectSkills` from `./skills`.
- [x] Add route after the existing `GET /agents/:agent/diff` route:
  ```ts
  api.get<{ Params: { agent: string } }>('/agents/:agent/skills', async (req, reply) => {
    const { agent: name } = req.params;
    const conf = readConductorConf();
    const entry = conf.agents.find((a) => a.name === name);
    if (!entry) {
      return reply.status(404).send({ error: `agent '${name}' not found in conductor.conf` });
    }
    const project = getProjectSkills(entry.workdir);
    const user = getUserSkills();
    return reply.send({ agent: name, workdir: entry.workdir, project, user });
  });
  ```

### 4. Frontend — Skills section in `AgentDetailModal`  <!-- agent: general-purpose -->

The `AgentDetailModal` component is defined in `frontend/src/components/AgentList.tsx`.

- [x] Add `Skill` type to `AgentList.tsx` (above existing interfaces):
  ```ts
  interface Skill {
    name: string;
    title?: string;
    description?: string;
    userInvocable: boolean;
    autoOnly: boolean;
    source: 'user' | 'project' | 'plugin';
  }
  interface SkillsResponse {
    agent: string;
    project: Skill[];
    user: Skill[];
  }
  ```
- [x] In `AgentDetailModal`: add `const [skills, setSkills] = useState<SkillsResponse | null>(null)` and a `useEffect` (same structure as the existing diff fetch) that calls `GET ${API_BASE}/agents/${encodeURIComponent(agent.name)}/skills` and populates state.
- [x] Add a `SkillBadge` sub-component (inline, same file) that renders:
  - `user-only` (amber) when `!skill.userInvocable` is false and `skill.autoOnly` is false — label is "manual"
  - `auto` (blue) when `!skill.autoOnly` is false — label is "auto-only"
  - Source badge: "project" (violet) vs "user" (neutral)
- [x] Add a "Skills" collapsible section beneath the existing diff section in the modal:
  - Header: `Skills ({count})` showing total count.
  - Two sub-groups: **Project** (from `skills.project`) and **User** (from `skills.user`).
  - Each skill row: `/<name>` in monospace, optional `title`, `description` (truncated to one line with `title` attr for full text), badges.
  - If `skills.project.length === 0`, show `—` for that group.
  - User skills group is collapsed by default (usually 50+ entries); project skills expanded.
- [x] Clicking a skill row enqueues it via `POST ${API_BASE}/queue/${encodeURIComponent(agent.name)}` with `{ task: '/<name>' }` — reuse the existing queue-post pattern from `AddTaskForm.tsx`. Show a brief "Queued ✓" inline confirmation (1.5 s timeout).

### 5. Typecheck and smoke-test  <!-- agent: general-purpose -->

- [x] Run `cd frontend && pnpm tsc --noEmit` — fix any type errors in `AgentList.tsx`.
- [x] Run `cd backend && npx tsc --noEmit` — fix any type errors in `skills.ts` / `index.ts`.
- [DEFERRED-TO-UAT] Manual smoke-test: start the backend (`node dist/index.js` or `tsx backend/index.ts`), `curl http://localhost:8788/skills | jq '.user | length'` should return the count of user skills. `curl http://localhost:8788/agents/<name>/skills | jq '.project'` should return `[]` or project skills depending on the agent workdir.
