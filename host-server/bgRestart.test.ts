import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  buildBgSpawnArgs,
  descendantPids,
  formatRestartMarker,
  restartBgProcess,
  shellSingleQuote,
  startBgWindow,
  type BgRestartDeps,
  type BgSpawnEntry,
  type ProcessRow,
} from './bgRestart.ts';

// TASK-0190 Step 4. Fully hermetic: every dependency is a recording stub, so
// nothing here spawns tmux, touches the real process table, sends a signal to a
// real pid, or writes a real log file.

const SESSION = 'conductor';
const LOG_DIR = '/logs/conductor';
const OPTS = { sessionName: SESSION, logDir: LOG_DIR };
const NOW = new Date('2026-09-20T12:34:56.789Z');

const ENTRY: BgSpawnEntry = {
  slug: 'proj-web',
  workdir: '/Users/dev/my project',
  launchCmd: 'npm run dev -- --host "0.0.0.0" $HOME `date` \'x\'',
};

const TARGET = `${SESSION}:=${ENTRY.slug}`;
const LOG_PATH = `${LOG_DIR}/bg-${ENTRY.slug}.log`;

type Ev =
  | { kind: 'tmux'; args: string[] }
  | { kind: 'kill'; pid: number }
  | { kind: 'append'; path: string; text: string };

interface HarnessOpts {
  windowPresent?: boolean;
  panePidOut?: string;
  panePipeOut?: string;
  procs?: ProcessRow[];
  alive?: number[];
  /** Return a non-zero status to fail this tmux call, or null to let it pass. */
  failOn?: (args: string[]) => number | null;
  appendThrows?: boolean;
}

interface Harness {
  deps: BgRestartDeps;
  events: Ev[];
  listProcessesCalls: number;
  aliveChecks: number[];
}

function makeHarness(opts: HarnessOpts = {}): Harness {
  const alive = new Set(opts.alive ?? []);
  const h: Harness = {
    events: [],
    listProcessesCalls: 0,
    aliveChecks: [],
    deps: {
      runTmux(args) {
        h.events.push({ kind: 'tmux', args: [...args] });
        const failed = opts.failOn?.(args) ?? null;
        if (failed !== null) return { status: failed, stdout: '' };
        if (args[0] === 'display-message') {
          const fmt = args[args.length - 1];
          if (fmt === '#{pane_pid}') return { status: 0, stdout: opts.panePidOut ?? '4242\n' };
          if (fmt === '#{pane_pipe}') return { status: 0, stdout: opts.panePipeOut ?? '1\n' };
        }
        return { status: 0, stdout: '' };
      },
      windowPresent: () => opts.windowPresent ?? true,
      appendFile(path, text) {
        if (opts.appendThrows) throw new Error('disk full');
        h.events.push({ kind: 'append', path, text });
      },
      now: () => NOW,
      listProcesses() {
        h.listProcessesCalls += 1;
        return opts.procs ?? [];
      },
      isAlive(pid) {
        h.aliveChecks.push(pid);
        return alive.has(pid);
      },
      killPid(pid) {
        h.events.push({ kind: 'kill', pid });
      },
    },
  };
  return h;
}

function label(e: Ev): string {
  if (e.kind === 'kill') return `kill:${String(e.pid)}`;
  if (e.kind === 'append') return 'append-marker';
  const sub = e.args[0] ?? '';
  if (sub === 'display-message') return `display-message:${e.args[e.args.length - 1] ?? ''}`;
  if (sub === 'send-keys') return e.args.includes('-l') ? 'send-keys:type' : 'send-keys:enter';
  return sub;
}

const labels = (events: Ev[]): string[] => events.map(label);
const tmuxCalls = (events: Ev[]): string[][] =>
  events.flatMap((e) => (e.kind === 'tmux' ? [e.args] : []));
