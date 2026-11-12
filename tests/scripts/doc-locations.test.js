import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  CANDIDATE_PAIRS, DEFAULT_PAIR, DIR_MAX, DocLocationError, GROUP_MAX,
  backlogGroup, checkDocDir, discoverPair, readRecordedPair, resolveDocLocations,
} from '../../scripts/doc-locations.mjs';
import { V3_CAPS } from '../../scripts/snap-contract.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = join(REPO_ROOT, 'scripts/doc-locations.mjs');
const DOCS = { specs: 'docs/specs', plans: 'docs/plans' };
const CLAUDE_PAIR = { specs: '.claude/specs', plans: '.claude/plans' };
const SUPER = { specs: 'docs/superpowers/specs', plans: 'docs/superpowers/plans' };
const G6 = '## PILLAR 3: MULTI-AGENT SOFTWARE FACTORY\n\n### [ ] `[FEAT-047]` Spec and Plan Location Discovery\n';

let root;
beforeEach(() => { root = realpathSync(mkdtempSync(join(tmpdir(), 'cc-docloc-'))); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

function write(rel, text) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
}
const md = (rel) => write(rel, '');
const dir = (rel) => mkdirSync(join(root, rel), { recursive: true });
const claudeMd = (text) => write('CLAUDE.md', text);
const backlog = (name, text) => write(name, text);
const recorded = (specs, plans) => claudeMd(`## Development Commands\n- Specs: ${specs}\n- Plans: ${plans}\n`);
function cli(target) {
  const r = spawnSync(process.execPath, [SCRIPT, target], { cwd: root, encoding: 'utf8', timeout: 30000 });
  if (r.error) throw new Error(`doc-locations spawn failed: ${r.error.message}`);
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}
function invalid(fn) {
  try { fn(); } catch (e) { if (e instanceof DocLocationError) return e; throw e; }
  throw new Error('expected a DocLocationError');
}
const disjoint = ({ specs, plans }) => !(specs === plans || specs.startsWith(`${plans}/`) || plans.startsWith(`${specs}/`));

describe('discovery [FEAT-047 AC1]', () => {
  it('resolves a lone .claude/specs to the .claude pair', () => {
    md('.claude/specs/a.md');
    expect(discoverPair(root)).toEqual(CLAUDE_PAIR);
  });

  it('treats an empty docs/specs dir as a present half pair', () => {
    dir('docs/specs');
    expect(discoverPair(root)).toEqual(DOCS);
  });

  it('resolves docs/plans alone to the docs pair', () => {
    md('docs/plans/x.md');
    expect(discoverPair(root)).toEqual(DOCS);
  });

  it('picks the pair with the most .md files, counted recursively', () => {
    md('.claude/specs/a.md');
    md('docs/superpowers/plans/a/b.md');
    md('docs/superpowers/specs/c.md');
    expect(discoverPair(root)).toEqual(SUPER);
  });

  it('breaks a tie in favour of the earlier pair', () => {
    md('.claude/plans/a.md');
    md('docs/specs/b.md');
    expect(discoverPair(root)).toEqual(CLAUDE_PAIR);
  });

  it('breaks a zero-count tie in favour of the earlier pair', () => {
    dir('docs/specs');
    dir('docs/superpowers/specs');
    expect(discoverPair(root)).toEqual(DOCS);
  });

  it('does not count a non-.md file', () => {
    md('.claude/specs/a.md');
    write('docs/superpowers/specs/a.txt', '');
    write('docs/superpowers/plans/b.markdown', '');
    expect(discoverPair(root)).toEqual(CLAUDE_PAIR);
  });

  it('returns null when no pair is present', () => {
    expect(discoverPair(root)).toBe(null);
  });
});

describe('default [FEAT-047 AC2]', () => {
  it('falls back to docs/specs + docs/plans and creates nothing', () => {
    expect(resolveDocLocations(root, 'FEAT-1')).toEqual({ specs: 'docs/specs', plans: 'docs/plans', group: null, source: 'default' });
    expect(existsSync(join(root, 'docs'))).toBe(false);
  });
});

describe('recorded [FEAT-047]', () => {
  it('reads both lines from CLAUDE.md', () => {
    recorded('documentation/rfcs', 'documentation/plans');
    expect(resolveDocLocations(root, null)).toEqual({ specs: 'documentation/rfcs', plans: 'documentation/plans', group: null, source: 'claude-md' });
  });

  it('reads both lines from a CRLF CLAUDE.md', () => {
    claudeMd('## Development Commands\r\n- Specs: documentation/rfcs\r\n- Plans: documentation/plans\r\n');
    expect(readRecordedPair(root)).toEqual({ specs: 'documentation/rfcs', plans: 'documentation/plans' });
  });

  it('strips a trailing slash', () => {
    recorded('documentation/rfcs/', 'documentation/plans/');
    expect(readRecordedPair(root)).toEqual({ specs: 'documentation/rfcs', plans: 'documentation/plans' });
  });

  it('wins over a busier discovered pair (S7)', () => {
    recorded('documentation/rfcs', 'documentation/plans');
    md('docs/specs/a.md');
    md('docs/plans/b.md');
    expect(resolveDocLocations(root, null).source).toBe('claude-md');
  });

  it('wins when its folder does not exist (S8)', () => {
    recorded('gone/specs', 'gone/plans');
    expect(resolveDocLocations(root, null)).toMatchObject({ specs: 'gone/specs', plans: 'gone/plans', source: 'claude-md' });
  });

  it('returns null when neither line is present or CLAUDE.md is absent', () => {
    expect(readRecordedPair(root)).toBe(null);
    claudeMd('## Development Commands\n- Test: npm test\n');
    expect(readRecordedPair(root)).toBe(null);
  });
});

describe('recorded errors [FEAT-047]', () => {
  const cases = [
    ['only Specs', '- Specs: a/specs\n', /- Plans:/],
    ['only Plans', '- Plans: a/plans\n', /- Specs:/],
    ['<command>', '- Specs: <command>\n- Plans: a/plans\n', /- Specs: <command>/],
    ['a .. segment', '- Specs: ../up\n- Plans: a/plans\n', /- Specs: \.\.\/up/],
    ['a leading slash', '- Specs: a/specs\n- Plans: /abs\n', /- Plans: \/abs/],
    ['a drive letter', '- Specs: a/specs\n- Plans: C:/x\n', /- Plans: C:\/x/],
    ['a backslash', '- Specs: a\\b\n- Plans: a/plans\n', /- Specs: a\\b/],
    ['a glob character', '- Specs: docs/*\n- Plans: a/plans\n', /- Specs: docs\/\*/],
    ['.claude/memory', '- Specs: .claude/memory/x\n- Plans: a/plans\n', /- Specs: \.claude\/memory\/x/],
    ['.conductor', '- Specs: .conductor\n- Plans: a/plans\n', /- Specs: \.conductor/],
    ['.git', '- Specs: a/specs\n- Plans: .git/x\n', /- Plans: \.git\/x/],
    ['equal values', '- Specs: a/docs\n- Plans: a/docs\n', /overlap/],
    ['plans nested in specs', '- Specs: docs/a\n- Plans: docs/a/plans\n', /overlap/],
    ['specs nested in plans', '- Specs: docs/a/specs\n- Plans: docs/a\n', /overlap/],
  ];
  for (const [name, lines, reason] of cases) {
    it(`throws ORCH_DOC_LOCATION_INVALID for ${name}`, () => {
      claudeMd(`## Development Commands\n${lines}`);
      const e = invalid(() => resolveDocLocations(root, null));
      expect(e.code).toBe('ORCH_DOC_LOCATION_INVALID');
      expect(e.reason).toMatch(reason);
      expect(e.message).toBe(`ORCH_DOC_LOCATION_INVALID: ${e.reason}`);
    });
  }
});

describe('checkDocDir boundary [FEAT-047 AC9]', () => {
  it('passes 249 characters and fails 250', () => {
    expect(checkDocDir('a'.repeat(249))).toBe('');
    expect(checkDocDir('a'.repeat(250))).not.toBe('');
  });

  it('derives DIR_MAX from the v3 ops.scope cap', () => {
    expect(DIR_MAX).toBe(V3_CAPS['ops.scope'][1] - 51);
    expect(GROUP_MAX).toBe(47);
  });

  it('accepts every fixed pair, each disjoint', () => {
    expect(CANDIDATE_PAIRS).toEqual([CLAUDE_PAIR, DOCS, SUPER]);
    expect(DEFAULT_PAIR).toEqual(DOCS);
    for (const pair of [...CANDIDATE_PAIRS, DEFAULT_PAIR]) {
      expect(checkDocDir(pair.specs)).toBe('');
      expect(checkDocDir(pair.plans)).toBe('');
      expect(disjoint(pair)).toBe(true);
    }
  });

  it('compares reserved roots segment-wise', () => {
    // .claude/memoryx is now refused by the .claude allowlist (pre-1.44.0 hardening), so the
    // segment-wise acceptance is pinned on a reserved root outside .claude.
    expect(checkDocDir('.conductorx')).toBe('');
    expect(checkDocDir('.claude/memoryx')).not.toBe('');
    expect(checkDocDir('.github/specs')).not.toBe('');
    expect(checkDocDir('.claude/memory')).not.toBe('');
  });
});

// The recorded folder becomes the spec and plan agents' Guard 5 write scope, so it must never
// cover a folder that holds enforcement code, nor a parent of one.
describe('checkDocDir reserved folders [FEAT-047 AC9, review #120]', () => {
  it.each([
    '.claude', '.', '.claude/hooks', '.claude/agents', '.claude/commands', '.claude/scripts',
    '.github', 'scripts', '.claude/hooks/sub', '.github/specs',
  ])('rejects %s with a reason', (value) => {
    expect(checkDocDir(value)).not.toBe('');
  });

  it.each([
    './.claude/hooks/', '.claude/./hooks', '.claude//hooks', '.Claude/Hooks', 'SCRIPTS',
    '.claude\\hooks', './docs/specs', 'docs/./specs', './',
  ])('rejects the non-canonical or case-variant %s', (value) => {
    expect(checkDocDir(value)).not.toBe('');
  });

  // Pre-1.44.0 hardening: inside .claude only specs and plans may hold documents, and
  // .opencode holds the OpenCode guard.
  it.each([
    '.claude/skills', '.claude/skills/x', '.Claude/Skills', '.claude/settings', '.claude/rules',
    '.opencode', '.opencode/plugin',
  ])('rejects %s, which holds agent instructions or guard code', (value) => {
    expect(checkDocDir(value)).not.toBe('');
  });

  it.each([
    '.claude/specs', '.claude/plans', '.claude/specs/pillar-1', '.Claude/Specs', '.CLAUDE/plans/x', 'docs/specs',
  ])('still accepts %s', (value) => {
    expect(checkDocDir(value)).toBe('');
  });

  it.each(['.claude/hooksx', '.claude/specsx', '.claude/plans-old'])('compares the .claude allowlist segment-wise: rejects %s', (value) => {
    expect(checkDocDir(value)).not.toBe('');
  });

  it('names the reserved folder a parent covers', () => {
    expect(checkDocDir('.claude')).toMatch(/\.claude\/memory/);
    expect(checkDocDir('.claude/hooks')).toMatch(/reserved `\.claude\/hooks`/);
  });

  it.each(['.claude/specs', '.claude/plans', 'docs/scripts', 'scriptsx', '.githubx', '.opencodex', 'docs/specs/'])(
    'still accepts %s', (value) => {
      expect(checkDocDir(value)).toBe('');
    },
  );
});

describe('grouping [FEAT-047 AC7, AC8]', () => {
  const groupOf = (text, item = 'FEAT-900') => { backlog('BACKLOG.md', text); return backlogGroup(root, item); };

  it('G6: a minimal agent-readable backlog groups FEAT-047 under pillar-3', () => {
    backlog('AGENT-READABLE BACKLOG.md', G6);
    expect(backlogGroup(root, 'FEAT-047')).toBe('pillar-3');
  });

  it('numbers a pillar', () => {
    expect(groupOf('## PILLAR 3: FACTORY\n### [ ] `[FEAT-900]` x\n')).toBe('pillar-3');
  });

  it('slugs an unnumbered epic (G2)', () => {
    expect(groupOf('## Epic: User Auth\n### FEAT-900 x\n')).toBe('epic-user-auth');
  });

  it('numbers a phase', () => {
    expect(groupOf('# Phase 2\n## FEAT-900 x\n')).toBe('phase-2');
  });

  it('cuts a slug to 40 characters, then trims a trailing dash', () => {
    expect(groupOf(`## Epic: ${'a'.repeat(39)} b c\n### FEAT-900\n`)).toBe(`epic-${'a'.repeat(39)}`);
  });

  it('stays flat on an empty slug', () => {
    expect(groupOf('## Epic: !!!\n### FEAT-900\n')).toBe(null);
  });

  it('stays flat with no group heading (G3)', () => {
    expect(groupOf('# Backlog\n### FEAT-900\n')).toBe(null);
  });

  it('stays flat when the item is in two backlog files (G4)', () => {
    backlog('a-backlog.md', '## Pillar 1\n### FEAT-900\n');
    expect(groupOf('## Pillar 1\n### FEAT-900\n')).toBe(null);
  });

  it('stays flat with no backlog file (G5)', () => {
    expect(backlogGroup(root, 'FEAT-900')).toBe(null);
  });

  it('stays flat when the item appears twice in one file', () => {
    expect(groupOf('## Pillar 1\n### FEAT-900\n### FEAT-900 again\n')).toBe(null);
  });

  it('closes a group at a same-level non-group heading', () => {
    expect(groupOf('## Pillar 2\n## Bugs\n### FEAT-900\n')).toBe(null);
  });

  it('keeps a group open under a deeper heading', () => {
    expect(groupOf('## Pillar 2\n### Notes\n#### FEAT-900\n')).toBe('pillar-2');
  });

  it('stays flat when the name would exceed GROUP_MAX', () => {
    expect(groupOf(`## Pillar 1${'2'.repeat(45)}\n### FEAT-900\n`)).toBe(null);
  });

  it('matches the id whole', () => {
    expect(groupOf('## Pillar 1\n### FEAT-9000\n### FEAT-900-B\n### xFEAT-900\n')).toBe(null);
  });

  it('escapes a regex metacharacter in the id', () => {
    expect(groupOf('## Pillar 1\n### FEATX900\n', 'FEAT.900')).toBe(null);
    rmSync(join(root, 'BACKLOG.md'));
    expect(groupOf('## Pillar 1\n### FEAT.900\n', 'FEAT.900')).toBe('pillar-1');
  });

  it('scans only root .md files whose name holds "backlog"', () => {
    backlog('notes.md', '## Pillar 1\n### FEAT-900\n');
    expect(backlogGroup(root, 'FEAT-900')).toBe(null);
    backlog('my-Backlog.md', '## Pillar 4\n### FEAT-900\n');
    expect(backlogGroup(root, 'FEAT-900')).toBe('pillar-4');
  });
});

describe('this repository layout as a fixture [FEAT-047 AC3]', () => {
  it('discovers docs/superpowers and groups FEAT-047 under pillar-3', () => {
    claudeMd('# Project\n## Development Commands\n- Test: N/A\n');
    md('docs/superpowers/specs/a-design.md');
    md('docs/superpowers/plans/a.md');
    backlog('AGENT-READABLE BACKLOG.md', G6);
    expect(resolveDocLocations(root, 'FEAT-047')).toEqual({ ...SUPER, group: 'pillar-3', source: 'discovered' });
  });
});

describe('CLI contract [FEAT-047 AC14]', () => {
  const oneLine = (s) => s.trim() !== '' && !s.trim().includes('\n');

  it('prints the recorded pair', () => {
    recorded('documentation/rfcs', 'documentation/plans');
    const r = cli(root);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ specs: 'documentation/rfcs', plans: 'documentation/plans', source: 'claude-md' });
    expect(r.stderr).toBe('');
  });

  it('prints a discovered pair when neither line is recorded', () => {
    claudeMd('## Development Commands\n- Test: npm test\n');
    dir('docs/plans');
    const r = cli(root);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ ...DOCS, source: 'discovered' });
  });

  it('prints the default pair for an empty root, with no group key', () => {
    backlog('BACKLOG.md', '## Pillar 1\n### FEAT-1\n');
    const r = cli(root);
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out).toEqual({ ...DOCS, source: 'default' });
    expect('group' in out).toBe(false);
  });

  for (const [name, lines] of [
    ['half-recorded', '- Specs: a/specs\n'],
    ['an invalid value', '- Specs: ../up\n- Plans: a/plans\n'],
    ['an overlap', '- Specs: docs/a\n- Plans: docs/a/plans\n'],
  ]) {
    it(`exits 1 with one ORCH_DOC_LOCATION_INVALID line for ${name}`, () => {
      claudeMd(`## Development Commands\n${lines}`);
      const r = cli(root);
      expect(r.status).toBe(1);
      expect(r.stdout).toBe('');
      expect(oneLine(r.stderr)).toBe(true);
      expect(r.stderr.startsWith('ORCH_DOC_LOCATION_INVALID: ')).toBe(true);
    });
  }

  it('exits 1 with one non-ORCH line when root is a regular file', () => {
    write('file.txt', 'x');
    const r = cli(join(root, 'file.txt'));
    expect(r.status).toBe(1);
    expect(r.stdout).toBe('');
    expect(oneLine(r.stderr)).toBe(true);
    expect(r.stderr.startsWith('ORCH_')).toBe(false);
  });
});

