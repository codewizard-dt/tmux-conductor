// TASK-0233 step 3: defense-in-depth against the env leak documented in
// wiki/work/tasks/TASK-0233-stop-env-leak-into-tmux-windows.md.
//
// `conductor.sh`'s `tmux new-session` seeds the tmux SERVER's global
// environment from whatever env it was spawned with — and every window/pane
// created afterwards (including unrelated Claude Code agent sessions) inherits
// that global environment. host-server spawns `conductor.sh` with
// `{ ...process.env, ... }`, so a stale conductor-only var sitting in the
// host-server's own env (e.g. leaked in from a `.env` the Makefile over-exports)
// would otherwise ride all the way into every agent's shell. This module scrubs
// those known-leaky names before the env is handed to `conductor.sh`.
//
// Keep this list in sync with the identical array in `scripts/lib/db.sh`
// (`LEAKY_TMUX_ENV_VARS`), which scrubs the same names from the tmux server's
// global environment after `tmux new-session` in `scripts/conductor.sh` and
// `scripts/spawn.sh` — two independent layers covering the same leak.
export const LEAKY_ENV_VARS: readonly string[] = ['DATABASE_URL', 'HOST_SERVER_URL', 'PUBLIC_API_URL', 'PUBLIC_BASE_URL'];

/**
 * Return a shallow copy of `env` with every name in `LEAKY_ENV_VARS` removed.
 * Used to build the env handed to a spawned `conductor.sh`, so conductor-only/
 * leaky vars never reach the tmux server's global environment (and from there,
 * every agent window it spawns).
 */
export function scrubLeakyEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const leakySet = new Set(LEAKY_ENV_VARS);
  return Object.fromEntries(Object.entries(env).filter(([key]) => !leakySet.has(key)));
}