const appends = (events: Ev[]): Extract<Ev, { kind: 'append' }>[] =>
  events.flatMap((e) => (e.kind === 'append' ? [e] : []));
const kills = (events: Ev[]): number[] =>
  events.flatMap((e) => (e.kind === 'kill' ? [e.pid] : []));

/** No recorded tmux call may be a bare toggling `pipe-pane -o`. */
function assertNoToggleOpen(events: Ev[]): void {
  for (const args of tmuxCalls(events)) {
    if (args[0] === 'pipe-pane') {
      assert.ok(!args.includes('-o'), `pipe-pane must never use -o: ${JSON.stringify(args)}`);
    }
  }
}

const TREE: ProcessRow[] = [
  { pid: 4242, ppid: 1 },
  { pid: 4243, ppid: 4242 },
  { pid: 4244, ppid: 4243 },
  { pid: 9000, ppid: 1 }, // unrelated
];

void describe('shellSingleQuote', () => {
  void it('wraps a plain path in single quotes', () => {
    assert.equal(shellSingleQuote('/logs/a.log'), `'/logs/a.log'`);
  });

  void it('escapes an embedded single quote with the close-escape-reopen idiom', () => {
    assert.equal(shellSingleQuote(`/l/o'g`), `'/l/o'\\''g'`);
  });
});

void describe('formatRestartMarker', () => {
  void it('matches the documented `--- restart <ts> ---` format exactly', () => {
    assert.equal(formatRestartMarker(NOW), '\n--- restart 2026-09-20T12:34:56.789Z ---\n');
  });

  void it('is one delimited line preceded and followed by a newline', () => {
    assert.match(
      formatRestartMarker(NOW),
      /^\n--- restart \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z ---\n$/,
    );
  });
});

void describe('buildBgSpawnArgs', () => {
  const args = buildBgSpawnArgs(ENTRY, SESSION, LOG_DIR);

  void it('derives the exact-match target and log path from the slug', () => {
    assert.equal(args.target, TARGET);
    assert.equal(args.logPath, LOG_PATH);
  });

  void it('passes a launchCmd containing ", $HOME, backticks and quotes as ONE intact argv element', () => {
    assert.deepEqual(args.typeCommand, ['send-keys', '-t', TARGET, '-l', '--', ENTRY.launchCmd]);
    assert.equal(args.typeCommand[args.typeCommand.length - 1], ENTRY.launchCmd);
    assert.equal(args.typeCommand.length, 6);
  });

  void it('passes a workdir with spaces as its own element after -c (no quoting, no splitting)', () => {
    assert.deepEqual(args.newWindow, [
      'new-window', '-d', '-t', `${SESSION}:`, '-n', ENTRY.slug, '-c', '/Users/dev/my project',
    ]);
    assert.deepEqual(args.respawn, ['respawn-window', '-k', '-t', TARGET, '-c', '/Users/dev/my project']);
  });

  void it('respawn carries no command element (the pipe survives; the command is typed after)', () => {
    assert.equal(args.respawn.length, 6);
    assert.ok(!args.respawn.includes(ENTRY.launchCmd));
  });

  void it('submits with a separate Enter call, never embedded in the typed string', () => {
    assert.deepEqual(args.enter, ['send-keys', '-t', TARGET, 'Enter']);
    assert.ok(!args.typeCommand.includes('Enter'));
  });

  void it('reads pane pid and pane_pipe via display-message against the exact target', () => {
    assert.deepEqual(args.panePid, ['display-message', '-p', '-t', TARGET, '#{pane_pid}']);
    assert.deepEqual(args.panePipe, ['display-message', '-p', '-t', TARGET, '#{pane_pipe}']);
  });

  void it('pipePane has no -o and its single-quoted shell string is the ONLY element containing `cat >>`', () => {
    assert.deepEqual(args.pipePane, ['pipe-pane', '-t', TARGET, `cat >> '${LOG_PATH}'`]);
    assert.ok(!args.pipePane.includes('-o'));

    const argvArrays = Object.values(args).filter(Array.isArray) as string[][];
    const catElements = argvArrays.flat().filter((el) => el.includes('cat >>'));
    assert.equal(catElements.length, 1);
    assert.equal(catElements[0], `cat >> '${LOG_PATH}'`);
  });

  void it('single-quote-escapes a log dir containing a single quote in the pipe-pane shell string', () => {
    const quirky = buildBgSpawnArgs(ENTRY, SESSION, `/l/o'g`);
    assert.equal(quirky.pipePane[3], `cat >> '/l/o'\\''g/bg-proj-web.log'`);
  });

  void it('never interpolates launchCmd or workdir into any other element', () => {
    const argvArrays = Object.values(args).filter(Array.isArray) as string[][];
    for (const arr of argvArrays) {
      for (const el of arr) {
        if (el === ENTRY.launchCmd || el === ENTRY.workdir) continue;
        assert.ok(!el.includes('$HOME'), `leaked $HOME into ${JSON.stringify(el)}`);
        assert.ok(!el.includes('my project'), `leaked workdir into ${JSON.stringify(el)}`);
      }
    }
  });
});