describe('module hygiene [FEAT-047 AC10, AC11]', () => {
  const source = () => readFileSync(SCRIPT, 'utf8').replace(/\r\n/g, '\n');

  it('importing doc-locations.mjs adds no process listener and prints nothing', () => {
    const probe = `const events = ['uncaughtException', 'unhandledRejection', 'exit'];
const count = () => events.map((e) => process.listenerCount(e));
const before = count();
await import(${JSON.stringify(pathToFileURL(SCRIPT).href)});
process.stderr.write(JSON.stringify({ before, after: count(), exitCode: process.exitCode ?? null }));`;
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', probe], { cwd: root, encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
    const seen = JSON.parse(r.stderr);
    expect(seen.after).toEqual(seen.before);
    expect(seen.exitCode).toBe(null);
  });

  it('imports only node: builtins and ./snap-contract.mjs', () => {
    const specifiers = [...source().matchAll(/^import\s[^;]*?from\s+'([^']+)'/gm)].map((m) => m[1]);
    expect(specifiers.length).toBeGreaterThan(0);
    for (const s of specifiers) expect(s.startsWith('node:') || s === './snap-contract.mjs').toBe(true);
  });

  it('contains no write call', () => {
    const text = source();
    for (const call of ['writeFileSync', 'appendFileSync', 'mkdirSync', 'rmSync', 'renameSync', 'createWriteStream']) {
      expect(text.includes(call)).toBe(false);
    }
  });
});
