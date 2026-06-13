import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';

export interface Skill {
  name: string;          // dir name = invocation name
  title?: string;        // frontmatter `name:` field
  description?: string;
  userInvocable: boolean; // frontmatter `user-invocable:` (default true)
  autoOnly: boolean;     // frontmatter `disable-model-invocation:` (default false)
  source: 'user' | 'project' | 'plugin';
}

// Module-level cache keyed by dir path; TTL 60 000 ms.
const skillCache = new Map<string, { data: Skill[]; at: number }>();
const SKILL_CACHE_TTL_MS = 60_000;

export function parseFrontmatter(content: string): Record<string, string> {
  const lines = content.split('\n');
  let firstDash = -1;
  let secondDash = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (line.trim() === '---') {
      if (firstDash === -1) {
        firstDash = i;
      } else {
        secondDash = i;
        break;
      }
    }
  }

  if (firstDash === -1 || secondDash === -1) {
    return {};
  }

  const result: Record<string, string> = {};
  const bodyLines = lines.slice(firstDash + 1, secondDash);
  let i = 0;

  while (i < bodyLines.length) {
    const line = bodyLines[i] ?? '';
    // Match "key: |" (block scalar) or "key: value"
    const blockMatch = /^(\S[^:]*?):\s*\|\s*$/.exec(line);
    const scalarMatch = /^(\S[^:]*?):\s*(.*?)\s*$/.exec(line);

    if (blockMatch) {
      const key = (blockMatch[1] ?? '').trim();
      i++;
      const valueLines: string[] = [];
      while (i < bodyLines.length) {
        const bodyLine = bodyLines[i] ?? '';
        if (/^[ \t]{2}/.test(bodyLine)) {
          valueLines.push(bodyLine.replace(/^[ \t]{2}/, ''));
          i++;
        } else {
          break;
        }
      }
      result[key] = valueLines.join('\n');
    } else if (scalarMatch) {
      const key = (scalarMatch[1] ?? '').trim();
      const value = scalarMatch[2] ?? '';
      result[key] = value;
      i++;
    } else {
      i++;
    }
  }

  return result;
}

export function scanSkillDir(dir: string, source: Skill['source']): Skill[] {
  const now = Date.now();
  const cached = skillCache.get(dir);
  if (cached !== undefined && now - cached.at < SKILL_CACHE_TTL_MS) {
    return cached.data;
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === 'ENOENT') {
      return [];
    }
    throw err;
  }

  const skills: Skill[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillMdPath = path.join(dir, entry.name, 'SKILL.md');
    if (!fs.existsSync(skillMdPath)) continue;

    let content: string;
    try {
      content = fs.readFileSync(skillMdPath, 'utf8');
    } catch {
      continue;
    }

    const fm = parseFrontmatter(content);
    const userInvocable = fm['user-invocable'] !== undefined
      ? fm['user-invocable'] !== 'false'
      : true;
    const autoOnly = fm['disable-model-invocation'] !== undefined
      ? fm['disable-model-invocation'] === 'true'
      : false;

    const skill: Skill = {
      name: entry.name,
      userInvocable,
      autoOnly,
      source,
    };

    if (fm['name'] !== undefined && fm['name'] !== '') {
      skill.title = fm['name'];
    }
    if (fm['description'] !== undefined && fm['description'] !== '') {
      skill.description = fm['description'];
    }

    skills.push(skill);
  }

  skillCache.set(dir, { data: skills, at: now });
  return skills;
}

export function getUserSkills(): Skill[] {
  const dir = path.join(os.homedir(), '.claude', 'skills');
  return scanSkillDir(dir, 'user');
}

export function getPluginSkills(): Skill[] {
  const pluginsDir = path.join(os.homedir(), '.claude', 'plugins');

  let pluginDirs: fs.Dirent[];
  try {
    pluginDirs = fs.readdirSync(pluginsDir, { withFileTypes: true });
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === 'ENOENT') {
      return [];
    }
    throw err;
  }

  const all: Skill[] = [];
  for (const pluginDir of pluginDirs) {
    if (!pluginDir.isDirectory()) continue;
    const skillsSubdir = path.join(pluginsDir, pluginDir.name, 'skills');
    const skills = scanSkillDir(skillsSubdir, 'plugin');
    all.push(...skills);
  }
  return all;
}

export function getProjectSkills(workdir: string): Skill[] {
  // Determine git root
  const result = spawnSync('git', ['-C', workdir, 'rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
  });
  const gitRoot = result.status === 0
    ? result.stdout.trim()
    : workdir;

  // Collect candidate dirs from workdir up to gitRoot (inclusive)
  const candidates: string[] = [];
  let current = path.resolve(workdir);
  const root = path.resolve(gitRoot);

  candidates.push(current);
  while (current !== root) {
    const parent = path.dirname(current);
    if (parent === current) break; // filesystem root guard
    current = parent;
    candidates.push(current);
    if (current === root) break;
  }

  // Scan each candidate and deduplicate by name (child overrides parent — first-seen wins)
  const seen = new Set<string>();
  const all: Skill[] = [];

  for (const candidate of candidates) {
    const skillsDir = path.join(candidate, '.claude', 'skills');
    const skills = scanSkillDir(skillsDir, 'project');
    for (const skill of skills) {
      if (!seen.has(skill.name)) {
        seen.add(skill.name);
        all.push(skill);
      }
    }
  }

  return all;
}

// Type guard for Node.js errors with a `code` property
function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}