void describe('descendantPids', () => {
  void it('returns the root first and includes children and grandchildren', () => {
    assert.deepEqual(descendantPids(4242, TREE), [4242, 4243, 4244]);
  });

  void it('excludes unrelated processes', () => {
    assert.ok(!descendantPids(4242, TREE).includes(9000));
  });

  void it('returns just the root when it has no children or is absent from the table', () => {
    assert.deepEqual(descendantPids(9000, TREE), [9000]);
    assert.deepEqual(descendantPids(777, TREE), [777]);
  });

  void it('walks siblings breadth-first', () => {
    const table: ProcessRow[] = [
      { pid: 2, ppid: 1 },
      { pid: 3, ppid: 1 },
      { pid: 4, ppid: 2 },
    ];
    assert.deepEqual(descendantPids(1, table), [1, 2, 3, 4]);
  });

  void it('is cycle-safe (a ppid loop terminates and lists each pid once)', () => {
    const cyclic: ProcessRow[] = [
      { pid: 10, ppid: 30 },
      { pid: 20, ppid: 10 },
      { pid: 30, ppid: 20 },
    ];
    assert.deepEqual(descendantPids(10, cyclic), [10, 20, 30]);
  });
});

void describe('startBgWindow', () => {
  void it('runs new-window -d, pipe-pane BEFORE typing, typed with -l --, then a separate Enter; no marker', () => {
    const h = makeHarness();
    const result = startBgWindow(h.deps, ENTRY, OPTS);

    assert.deepEqual(result, { ok: true });
    assert.deepEqual(labels(h.events), ['new-window', 'pipe-pane', 'send-keys:type', 'send-keys:enter']);
    assert.deepEqual(tmuxCalls(h.events), [
      ['new-window', '-d', '-t', `${SESSION}:`, '-n', ENTRY.slug, '-c', ENTRY.workdir],
      ['pipe-pane', '-t', TARGET, `cat >> '${LOG_PATH}'`],
      ['send-keys', '-t', TARGET, '-l', '--', ENTRY.launchCmd],
      ['send-keys', '-t', TARGET, 'Enter'],
    ]);
    assert.equal(appends(h.events).length, 0);
    assert.equal(h.listProcessesCalls, 0);
    assert.deepEqual(kills(h.events), []);
    assertNoToggleOpen(h.events);
  });

  void it('fails at new-window: returns the step and status, runs nothing further', () => {
    const h = makeHarness({ failOn: (a) => (a[0] === 'new-window' ? 3 : null) });
    assert.deepEqual(startBgWindow(h.deps, ENTRY, OPTS), { ok: false, step: 'new-window', status: 3 });
    assert.deepEqual(labels(h.events), ['new-window']);
  });

  void it('fails at pipe-pane: nothing is typed', () => {
    const h = makeHarness({ failOn: (a) => (a[0] === 'pipe-pane' ? 1 : null) });
    assert.deepEqual(startBgWindow(h.deps, ENTRY, OPTS), { ok: false, step: 'pipe-pane', status: 1 });
    assert.deepEqual(labels(h.events), ['new-window', 'pipe-pane']);
  });

  void it('fails at send-keys: no Enter is sent', () => {
    const h = makeHarness({ failOn: (a) => (a[0] === 'send-keys' ? 1 : null) });
    assert.deepEqual(startBgWindow(h.deps, ENTRY, OPTS), { ok: false, step: 'send-keys', status: 1 });
    assert.deepEqual(labels(h.events), ['new-window', 'pipe-pane', 'send-keys:type']);
  });

  void it('fails at the separate Enter: step send-enter', () => {
    const h = makeHarness({ failOn: (a) => (a[0] === 'send-keys' && a.includes('Enter') ? 1 : null) });
    assert.deepEqual(startBgWindow(h.deps, ENTRY, OPTS), { ok: false, step: 'send-enter', status: 1 });
    assert.deepEqual(labels(h.events), ['new-window', 'pipe-pane', 'send-keys:type', 'send-keys:enter']);
  });
});

