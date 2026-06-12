import { execSync, spawnSync, spawn } from 'child_process';
import * as path from 'path';

export function readSessionName(repoPath: string): string {
  const confPath = path.join(repoPath, 'conductor.conf');
  const out = execSync(
    `bash -c '. "${confPath}" && printf "%s" "$SESSION_NAME"'`,
    { encoding: 'utf8' }
  );
  return out.trim();
}

export function isTmuxSessionAlive(sessionName: string): boolean {
  return spawnSync('tmux', ['has-session', '-t', sessionName]).status === 0;
}

export async function waitForSession(sessionName: string, timeoutMs = 30000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (isTmuxSessionAlive(sessionName)) return true;
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

export async function startSession(repoPath: string): Promise<{ sessionName: string; status: 'started' | 'already-running' }> {
  const sessionName = readSessionName(repoPath);
  if (isTmuxSessionAlive(sessionName)) return { sessionName, status: 'already-running' };

  const conductorSh = path.join(repoPath, 'scripts', 'conductor.sh');
  const child = spawn('bash', [conductorSh], {
    cwd: repoPath,
    env: { ...process.env, CONDUCTOR_NO_ATTACH: '1' },
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  const appeared = await waitForSession(sessionName);
  if (!appeared) throw new Error(`Session "${sessionName}" did not appear within 30s`);
  return { sessionName, status: 'started' };
}

export function stopSession(sessionName: string, repoPath: string): void {
  const teardownSh = path.join(repoPath, 'scripts', 'teardown.sh');
  spawnSync('bash', [teardownSh], { cwd: repoPath, stdio: 'inherit' });
}
