import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';

export interface DeviceCredentials {
  portalUrl: string;
  deviceId: string;
  token: string;
}

/**
 * Resolves the path to the device credentials file.
 * Respects CONDUCTOR_HOME env var; falls back to ~/.local/share/tmux-conductor.
 */
export function credentialsPath(): string {
  const home =
    process.env['CONDUCTOR_HOME'] ??
    path.join(
      process.env['HOME'] ?? '',
      '.local',
      'share',
      'tmux-conductor',
    );
  return path.join(home, 'device.json');
}

/**
 * Reads and parses the credentials file.
 * Returns null if the file does not exist or is malformed.
 */
export function readCredentials(): DeviceCredentials | null {
  const p = credentialsPath();
  if (!fs.existsSync(p)) return null;
  try {
    const raw = fs.readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as Record<string, unknown>)['portalUrl'] === 'string' &&
      typeof (parsed as Record<string, unknown>)['deviceId'] === 'string' &&
      typeof (parsed as Record<string, unknown>)['token'] === 'string'
    ) {
      return parsed as DeviceCredentials;
    }
    console.warn('[conductor] Warning: device.json is malformed — ignoring.');
    return null;
  } catch {
    console.warn('[conductor] Warning: failed to parse device.json — ignoring.');
    return null;
  }
}

/**
 * Writes credentials atomically (tmp → rename) and sets chmod 600.
 * Also ensures device.json is listed in the repo's .gitignore.
 */
export function writeCredentials(creds: DeviceCredentials): void {
  if (!creds.portalUrl || !creds.deviceId || !creds.token) {
    throw new Error('writeCredentials: all fields (portalUrl, deviceId, token) must be non-empty strings.');
  }

  const p = credentialsPath();
  const dir = path.dirname(p);
  fs.mkdirSync(dir, { recursive: true });

  const json = JSON.stringify(creds, null, 2) + '\n';
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, json, { encoding: 'utf8' });
  fs.renameSync(tmp, p);
  fs.chmodSync(p, 0o600);

  // Ensure the repo's .gitignore contains device.json
  try {
    const repoRoot = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
    ensureGitignored(path.join(repoRoot, '.gitignore'));
  } catch {
    // Not in a git repo or git not available — skip gitignore update.
  }
}

/**
 * Removes the credentials file if it exists (no-op if absent).
 */
export function deleteCredentials(): void {
  const p = credentialsPath();
  if (fs.existsSync(p)) {
    fs.unlinkSync(p);
  }
}

/**
 * Appends `device.json` to the given .gitignore file if not already present.
 * Idempotent: safe to call multiple times.
 */
export function ensureGitignored(gitignorePath: string): void {
  const entry = 'device.json';
  if (fs.existsSync(gitignorePath)) {
    const contents = fs.readFileSync(gitignorePath, 'utf8');
    // Match the entry as a whole line to avoid false positives
    if (contents.split('\n').some(line => line.trim() === entry)) {
      return; // Already present
    }
  }
  // Append with a leading newline to avoid joining an existing last line
  fs.appendFileSync(gitignorePath, `\n${entry}\n`, 'utf8');
}