void describe('restartBgProcess: window present (respawn-window path)', () => {
  void it('runs the exact ordered sequence when the pipe survived the respawn (pane_pipe = 1)', () => {
    const h = makeHarness({ procs: TREE, alive: [4243, 4244], panePipeOut: '1\n' });
    const result = restartBgProcess(h.deps, ENTRY, OPTS);

    assert.deepEqual(result, { ok: true, restartedAt: NOW.toISOString(), mechanism: 'respawn-window' });
    assert.deepEqual(labels(h.events), [
      'display-message:#{pane_pid}',
      'respawn-window',
      'kill:4243',
      'kill:4244',
      'display-message:#{pane_pipe}',
      'append-marker',
      'send-keys:type',
      'send-keys:enter',
    ]);
    assert.deepEqual(tmuxCalls(h.events), [
      ['display-message', '-p', '-t', TARGET, '#{pane_pid}'],
      ['respawn-window', '-k', '-t', TARGET, '-c', ENTRY.workdir],
      ['display-message', '-p', '-t', TARGET, '#{pane_pipe}'],
      ['send-keys', '-t', TARGET, '-l', '--', ENTRY.launchCmd],
      ['send-keys', '-t', TARGET, 'Enter'],
    ]);
    assert.equal(h.listProcessesCalls, 1);
    assertNoToggleOpen(h.events);
  });

  void it('does not run pipe-pane at all when #{pane_pipe} reads 1 (a live pipe must not be toggled)', () => {
    const h = makeHarness({ panePipeOut: '1\n' });
    restartBgProcess(h.deps, ENTRY, OPTS);
    assert.ok(!labels(h.events).includes('pipe-pane'));
    const catCalls = tmuxCalls(h.events).flat().filter((el) => el.includes('cat >>'));
    assert.equal(catCalls.length, 0);
  });

  void it('reattaches with a plain pipe-pane (no -o) only when #{pane_pipe} reads 0, before the marker', () => {
    const h = makeHarness({ procs: TREE, alive: [], panePipeOut: '0\n' });
    const result = restartBgProcess(h.deps, ENTRY, OPTS);

    assert.equal(result.ok, true);
    assert.deepEqual(labels(h.events), [
      'display-message:#{pane_pid}',
      'respawn-window',
      'display-message:#{pane_pipe}',
      'pipe-pane',
      'append-marker',
      'send-keys:type',
      'send-keys:enter',
    ]);
    const pipeCall = tmuxCalls(h.events).find((a) => a[0] === 'pipe-pane');
    assert.deepEqual(pipeCall, ['pipe-pane', '-t', TARGET, `cat >> '${LOG_PATH}'`]);
    assertNoToggleOpen(h.events);
    // Exactly one element across the whole run holds a shell string.
    const catElements = tmuxCalls(h.events).flat().filter((el) => el.includes('cat >>'));
    assert.equal(catElements.length, 1);
  });

  void it('kills only captured pids that are still alive, all AFTER respawn-window; never the root before it', () => {
    const h = makeHarness({ procs: TREE, alive: [4242, 4244] });
    restartBgProcess(h.deps, ENTRY, OPTS);

    const order = labels(h.events);
    const respawnAt = order.indexOf('respawn-window');
    assert.ok(respawnAt >= 0);
    assert.deepEqual(kills(h.events), [4242, 4244]);
    // No kill precedes the respawn, in particular not the pane root (4242).
    assert.equal(order.indexOf('kill:4242') > respawnAt, true);
    assert.equal(order.indexOf('kill:4244') > respawnAt, true);
    assert.ok(!order.slice(0, respawnAt).some((l) => l.startsWith('kill:')));
    // 4243 was checked but dead, so never killed; unrelated 9000 never even checked.
    assert.deepEqual(h.aliveChecks, [4242, 4243, 4244]);
    assert.ok(!kills(h.events).includes(4243));
    assert.ok(!kills(h.events).includes(9000));
  });

  void it('kills nothing when every captured pid died with the respawn', () => {
    const h = makeHarness({ procs: TREE, alive: [] });
    restartBgProcess(h.deps, ENTRY, OPTS);
    assert.deepEqual(kills(h.events), []);
  });

  void it('an unparseable or init pane pid captures nothing but still respawns and types', () => {
    for (const panePidOut of ['', 'garbage\n', '1\n']) {
      const h = makeHarness({ procs: TREE, alive: [4242, 4243, 4244], panePidOut });
      const result = restartBgProcess(h.deps, ENTRY, OPTS);
      assert.equal(result.ok, true, `panePidOut=${JSON.stringify(panePidOut)}`);
      assert.deepEqual(kills(h.events), []);
      assert.ok(labels(h.events).includes('respawn-window'));
      assert.equal(h.listProcessesCalls, 0);
    }
  });

  void it('writes the marker exactly once, after respawn (and reattach) and before the typed send-keys', () => {
    for (const panePipeOut of ['1\n', '0\n']) {
      const h = makeHarness({ procs: TREE, alive: [4244], panePipeOut });
      restartBgProcess(h.deps, ENTRY, OPTS);

      const order = labels(h.events);
      const written = appends(h.events);
      assert.equal(written.length, 1);
      const marker = written[0];
      assert.ok(marker);
      assert.equal(marker.path, LOG_PATH);
      assert.equal(marker.text, formatRestartMarker(NOW));
      assert.match(marker.text, /^\n--- restart .+ ---\n$/);

      const markerAt = order.indexOf('append-marker');
      assert.ok(markerAt > order.indexOf('respawn-window'));
      assert.ok(markerAt > order.lastIndexOf('kill:4244'));
      assert.ok(markerAt > order.indexOf('display-message:#{pane_pipe}'));
      if (panePipeOut === '0\n') assert.ok(markerAt > order.indexOf('pipe-pane'));
      assert.ok(markerAt < order.indexOf('send-keys:type'));
      assert.ok(order.indexOf('send-keys:type') < order.indexOf('send-keys:enter'));
    }
  });

  void it('addresses every call after the respawn by the exact-match target', () => {
    const h = makeHarness({ procs: TREE, alive: [], panePipeOut: '0\n' });
    restartBgProcess(h.deps, ENTRY, OPTS);
    for (const args of tmuxCalls(h.events)) {
      assert.ok(args.includes(TARGET), `missing exact target in ${JSON.stringify(args)}`);
    }
  });

  void it('types the launchCmd as one intact element with -l --, Enter separate', () => {
    const h = makeHarness();
    restartBgProcess(h.deps, ENTRY, OPTS);
    const calls = tmuxCalls(h.events);
    const typed = calls.find((a) => a[0] === 'send-keys' && a.includes('-l'));
    assert.deepEqual(typed, ['send-keys', '-t', TARGET, '-l', '--', ENTRY.launchCmd]);
    assert.deepEqual(calls[calls.length - 1], ['send-keys', '-t', TARGET, 'Enter']);
  });
});

