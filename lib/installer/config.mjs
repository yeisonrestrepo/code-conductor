import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

const LEVELS = ['MIN', 'INFO', 'VERBOSE'];

export function normalizeVerbosity(value) {
  if (typeof value !== 'string') return null;
  const m = /(?:VERBOSITY:\s*)?\b(MIN|INFO|VERBOSE)\b/i.exec(value.trim());
  return m ? m[1].toUpperCase() : null;
}

function setLevelLine(content, level) {
  if (/VERBOSITY:\s*\S+/i.test(content)) return content.replace(/VERBOSITY:\s*\S+/i, `VERBOSITY: ${level}`);
  return `${content.replace(/\s*$/, '')}\n\nVERBOSITY: ${level}\n`;
}

export function writeVerbosity(home, assetRoot, requested, flagGiven) {
  const file = join(home, '.claude', 'memory', 'verbosity.md');
  mkdirSync(dirname(file), { recursive: true });
  if (!existsSync(file)) copyFileSync(join(assetRoot, 'global', 'memory', 'verbosity.md'), file);
  const content = readFileSync(file, 'utf8');

  if (flagGiven) {
    const valid = normalizeVerbosity(typeof requested === 'string' ? requested : '');
    const level = valid || 'MIN';
    writeFileSync(file, setLevelLine(content, level), 'utf8');
    return { level, warn: valid ? null : `code-conductor: invalid --verbosity '${requested}', using MIN` };
  }
  const current = normalizeVerbosity(content);
  if (current) return { level: current, warn: null };
  writeFileSync(file, setLevelLine(content, 'MIN'), 'utf8');
  return { level: 'MIN', warn: 'code-conductor: verbosity.md unreadable, reset to MIN' };
}

export function seedMemoryFile(home, relName, assetRoot) {
  const dst = join(home, '.claude', 'memory', relName);
  if (existsSync(dst)) return false;
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(join(assetRoot, 'global', 'memory', relName), dst);
  return true;
}

// conductor-version.md is a plain data file, NOT markdown prose: exactly one bare
// semver line plus a trailing newline (e.g. "1.22.0\n"). No frontmatter, no heading.
// This matches the legacy install.sh contract, which reads it with `cat` and string-
// compares against the bare VERSION file, so any decoration would break the compare.
export function writeVersionFile(home, version) {
  const file = join(home, '.claude', 'memory', 'conductor-version.md');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${version}\n`, 'utf8');
}
