import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { scanLines, SENTINEL_START, GITIGNORE_HEADER } from '../../lib/installer/merge-md.mjs';
import {
  GLOBAL_HOST_OWNED, PROJECT_HOST_OWNED,
  GLOBAL_SETTINGS_FINGERPRINTS, PROJECT_SETTINGS_FINGERPRINTS,
} from '../../lib/installer/host-owned.mjs';
import { matchingFingerprints } from '../../lib/installer/settings-merge.mjs';

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
  // A fresh install writes the template whole and a merge appends the block at EOF,
  // so a template with content after the block would give fresh and merged hosts two
  // different shapes. Lock the block-last invariant both paths share.
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
  it('opens with the header the .gitignore merge finds its block by', () => {
    const text = readFileSync(join(root, 'project-template/gitignore'), 'utf8');
    expect(text.split('\n')[0]).toBe(GITIGNORE_HEADER);
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

describe('guard 3 pattern block', () => {
  // The character-class trap, made structurally unrepeatable. [[:space:]] is
  // [ \t\n\r\f\v] in the C locale; JavaScript \s also matches U+00A0 and U+2028, so
  // one shorthand would silently widen every check and the port would disagree with
  // its own authority on input no reviewer would think to try.
  it('uses explicit character classes, never regex shorthands', () => {
    const text = readText('project-template/.claude/hooks/pre-tool-use.mjs');
    const start = text.indexOf('// ── Guard 3 constants');
    expect(start).toBeGreaterThan(-1);
    // Whole-line comments are excluded because the block's own header names the six
    // shorthands in order to forbid them. Asserting over prose would make the rule
    // unstatable in the one place a reader looks for it.
    const code = text.slice(start).split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
    expect(code).not.toMatch(/\\[sSwWdD]/);
  });

  // [BUG-044] replaces the assertion that no allowlist file is shipped. That test's stated
  // premise, "since deployProject copies the template wholesale", died with BUG-039:
  // deploy.mjs filters the copy through hostOwnedFilter, which excludes every table path
  // regardless of policy, and seedHostOwned then writes only when the target is absent. What
  // protects operator policy now is the row, not the file's absence, and deploy.test.js
  // proves a host file survives a re-run even when the template ships one.
  // Classification: ASSERTION-RETIREMENT, the BUG-039 shape. The assertion changed and got
  // stronger: it now pins the mechanism that carries the load instead of a proxy for it.
  it('declares the allowlist a seed row and ships its template, so a re-run cannot overwrite operator policy', () => {
    expect(PROJECT_HOST_OWNED.get('memory/bash-scan-allowlist.txt')).toBe('seed');
    expect(existsSync(join(root, 'project-template/.claude/memory/bash-scan-allowlist.txt'))).toBe(true);
  });

  // The seed must change no verdict. Parsed by g3ReadAllowlist's own rule: trim, drop
  // blanks, drop comments. A comment-only file is behaviorally identical to no file, which
  // is the honest limit of this remedy: its value is that the named path resolves and its
  // header teaches the format.
  it('ships an allowlist template that parses to zero entries', () => {
    const raw = readText('project-template/.claude/memory/bash-scan-allowlist.txt');
    const entries = raw.split('\n').map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('#'));
    expect(entries).toEqual([]);
  });
});

const SURFACES = [
  { name: 'global', dir: 'global', table: GLOBAL_HOST_OWNED, fingerprints: GLOBAL_SETTINGS_FINGERPRINTS },
  { name: 'project', dir: 'project-template/.claude', table: PROJECT_HOST_OWNED, fingerprints: PROJECT_SETTINGS_FINGERPRINTS },
];
const HOST_OWNED_ANYWHERE = new Set([...GLOBAL_HOST_OWNED.keys(), ...PROJECT_HOST_OWNED.keys()]);

function shippedPaths(absDir) {
  const out = [];
  const walk = (dir, rel) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const next = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(join(dir, entry.name), next);
      else out.push(next);
    }
  };
  walk(absDir, '');
  return out;
}