void describe('restartBgProcess: window missing (start path)', () => {
  void it('behaves like start: new-window, pipe-pane before typing, marker, type, Enter', () => {
    const h = makeHarness({ windowPresent: false });
    const result = restartBgProcess(h.deps, ENTRY, OPTS);

    assert.deepEqual(result, { ok: true, restartedAt: NOW.toISOString(), mechanism: 'new-window' });
    assert.deepEqual(labels(h.events), [
      'new-window',
      'pipe-pane',
      'append-marker',
      'send-keys:type',
      'send-keys:enter',
    ]);
    assert.deepEqual(tmuxCalls(h.events), [
      ['new-window', '-d', '-t', `${SESSION}:`, '-n', ENTRY.slug, '-c', ENTRY.workdir],
      ['pipe-pane', '-t', TARGET, `cat >> '${LOG_PATH}'`],
      ['send-keys', '-t', TARGET, '-l', '--', ENTRY.launchCmd],
      ['send-keys', '-t', TARGET, 'Enter'],
    ]);
    assert.equal(appends(h.events).length, 1);
    const marker = appends(h.events)[0];
    assert.ok(marker);
    assert.equal(marker.text, formatRestartMarker(NOW));
    assertNoToggleOpen(h.events);
  });

  void it('never respawns, reads the pane pid, walks the process table or kills anything', () => {
    const h = makeHarness({ windowPresent: false, procs: TREE, alive: [4242, 4243, 4244] });
    restartBgProcess(h.deps, ENTRY, OPTS);
    const order = labels(h.events);
    assert.ok(!order.includes('respawn-window'));
    assert.ok(!order.some((l) => l.startsWith('display-message')));
    assert.equal(h.listProcessesCalls, 0);
    assert.deepEqual(h.aliveChecks, []);
    assert.deepEqual(kills(h.events), []);
  });
});

