import { execSync } from 'child_process';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface SessionEntry {
  sessionName: string;
  repoPath: string;
  startedAt: string;
}

export const DATA_DIR = path.join(os.homedir(), '.local', 'share', 'tmux-conductor');
const REGISTRY_PATH = path.join(DATA_DIR, 'registry.json');

export function ensureDataDir(): void {
  mkdirSync(DATA_DIR, { recursive: true });
}

export function loadRegistry(): SessionEntry[] {
  if (!existsSync(REGISTRY_PATH)) return [];
  try {
    return JSON.parse(readFileSync(REGISTRY_PATH, 'utf8')) as SessionEntry[];
  } catch {
    return [];
  }
}

export function saveRegistry(entries: SessionEntry[]): void {
  writeFileSync(REGISTRY_PATH, JSON.stringify(entries, null, 2), 'utf8');
}

export function addSession(entry: SessionEntry): void {
  const entries = loadRegistry().filter(e => e.sessionName !== entry.sessionName);
  entries.push(entry);
  saveRegistry(entries);
}

export function removeSession(sessionName: string): void {
  saveRegistry(loadRegistry().filter(e => e.sessionName !== sessionName));
}

export function listSessions(): SessionEntry[] {
  return loadRegistry();
}

export function reconcileRegistry(): SessionEntry[] {
  let liveSessions: string[] = [];
  try {
    const out = execSync("tmux ls -F '#S'", { encoding: 'utf8' });
    liveSessions = out.trim().split('\n').filter(Boolean);
  } catch { /* no sessions running */ }
  const entries = loadRegistry().filter(e => liveSessions.includes(e.sessionName));
  saveRegistry(entries);
  return entries;
}
