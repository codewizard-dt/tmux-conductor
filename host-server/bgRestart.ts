import * as fs from 'fs';
import { spawnSync } from 'child_process';
import { isTmuxWindowPresent, windowTarget } from './state.ts';

// TASK-0190: shared spawn/restart module for background processes.
//
// One code path for both `POST /bg-processes/:slug/restart` and the open-window
// route: `buildBgSpawnArgs` returns tmux argv arrays (never shell strings), so
// `launchCmd`, `workdir` and the slug are each a single argv element and can
// never be re-parsed by a shell. The single exception is the `pipe-pane` pipe
// target, which tmux itself hands to `sh -c`; its log path is single-quote
// escaped via `shellSingleQuote`.
//
// Restart ordering is decided by TASK-0189's measured finding (tmux 3.7c):
//   1. `respawn-window -k` with NO command keeps the pane id and, with it, the
//      pipe-pane capture; a direct `respawn-window -k "<cmd>"` closes the window
//      on a crash and a `; exec $SHELL` wrapper hides the real process from
//      `bgLiveness`, while `kill-window` + `new-window` drops the pipe.
//   2. `-k` only hangs up the pty, so the old pane's process tree is captured
//      first and any survivor is SIGKILLed after the respawn (never the pane
//      root before it, which would close the window).
//   3. The restart marker is appended server-side AFTER the respawn (and any
//      reattach) and BEFORE typing the command: earlier, and the old process can
//      still write after the marker; later, it races the new process's output.
//   4. The reattach is guarded on `#{pane_pipe}`: `pipe-pane -o` TOGGLES an
//      existing pipe off, so it is never issued; a plain `pipe-pane` runs only
//      when the pane reports no pipe.

/**
 * `spawnSync` timeout for the tmux calls in this module. Deliberately its own
 * constant: state.ts's TMUX_SYNC_TIMEOUT_MS (100 ms) is tuned for read-only
 * polling and is too tight for `respawn-window` / `new-window`.
 */
export const BG_RESTART_TMUX_TIMEOUT_MS = Number(process.env['BG_RESTART_TMUX_TIMEOUT_MS'] ?? '5000');

/** The fields of a registered bg process the spawn path needs; `slug` is the tmux window name. */
export interface BgSpawnEntry {
  slug: string;
  workdir: string;
  launchCmd: string;
}

/** Every tmux invocation for a bg spawn/restart, as argv arrays for `spawnSync('tmux', ...)`. */
export interface BgSpawnArgs {
  /** `<logDir>/bg-<slug>.log` */
  logPath: string;
  /** Exact-match window target, `<session>:=<slug>`. */
  target: string;
  /** Create a detached window in the session (start path). */
  newWindow: string[];
  /** Respawn the window's pane in place, with no command (restart path). */
  respawn: string[];
  /** Read the pane's root pid. */
  panePid: string[];
  /** Read `#{pane_pipe}` (`1` when a pipe-pane is attached, else `0`). */
  panePipe: string[];
  /** Attach log capture. Never `-o`: that flag toggles an existing pipe off. */
  pipePane: string[];
  /** Type the launch command literally (no Enter). */
  typeCommand: string[];
  /** Submit the typed command; always a separate send-keys call. */
  enter: string[];
}

/** Wrap `s` in single quotes for `sh`, escaping embedded `'` as `'\''`. */
export function shellSingleQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Pure builder for every tmux argv used to start or restart a bg process. */
export function buildBgSpawnArgs(entry: BgSpawnEntry, sessionName: string, logDir: string): BgSpawnArgs {
  const target = windowTarget(sessionName, entry.slug);
  const logPath = `${logDir}/bg-${entry.slug}.log`;
  return {
    logPath,
    target,
    newWindow: ['new-window', '-d', '-t', `${sessionName}:`, '-n', entry.slug, '-c', entry.workdir],
    respawn: ['respawn-window', '-k', '-t', target, '-c', entry.workdir],
    panePid: ['display-message', '-p', '-t', target, '#{pane_pid}'],
    panePipe: ['display-message', '-p', '-t', target, '#{pane_pipe}'],
    // The pipe target is the one shell string; tmux runs it via `sh -c`.
    pipePane: ['pipe-pane', '-t', target, `cat >> ${shellSingleQuote(logPath)}`],
    typeCommand: ['send-keys', '-t', target, '-l', '--', entry.launchCmd],
    enter: ['send-keys', '-t', target, 'Enter'],
  };
}

