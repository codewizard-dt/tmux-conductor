// Typed loader for role-presets.json.
//
// Source of truth for the role enum is host-server/db.ts's `agents.role`
// SQLite CHECK constraint (TASK-111): CHECK (role IN
// ('generic','frontend','backend','qa','devops','security','architect')).
// If that CHECK constraint ever changes, update ROLE_VALUES below (and
// role-presets.json) to match — and vice versa.

import * as fs from 'fs';
import * as path from 'path';

export const ROLE_VALUES: readonly string[] = [
  'generic',
  'frontend',
  'backend',
  'qa',
  'devops',
  'security',
  'architect'
];

const GENERIC_ROLE = 'generic';

// Hardcoded last-resort fallback, used only if the JSON file is missing,
// malformed, or somehow lacks even the `generic` key. getRoleFragment must
// never throw and must never return undefined/empty — this is the floor.
const HARDCODED_FALLBACK = 'You are a general-purpose engineering agent on this project.';

const presetsPath = new URL('./role-presets.json', import.meta.url).pathname;

// Loaded eagerly at module scope; the try/catch ensures a missing or
// malformed file degrades to an empty presets map rather than throwing
// during module load (which would take down the whole host-server process).
let presets: Record<string, string> = {};
try {
  const raw = fs.readFileSync(presetsPath, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
    presets = parsed as Record<string, string>;
  }
} catch {
  // Absent file, unreadable file, or invalid JSON — fall through with
  // presets left as {}. getRoleFragment's fallback chain handles the rest.
  presets = {};
}

/**
 * Returns the markdown fragment for a given role. Never throws, never
 * returns undefined/empty string.
 *
 * Fallback chain:
 *   1. `role` is present in the loaded presets and is a non-empty string.
 *   2. `generic` is present in the loaded presets and is a non-empty string
 *      (covers: unknown role, missing key for this role).
 *   3. A short hardcoded string (covers: `generic` itself missing/empty,
 *      e.g. because the JSON file was absent or malformed).
 */
export function getRoleFragment(role: string): string {
  const fragment = presets[role];
  if (typeof fragment === 'string' && fragment.length > 0) {
    return fragment;
  }

  const genericFragment = presets[GENERIC_ROLE];
  if (typeof genericFragment === 'string' && genericFragment.length > 0) {
    return genericFragment;
  }

  return HARDCODED_FALLBACK;
}

/**
 * Appends `role`'s CLAUDE.md fragment to the CLAUDE.md inside an agent's own
 * git worktree, so the agent picks up role-specific guidance the moment its
 * session starts.
 *
 * SAFETY INVARIANT: `worktreePath` must be the agent's own worktree
 * directory (e.g. `<gitRoot>/worktrees/<agentId>`) — NEVER the source
 * repo's root (`gitRoot`/`data.workdir`). This function unconditionally
 * reads and overwrites `<worktreePath>/CLAUDE.md`; passing the source repo
 * root would corrupt the user's real project file.
 *
 * Decision on `role === 'generic'`: written, not skipped. TASK-112's
 * `generic` fragment is real default engineering guidance (not an empty
 * placeholder), so it's just as worth injecting into a fresh worktree as
 * any other role's fragment — skipping it would be an arbitrary
 * inconsistency, not a meaningful behavior.
 *
 * Best-effort: mirrors createAgent()'s existing createWorktree() error
 * handling — any read/write failure (e.g. permissions) is logged as a
 * warning and swallowed. This must never throw and must never abort agent
 * creation.
 */
export function applyRoleFragmentToWorktree(worktreePath: string, role: string): void {
  const claudeMdPath = path.join(worktreePath, 'CLAUDE.md');
  try {
    let existing = '';
    if (fs.existsSync(claudeMdPath)) {
      existing = fs.readFileSync(claudeMdPath, 'utf8');
    }
    const fragment = getRoleFragment(role);
    const updated = `${existing}\n\n## Role: ${role}\n\n${fragment}\n`;
    fs.writeFileSync(claudeMdPath, updated, 'utf8');
  } catch (err) {
    console.warn(`[conductor] applyRoleFragmentToWorktree: failed to write CLAUDE.md at ${claudeMdPath} for role ${role}: ${String(err)}`);
  }
}
