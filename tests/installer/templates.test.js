import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { scanLines, SENTINEL_START } from '../../lib/installer/merge-md.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKILLS = ['agent-delegation', 'code-simplifier', 'critical-review', 'memory-first', 'verbosity'];

describe('bundled CLAUDE.md templates', () => {
  it.each(['global/CLAUDE.md', 'project-template/CLAUDE.md'])('%s has exactly one balanced sentinel pair', (rel) => {
    const scan = scanLines(readFileSync(join(root, rel), 'utf8').replace(/\r\n/g, '\n'));
    expect(scan.status).toBe('balanced');
  });
  it('keeps ## Active Stack Profiles outside the managed block', () => {
    const text = readFileSync(join(root, 'project-template/CLAUDE.md'), 'utf8');
    const scan = scanLines(text.replace(/\r\n/g, '\n'));
    const stack = scan.headings.find(h => h.key === 'active stack profiles');
    expect(stack).toBeDefined();
    expect(stack.index).toBeLessThan(scan.start);
    expect(text).toContain('<!-- cc-stack:managed:');
  });
  // The engine skips template headings positioned after the managed block
  // (`h.index > tpl.start`), so a section placed below the block would silently
  // never be appended to any host. Lock the invariant the engine depends on.
  it.each(['global/CLAUDE.md', 'project-template/CLAUDE.md'])('%s keeps the managed block last', (rel) => {
    const scan = scanLines(readFileSync(join(root, rel), 'utf8').replace(/\r\n/g, '\n'));
    expect(scan.headings.every(h => h.index < scan.end)).toBe(true);
    expect(scan.lines.slice(scan.end + 1).every(l => l.trim() === '')).toBe(true);
  });
  it('wraps the conductor-owned half of project-template/CLAUDE.md', () => {
    const scan = scanLines(readFileSync(join(root, 'project-template/CLAUDE.md'), 'utf8').replace(/\r\n/g, '\n'));
    const keys = scan.headings.filter(h => h.index > scan.start && h.index < scan.end).map(h => h.key);
    expect(keys).toContain('agent identity');
    expect(keys).toContain('hard constraints');
    expect(keys).not.toContain('project identity');
  });
});

describe('bundled skills', () => {
  it('ships exactly the five known skills as directories', () => {
    const dirs = readdirSync(join(root, 'skills'), { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort();
    expect(dirs).toEqual([...SKILLS].sort());
  });
  it('ships no flat skill .md files', () => {
    const flat = readdirSync(join(root, 'skills'), { withFileTypes: true }).filter(e => e.isFile()).map(e => e.name);
    expect(flat).toEqual([]);
  });
  it.each(SKILLS)('%s/SKILL.md is non-empty with name and description frontmatter', (skill) => {
    const p = join(root, 'skills', skill, 'SKILL.md');
    expect(existsSync(p)).toBe(true);
    const content = readFileSync(p, 'utf8');
    expect(content.startsWith('---')).toBe(true);
    expect(content).toMatch(new RegExp(`^name: ${skill}$`, 'm'));
    expect(content).toMatch(/^description: .+$/m);
    expect(content.length).toBeGreaterThan(100);
  });
});

describe('project-template/gitignore', () => {
  it('ignores installer backups and crash-stranded temp files', () => {
    const lines = readFileSync(join(root, 'project-template/gitignore'), 'utf8').split('\n').map(l => l.trim());
    expect(lines).toContain('*.installer-backup.*');
    expect(lines).toContain('*.installer-tmp.*');
  });
});

// npm strips these names from every published tarball regardless of package.json
// `files`, so a bundled asset carrying one silently never ships (BUG-029).
const NPM_STRIPPED = new Set(['.gitignore', '.npmrc', '.npmignore']);

describe('shipped asset dirs', () => {
  it('carry no filename npm strips from published tarballs', () => {
    const offenders = [];
    const walk = (dir, rel) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) walk(join(dir, entry.name), `${rel}/${entry.name}`);
        else if (NPM_STRIPPED.has(entry.name)) offenders.push(`${rel}/${entry.name}`);
      }
    };
    for (const d of ['global', 'skills', 'scripts', 'project-template']) walk(join(root, d), d);
    expect(offenders).toEqual([]);
  });
});

const SETTINGS = ['.claude/settings.json', 'project-template/.claude/settings.json'];
const HOOK_MIRRORS = ['.claude/hooks/pre-tool-use.mjs', 'project-template/.claude/hooks/pre-tool-use.mjs'];
const readText = (rel) => readFileSync(join(root, rel), 'utf8').replace(/\r\n/g, '\n');

describe('pre-tool-use wiring', () => {
  it('ships the front door as one byte-identical mirrored pair', () => {
    expect(readText(HOOK_MIRRORS[0])).toBe(readText(HOOK_MIRRORS[1]));
  });

  // Read and Bash are asserted by name: their absence from the matcher is the defect
  // that made Guards 1, 3 and 4 unreachable on every deployed machine.
  it.each(SETTINGS)('%s gates Read and Bash through one union matcher', (rel) => {
    const entries = JSON.parse(readText(rel)).hooks.PreToolUse;
    expect(entries).toHaveLength(1);
    expect(entries[0].matcher).toBe('Read|Write|Edit|create_file|write_file|Bash');
    expect(entries[0].matcher.split('|')).toContain('Read');
    expect(entries[0].matcher.split('|')).toContain('Bash');
    expect(entries[0].hooks.map(h => h.command)).toEqual(['node .claude/hooks/pre-tool-use.mjs']);
  });

  it('leaves no CLAUDE_TOOL_NAME or CLAUDE_TOOL_INPUT reference in the shipped tree', () => {
    const offenders = [];
    const walk = (dir, rel) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) { walk(join(dir, entry.name), `${rel}/${entry.name}`); continue; }
        const text = readFileSync(join(dir, entry.name), 'utf8');
        if (/CLAUDE_TOOL_(NAME|INPUT)/.test(text)) offenders.push(`${rel}/${entry.name}`);
      }
    };
    for (const d of ['global', 'project-template']) walk(join(root, d), d);
    expect(offenders).toEqual([]);
  });
});