/** The line appended to the log where a restart happened. */
export function formatRestartMarker(now: Date): string {
  return `\n--- restart ${now.toISOString()} ---\n`;
}

export interface ProcessRow {
  pid: number;
  ppid: number;
}

/**
 * `rootPid` plus every transitive child in `table`, root first. Cycle-safe
 * (each pid is visited once).
 */
export function descendantPids(rootPid: number, table: readonly ProcessRow[]): number[] {
  const children = new Map<number, number[]>();
  for (const { pid, ppid } of table) {
    const list = children.get(ppid);
    if (list) list.push(pid);
    else children.set(ppid, [pid]);
  }
  const out: number[] = [];
  const seen = new Set<number>([rootPid]);
  const queue: number[] = [rootPid];
  while (queue.length > 0) {
    const pid = queue.shift() as number;
    out.push(pid);
    for (const child of children.get(pid) ?? []) {
      if (seen.has(child)) continue;
      seen.add(child);
      queue.push(child);
    }
  }
  return out;
}

export interface BgRestartDeps {
  /** Run `tmux <args>`; `stdout` is present for queries such as display-message. */
  runTmux(args: string[]): { status: number | null; stdout?: string };
  windowPresent(session: string, name: string): boolean;
  appendFile(path: string, text: string): void;
  now(): Date;
  /** Snapshot of the process table (pid/ppid pairs). */
  listProcesses(): ProcessRow[];
  isAlive(pid: number): boolean;
  /** SIGKILL `pid`; never throws. */
  killPid(pid: number): void;
}

/** Deps wired to real tmux, `ps`, `node:fs`; `overrides` replaces individual members (tests). */
export function defaultBgRestartDeps(overrides: Partial<BgRestartDeps> = {}): BgRestartDeps {
  return {
    runTmux: (args) => {
      const r = spawnSync('tmux', args, { encoding: 'utf8', timeout: BG_RESTART_TMUX_TIMEOUT_MS });
      return { status: r.status, stdout: typeof r.stdout === 'string' ? r.stdout : '' };
    },
    windowPresent: isTmuxWindowPresent,
    appendFile: (p, text) => {
      fs.appendFileSync(p, text);
    },
    now: () => new Date(),
    // macOS `pgrep` has no `-s`, so walk `ps` output ourselves.
    listProcesses: () => {
      const r = spawnSync('ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8', timeout: BG_RESTART_TMUX_TIMEOUT_MS });
      if (r.status !== 0 || typeof r.stdout !== 'string') return [];
      const rows: ProcessRow[] = [];
      for (const line of r.stdout.split('\n')) {
        const m = /^\s*(\d+)\s+(\d+)\s*$/.exec(line);
        if (m) rows.push({ pid: Number(m[1]), ppid: Number(m[2]) });
      }
      return rows;
    },
    isAlive: (pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch (err) {
        return (err as NodeJS.ErrnoException).code === 'EPERM';
      }
    },
    killPid: (pid) => {
      // Never signal init, a process group (<= 0) or the host-server itself.
      if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) return;
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // already gone
      }
    },
    ...overrides,
  };
}

export interface BgRestartOptions {
  sessionName: string;
  logDir: string;
}

export type BgRestartStep =
  | 'new-window' | 'pipe-pane'
  | 'pane-pid' | 'respawn-window' | 'pane-pipe'
  | 'write-marker' | 'send-keys' | 'send-enter';

export type BgRestartResult =
  | { ok: true; restartedAt: string; mechanism: 'respawn-window' | 'new-window' }
  | { ok: false; step: BgRestartStep; status: number | null };

/**
 * Restart (or, when its window is absent, start) a bg process. See the header
 * for the ordering. A failing tmux step returns `{ ok: false, step, status }`
 * instead of throwing; the marker is only written once every tmux step before
 * typing has succeeded. The caller checks that the tmux session exists.
 */
