import { agentWindowName, type Agent } from './db.ts';
import type { BgRestartDenyReason } from './bgRestartPolicy.ts';

// TASK-0194: same-project guard for `POST /bg-processes/:slug/restart`. Pure
// functions only (no I/O); the route wiring lives in index.ts.
//
// IMPORTANT — this is NOT a security boundary. The caller identity is the
// self-declared `X-Conductor-Agent` header (see bgRestartPolicy.ts); an agent
// that knows another agent's window name can spoof it, or simply omit the header
// and be treated as the dashboard. The guard keeps well-behaved agents inside
// their own project and fails closed when an identity cannot be resolved; it
// does not stop a hostile local process. If agents ever run outside the host, use
// a signed per-agent token instead.

/** Slice of an agent row needed to resolve a caller. */
export type CallerAgent = Pick<Agent, 'id' | 'name' | 'projectId' | 'projectName'>;

/** Slice of a bg-process row needed to authorize a restart. */
export interface AccessBg {
  projectId: number | null;
}

/**
 * Who is calling. `human` = no identity header (dashboard / person, unchanged
 * single-user semantics). `agent` = the header matched exactly one agent's window
 * name. `unknown` = a header was sent but matches no agent. `ambiguous` = it matches
 * more than one (possible because `<project>-<name>` concatenation is not
 * injective: project `a-b` + agent `c` versus project `a` + agent `b-c`).
 */
export type CallerResolution =
  | { kind: 'human' }
  | { kind: 'agent'; agentId: number; agentName: string; projectId: number | null }
  | { kind: 'unknown' }
  | { kind: 'ambiguous' };

/**
 * What to do with a bg process that has no project. Decided in TASK-0186 as
 * `must-assign` (deny agents until a project is assigned). `hidden` behaves the same
 * for restart (it only differs for reads, which are out of scope here); `visible`
 * lets any agent restart it and exists only so a policy change is a one-line edit.
 */
export type UnscopedBgPolicy = 'visible' | 'hidden' | 'must-assign';

/** The recorded TASK-0186 decision. Change this one line to change the policy. */
export const UNSCOPED_BG_POLICY: UnscopedBgPolicy = 'must-assign';

export type RestartAuthorization =
  | { allowed: true }
  | {
      allowed: false;
      reason: BgRestartDenyReason;
      /** Null when the caller has no project or could not be resolved. */
      callerProjectId: number | null;
      /** Null when the bg process has no project. */
      bgProjectId: number | null;
    };

/**
 * Resolve the (already trimmed/sanitized, see `parseCallerHeader`) caller header to
 * an agent. Match is exact string equality against `agentWindowName()` for every
 * agent — never prefix/substring/case-insensitive (`foo` must not match `foo-copy`).
 * A null header is a human/dashboard caller.
 */
export function resolveCallerProject(header: string | null, agents: readonly CallerAgent[]): CallerResolution {
  if (header === null) return { kind: 'human' };
  const matches = agents.filter((a) => agentWindowName(a) === header);
  const agent = matches[0];
  if (agent === undefined) return { kind: 'unknown' };
  if (matches.length > 1) return { kind: 'ambiguous' };
  return { kind: 'agent', agentId: agent.id, agentName: agent.name, projectId: agent.projectId };
}

/**
 * Wire shape of `GET /api/agents/whoami` (TASK-0202). `agent` carries the resolved
 * agent plus its project name; every other kind is just the discriminator.
 */
export type WhoamiResponse =
  | { kind: 'agent'; agentId: number; agentName: string; projectId: number | null; projectName: string | null }
  | { kind: 'human' }
  | { kind: 'unknown' }
  | { kind: 'ambiguous' };

/**
 * Map a `resolveCallerProject` result to the `whoami` wire shape. Pure. The project
 * name is read off the matched agent row (agent rows already carry `projectName`),
 * so no separate project lookup is needed; it is null for a project-less agent.
 */
export function describeCaller(resolution: CallerResolution, agents: readonly CallerAgent[]): WhoamiResponse {
  if (resolution.kind !== 'agent') return { kind: resolution.kind };
  const row = agents.find((a) => a.id === resolution.agentId);
  const projectName = resolution.projectId === null ? null : (row?.projectName ?? null);
  return {
    kind: 'agent',
    agentId: resolution.agentId,
    agentName: resolution.agentName,
    projectId: resolution.projectId,
    projectName,
  };
}

/**
 * Decide whether `caller` may restart `bg`. Fail closed: an unresolvable identity
 * never widens access.
 */
export function authorizeRestart(
  caller: CallerResolution,
  bg: AccessBg,
  policy: UnscopedBgPolicy = UNSCOPED_BG_POLICY,
): RestartAuthorization {
  const bgProjectId = bg.projectId;
  switch (caller.kind) {
    case 'human':
      return { allowed: true };
    case 'unknown':
      return { allowed: false, reason: 'unknown-caller', callerProjectId: null, bgProjectId };
    case 'ambiguous':
      return { allowed: false, reason: 'ambiguous-caller', callerProjectId: null, bgProjectId };
    case 'agent': {
      const callerProjectId = caller.projectId;
      // Unscoped bg process: no project to compare against, even for a project-less
      // agent (null === null must never authorize).
      if (bgProjectId === null) {
        return policy === 'visible'
          ? { allowed: true }
          : { allowed: false, reason: 'unscoped', callerProjectId, bgProjectId };
      }
      if (callerProjectId !== null && callerProjectId === bgProjectId) return { allowed: true };
      return { allowed: false, reason: 'project-mismatch', callerProjectId, bgProjectId };
    }
  }
}
