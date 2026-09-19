#!/usr/bin/env node
// TASK-0166 Step 4: backfill-agent-teams-flag.mjs
//
// One-off backfill: appends `--append-system-prompt-file
// ~/.claude/rules/agent-teams-preference.md` to every existing `agents.launch_cmd`
// and `projects.default_launch_cmd` row whose command is a Claude Code launch
// (first non-`VAR=value` token is exactly `claude`), so the agent-teams naming
// preference reaches agents/projects that were created before that flag became
// the default (see host-server/db.ts's `projects.default_launch_cmd` column
// default and `createProject`'s fallback, which already bake the flag in for
// anything created from here on — this script only back-fills pre-existing rows).
//
// Safe to re-run: any row that already contains `--append-system-prompt-file`
// is left untouched. Never touches `bg_processes.launch_cmd` (bg processes are
// never Claude Code agents).
//
// Usage:
//   node scripts/backfill-agent-teams-flag.mjs
//
// DB path resolution mirrors host-server/db.ts's getDbPath() /
// host-server/config.ts's readConductorConf():
//   1. process.env.CONDUCTOR_DB, if set, wins outright.
//   2. Otherwise read DB_PATH out of conductor.conf (process.env.CONDUCTOR_CONF,
//      or the repo-root conductor.conf next to this script's parent dir),
//      resolved relative to that conf file's directory.
//   3. Default to '<confDir>/data/conductor.db' if DB_PATH is unset in the conf.

import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const FLAG = '--append-system-prompt-file ~/.claude/rules/agent-teams-preference.md';
const FLAG_MARKER = '--append-system-prompt-file';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.dirname(__dirname); // scripts/.. == repo root

/**
 * Mirrors host-server/state.ts::launchCommandName — returns the first
 * whitespace-separated token of `launchCmd` that is not a leading
 * `VAR=value` environment assignment (e.g. `FOO=bar claude --flag` -> `claude`).
 */
function launchCommandName(launchCmd) {
  for (const word of launchCmd.trim().split(/\s+/)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) return word;
  }
  return '';
}

/**
 * Mirrors host-server/state.ts::launchCommandBasename exactly — basename of
 * launchCommandName(), lowercased.
 */
function launchCommandBasename(launchCmd) {
  return path.basename(launchCommandName(launchCmd)).toLowerCase();
}

/**
 * Mirrors host-server/config.ts's DEFAULT_CONF_PATH resolution: the repo-root
 * conductor.conf, overridable via CONDUCTOR_CONF.
 */
function defaultConfPath() {
  return process.env['CONDUCTOR_CONF'] || path.join(REPO_ROOT, 'conductor.conf');
}

/**
 * Reads the DB_PATH setting out of conductor.conf by sourcing it in bash,
 * the same technique host-server/config.ts::readConductorConf() uses (conf
 * files may reference other shell variables / use bash syntax, so a naive
 * regex parse of the file text would be unreliable). Falls back to the
 * documented default ('./data/conductor.db') if the conf can't be read or
 * doesn't set DB_PATH.
 */
function readDbPathSetting(confPath) {
  try {
    const output = execFileSync(
      'bash',
      ['-c', 'source "$1" && printf \'%s\' "$DB_PATH"', 'bash', confPath],
      { encoding: 'utf8' }
    );
    const trimmed = output.trim();
    return trimmed || './data/conductor.db';
  } catch {
    return './data/conductor.db';
  }
}

/**
 * Mirrors host-server/db.ts::getDbPath(): CONDUCTOR_DB env wins outright;
 * otherwise resolve conductor.conf's DB_PATH relative to the conf file's
 * own directory (matching readConductorConf's resolveConfPath behavior).
 */
function resolveDbPath() {
  if (process.env['CONDUCTOR_DB']) return process.env['CONDUCTOR_DB'];
  const confPath = defaultConfPath();
  const confDir = path.dirname(path.resolve(confPath));
  const dbPathSetting = readDbPathSetting(confPath);
  return path.resolve(confDir, dbPathSetting);
}

/**
 * Backfills one table's launch-command column in place.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} table - 'agents' | 'projects'
 * @param {string} column - 'launch_cmd' | 'default_launch_cmd'
 * @returns {{ updated: number, alreadyFlagged: number, notClaude: number }}
 */
function backfillTable(db, table, column) {
  const rows = db.prepare(`SELECT id, ${column} AS cmd FROM ${table}`).all();

  let updated = 0;
  let alreadyFlagged = 0;
  let notClaude = 0;

  const update = db.prepare(`UPDATE ${table} SET ${column} = ? WHERE id = ?`);

  const tx = db.transaction(() => {
    for (const row of rows) {
      const cmd = row.cmd;
      if (typeof cmd !== 'string' || cmd.length === 0) {
        notClaude++;
        continue;
      }
      if (launchCommandBasename(cmd) !== 'claude') {
        notClaude++;
        continue;
      }
      if (cmd.includes(FLAG_MARKER)) {
        alreadyFlagged++;
        continue;
      }
      const newCmd = `${cmd} ${FLAG}`;
      update.run(newCmd, row.id);
      updated++;
    }
  });
  tx();

  return { updated, alreadyFlagged, notClaude };
}

function main() {
  const dbPath = resolveDbPath();
  console.log(`[backfill-agent-teams-flag] using DB at: ${dbPath}`);

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  try {
    const agentsResult = backfillTable(db, 'agents', 'launch_cmd');
    const projectsResult = backfillTable(db, 'projects', 'default_launch_cmd');

    console.log(
      `agents: ${agentsResult.updated} updated, ${agentsResult.alreadyFlagged} skipped (already flagged), ${agentsResult.notClaude} skipped (not claude)`
    );
    console.log(
      `projects: ${projectsResult.updated} updated, ${projectsResult.alreadyFlagged} skipped (already flagged), ${projectsResult.notClaude} skipped (not claude)`
    );
    console.log('bg_processes: never touched (not Claude Code agents)');
  } finally {
    db.close();
  }
}

main();