export function restartBgProcess(
  deps: BgRestartDeps,
  entry: BgSpawnEntry,
  opts: BgRestartOptions,
): BgRestartResult {
  const spawn = buildBgSpawnArgs(entry, opts.sessionName, opts.logDir);
  const mechanism = deps.windowPresent(opts.sessionName, entry.slug) ? 'respawn-window' : 'new-window';

  if (mechanism === 'new-window') {
    const created = deps.runTmux(spawn.newWindow);
    if (created.status !== 0) return { ok: false, step: 'new-window', status: created.status };
    // Fresh pane, so no pipe can exist yet: attach capture before typing.
    const piped = deps.runTmux(spawn.pipePane);
    if (piped.status !== 0) return { ok: false, step: 'pipe-pane', status: piped.status };
  } else {
    // Capture the old process tree before the respawn replaces the pane's pid.
    const pidResult = deps.runTmux(spawn.panePid);
    if (pidResult.status !== 0) return { ok: false, step: 'pane-pid', status: pidResult.status };
    const rootPid = parseInt((pidResult.stdout ?? '').trim(), 10);
    const captured = Number.isInteger(rootPid) && rootPid > 1
      ? descendantPids(rootPid, deps.listProcesses())
      : [];

    const respawned = deps.runTmux(spawn.respawn);
    if (respawned.status !== 0) return { ok: false, step: 'respawn-window', status: respawned.status };

    // `respawn-window -k` only hangs up the pty: SIGKILL anything that ignored it.
    for (const pid of captured) {
      if (deps.isAlive(pid)) deps.killPid(pid);
    }

    // The pipe normally survives the respawn; reattach only when it did not.
    // Never `pipe-pane -o` here: it would toggle a live pipe off.
    const pipeResult = deps.runTmux(spawn.panePipe);
    if (pipeResult.status !== 0) return { ok: false, step: 'pane-pipe', status: pipeResult.status };
    if ((pipeResult.stdout ?? '').trim() === '0') {
      const piped = deps.runTmux(spawn.pipePane);
      if (piped.status !== 0) return { ok: false, step: 'pipe-pane', status: piped.status };
    }
  }

  const restartedAt = deps.now();
  try {
    deps.appendFile(spawn.logPath, formatRestartMarker(restartedAt));
  } catch {
    return { ok: false, step: 'write-marker', status: null };
  }

  const typed = deps.runTmux(spawn.typeCommand);
  if (typed.status !== 0) return { ok: false, step: 'send-keys', status: typed.status };
  const submitted = deps.runTmux(spawn.enter);
  if (submitted.status !== 0) return { ok: false, step: 'send-enter', status: submitted.status };

  return { ok: true, restartedAt: restartedAt.toISOString(), mechanism };
}

export type BgStartStep = 'new-window' | 'pipe-pane' | 'send-keys' | 'send-enter';

export type BgStartResult =
  | { ok: true }
  | { ok: false; step: BgStartStep; status: number | null };

/**
 * Create a bg process's window and launch it (plain "open window": no restart
 * marker, no respawn). Same argv builders and ordering as the restart start
 * path: `new-window -d`, `pipe-pane` BEFORE typing (never `-o`), then the
 * launch command typed literally and submitted with a separate Enter. The
 * caller checks the tmux session exists and that the window is absent.
 */
export function startBgWindow(
  deps: BgRestartDeps,
  entry: BgSpawnEntry,
  opts: BgRestartOptions,
): BgStartResult {
  const spawn = buildBgSpawnArgs(entry, opts.sessionName, opts.logDir);

  const created = deps.runTmux(spawn.newWindow);
  if (created.status !== 0) return { ok: false, step: 'new-window', status: created.status };
  const piped = deps.runTmux(spawn.pipePane);
  if (piped.status !== 0) return { ok: false, step: 'pipe-pane', status: piped.status };
  const typed = deps.runTmux(spawn.typeCommand);
  if (typed.status !== 0) return { ok: false, step: 'send-keys', status: typed.status };
  const submitted = deps.runTmux(spawn.enter);
  if (submitted.status !== 0) return { ok: false, step: 'send-enter', status: submitted.status };
  return { ok: true };
}