void describe('restartBgProcess: failures', () => {
  const restartFailures: Array<{
    step: string;
    failOn: (a: string[]) => number | null;
    windowPresent: boolean;
    panePipeOut?: string;
    expectedLabels: string[];
  }> = [
    {
      step: 'pane-pid',
      windowPresent: true,
      failOn: (a) => (a[0] === 'display-message' && a[a.length - 1] === '#{pane_pid}' ? 2 : null),
      expectedLabels: ['display-message:#{pane_pid}'],
    },
    {
      step: 'respawn-window',
      windowPresent: true,
      failOn: (a) => (a[0] === 'respawn-window' ? 2 : null),
      expectedLabels: ['display-message:#{pane_pid}', 'respawn-window'],
    },
    {
      step: 'pane-pipe',
      windowPresent: true,
      failOn: (a) => (a[0] === 'display-message' && a[a.length - 1] === '#{pane_pipe}' ? 2 : null),
      expectedLabels: ['display-message:#{pane_pid}', 'respawn-window', 'display-message:#{pane_pipe}'],
    },
    {
      step: 'pipe-pane',
      windowPresent: true,
      panePipeOut: '0\n',
      failOn: (a) => (a[0] === 'pipe-pane' ? 2 : null),
      expectedLabels: [
        'display-message:#{pane_pid}',
        'respawn-window',
        'display-message:#{pane_pipe}',
        'pipe-pane',
      ],
    },
    {
      step: 'new-window',
      windowPresent: false,
      failOn: (a) => (a[0] === 'new-window' ? 2 : null),
      expectedLabels: ['new-window'],
    },
    {
      step: 'pipe-pane',
      windowPresent: false,
      failOn: (a) => (a[0] === 'pipe-pane' ? 2 : null),
      expectedLabels: ['new-window', 'pipe-pane'],
    },
  ];

  for (const c of restartFailures) {
    const path = c.windowPresent ? 'respawn path' : 'start path';
    void it(`failure at ${c.step} (${path}) returns { ok:false, step, status }, writes no marker, types nothing`, () => {
      const h = makeHarness({
        windowPresent: c.windowPresent,
        ...(c.panePipeOut === undefined ? {} : { panePipeOut: c.panePipeOut }),
        procs: TREE,
        alive: [],
        failOn: c.failOn,
      });
      const result = restartBgProcess(h.deps, ENTRY, OPTS);

      assert.deepEqual(result, { ok: false, step: c.step, status: 2 });
      assert.deepEqual(labels(h.events), c.expectedLabels);
      assert.equal(appends(h.events).length, 0);
      assert.ok(!labels(h.events).some((l) => l.startsWith('send-keys')));
    });
  }

  void it('a respawn-window failure kills no survivor (the old tree is left untouched)', () => {
    const h = makeHarness({
      procs: TREE,
      alive: [4242, 4243, 4244],
      failOn: (a) => (a[0] === 'respawn-window' ? 1 : null),
    });
    const result = restartBgProcess(h.deps, ENTRY, OPTS);
    assert.deepEqual(result, { ok: false, step: 'respawn-window', status: 1 });
    assert.deepEqual(kills(h.events), []);
    assert.deepEqual(labels(h.events), ['display-message:#{pane_pid}', 'respawn-window']);
  });

  void it('a send-keys failure returns ok:false step send-keys; the marker was already written (TASK-0189 ordering)', () => {
    const h = makeHarness({ failOn: (a) => (a[0] === 'send-keys' ? 1 : null) });
    const result = restartBgProcess(h.deps, ENTRY, OPTS);

    assert.deepEqual(result, { ok: false, step: 'send-keys', status: 1 });
    assert.equal(appends(h.events).length, 1);
    assert.deepEqual(labels(h.events), [
      'display-message:#{pane_pid}',
      'respawn-window',
      'display-message:#{pane_pipe}',
      'append-marker',
      'send-keys:type',
    ]);
  });

  void it('a failure of the separate Enter returns step send-enter with the marker written once', () => {
    const h = makeHarness({ failOn: (a) => (a[0] === 'send-keys' && a.includes('Enter') ? 1 : null) });
    const result = restartBgProcess(h.deps, ENTRY, OPTS);

    assert.deepEqual(result, { ok: false, step: 'send-enter', status: 1 });
    assert.equal(appends(h.events).length, 1);
    assert.equal(labels(h.events).pop(), 'send-keys:enter');
  });

  void it('a failed marker write returns step write-marker (status null) and types nothing', () => {
    const h = makeHarness({ appendThrows: true });
    const result = restartBgProcess(h.deps, ENTRY, OPTS);

    assert.deepEqual(result, { ok: false, step: 'write-marker', status: null });
    assert.deepEqual(labels(h.events), [
      'display-message:#{pane_pid}',
      'respawn-window',
      'display-message:#{pane_pipe}',
    ]);
    assert.ok(!labels(h.events).some((l) => l.startsWith('send-keys')));
  });

  void it('a failed marker write on the start path also types nothing', () => {
    const h = makeHarness({ windowPresent: false, appendThrows: true });
    const result = restartBgProcess(h.deps, ENTRY, OPTS);

    assert.deepEqual(result, { ok: false, step: 'write-marker', status: null });
    assert.deepEqual(labels(h.events), ['new-window', 'pipe-pane']);
  });
});