describe('host-owned tables cover the shipped trees', () => {
  it.each(SURFACES)('$name ships nothing marked skip', ({ dir, table }) => {
    const offenders = shippedPaths(join(root, dir)).filter((p) => table.get(p) === 'skip');
    expect(offenders).toEqual([]);
  });

  it.each(SURFACES)('$name has a template source for every seed and merge entry', ({ dir, table }) => {
    const missing = [];
    for (const [rel, policy] of table) {
      if (policy === 'skip') continue;
      if (!existsSync(join(root, dir, ...rel.split('/')))) missing.push(rel);
    }
    expect(missing).toEqual([]);
  });

  it.each(SURFACES)('$name declares a policy for every shipped path host-owned on either surface', ({ dir, table }) => {
    const undeclared = shippedPaths(join(root, dir)).filter((p) => HOST_OWNED_ANYWHERE.has(p) && !table.has(p));
    expect(undeclared).toEqual([]);
  });
});

describe('settings fingerprint coverage', () => {
  const entriesOf = (rel) => {
    const hooks = JSON.parse(readText(rel)).hooks;
    if (!hooks) return [];
    return Object.values(hooks).flatMap((v) => (Array.isArray(v) ? v : []));
  };
  const SHIPPED = [
    { rel: 'global/settings.json', fingerprints: GLOBAL_SETTINGS_FINGERPRINTS },
    { rel: 'project-template/.claude/settings.json', fingerprints: PROJECT_SETTINGS_FINGERPRINTS },
  ];

  // Backward: a fingerprint that matches nothing is dead, which happens when a
  // hook is renamed and the constant is not.
  it.each(SHIPPED)('$rel leaves no fingerprint dead', ({ rel, fingerprints }) => {
    const entries = entriesOf(rel);
    const dead = fingerprints.filter((fp) => !entries.some((e) => matchingFingerprints(e, [fp]).length === 1));
    expect(dead).toEqual([]);
  });

  // Forward: every shipped entry is by definition conductor-owned, so exhaustive
  // forward coverage is assertable today. Without it, a release can add a
  // template entry and forget its fingerprint, after which the merge either
  // never delivers it to existing installs or appends it beside itself on every
  // re-run. The two directions together are the contract; either alone is half.
  it.each(SHIPPED)('$rel matches every shipped entry to exactly one fingerprint', ({ rel, fingerprints }) => {
    const wrong = entriesOf(rel)
      .map((e, i) => ({ i, hits: matchingFingerprints(e, fingerprints) }))
      .filter((r) => r.hits.length !== 1);
    expect(wrong).toEqual([]);
  });

  // Vacuity asserted, not tolerated. global/settings.json ships permissions and
  // no hooks: its two entries are synthesized from the host's absolute home, so
  // a bare ~ cannot be shipped (settings.mjs:27-35) and the two mergers in
  // settings.mjs own them with their own tested fingerprints. Empty equals empty
  // today, and the day that file ships a hook entry this case fails first, ahead
  // of the forward assertion it would otherwise silently satisfy.
  it('global/settings.json ships no hook entry, matching its empty fingerprint list', () => {
    expect(entriesOf('global/settings.json')).toEqual([]);
    expect(GLOBAL_SETTINGS_FINGERPRINTS).toEqual([]);
  });
});

describe('seeded permissions', () => {
  // permissions is written exactly once, at seed time, and never again, so the
  // template's grant list is the only chance to deliver one. Pinning it verbatim
  // makes changing it force a touch of this test, and the review of that touch is
  // where the changelog's manual-add instruction gets written. Forgetting becomes
  // a failing test rather than a silent gap.
  it('global/settings.json ships exactly the four read-only grants', () => {
    expect(JSON.parse(readText('global/settings.json')).permissions).toEqual({
      allow: ['Bash(grep:*)', 'Bash(find:*)', 'Bash(ls:*)', 'Bash(cat:*)'],
      deny: [],
    });
  });
  it('project-template/.claude/settings.json ships an empty grant list', () => {
    expect(JSON.parse(readText('project-template/.claude/settings.json')).permissions).toEqual({ allow: [], deny: [] });
  });
});
