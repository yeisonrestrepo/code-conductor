import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RECORD_FILES, ANCHOR_NEVER, ANCHOR_RECORDS,
  checkVersionFile, checkPackageJson, checkLockfile,
  checkChangelog, checkBacklog, checkRecord, evaluate, parseArgs,
} from '../../tools/records-guard.mjs';
import { cleanGitEnv } from '../helpers/git-env.js';

const TOOL = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'tools', 'records-guard.mjs');

const BOM = '﻿';

const pkg = (over = {}, indent = 2) =>
  JSON.stringify({ name: 'code-conductor', version: '1.43.0', scripts: { test: 'vitest run' }, devDependencies: { vitest: '^3.2.0' }, ...over }, null, indent) + '\n';
const lock = ({ root = '1.43.0', pkgRoot = '1.43.0', dep = '3.2.4' } = {}) => JSON.stringify({
  name: 'code-conductor', version: root, lockfileVersion: 3,
  packages: { '': { name: 'code-conductor', version: pkgRoot }, 'node_modules/vitest': { version: dep } },
}, null, 2) + '\n';

describe('constants', () => {
  it('names exactly the five owner-side record files, frozen, without README', () => {
    expect(RECORD_FILES).toEqual(['VERSION', 'package.json', 'package-lock.json', 'CHANGELOG.md', 'AGENT-READABLE BACKLOG.md']);
    expect(Object.isFrozen(RECORD_FILES)).toBe(true);
    expect(RECORD_FILES).not.toContain('README.md');
  });

  it('points at the two CONTRIBUTING anchors', () => {
    expect(ANCHOR_NEVER).toBe('CONTRIBUTING.md#what-contributors-must-never-do');
    expect(ANCHOR_RECORDS).toBe('CONTRIBUTING.md#records-are-owner-side');
  });
});

describe('checkVersionFile', () => {
  it('reports a changed version as one violation', () => {
    expect(checkVersionFile('1.43.0\n', '1.44.0\n').violations).toEqual(['1.43.0 -> 1.44.0']);
  });

  // Each of these changes bytes but not the value, so none is a contributor touching the record.
  it.each([
    ['a dropped trailing newline', '1.43.0'],
    ['a CRLF line ending', '1.43.0\r\n'],
    ['a leading BOM', `${BOM}1.43.0\n`],
  ])('ignores %s', (_label, head) => {
    expect(checkVersionFile('1.43.0\n', head).violations).toEqual([]);
  });
});

describe('checkPackageJson', () => {
  it('reports a version bump as one violation naming both values', () => {
    const { violations } = checkPackageJson(pkg(), pkg({ version: '1.44.0' }));
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('1.43.0 -> 1.44.0');
  });

  it.each([
    ['a scripts change', pkg({ scripts: { test: 'vitest run --reporter=dot' } })],
    ['a devDependencies change', pkg({ devDependencies: { vitest: '^3.3.0' } })],
    ['a re-indent', pkg({}, 4)],
    ['CRLF line endings', pkg().replace(/\n/g, '\r\n')],
  ])('passes %s', (_label, head) => {
    expect(checkPackageJson(pkg(), head).violations).toEqual([]);
  });

  it('treats a version removed at head as a change', () => {
    expect(checkPackageJson(pkg(), pkg({ version: undefined })).violations).toHaveLength(1);
  });

  it('strips a BOM on either side before parsing', () => {
    const result = checkPackageJson(BOM + pkg(), pkg());
    expect(result).toEqual({ violations: [] });
    expect(result.error).toBeUndefined();
  });

  it('returns a head-side error for invalid JSON at head, without throwing', () => {
    const result = checkPackageJson(pkg(), '{ nope');
    expect(result.error.side).toBe('head');
    expect(typeof result.error.message).toBe('string');
  });

  it('returns a base-side error for invalid JSON at base, without throwing', () => {
    expect(checkPackageJson('{ nope', pkg()).error.side).toBe('base');
  });
});

describe('checkLockfile', () => {
  it('reports both root versions when both change', () => {
    const { violations } = checkLockfile(lock(), lock({ root: '1.44.0', pkgRoot: '1.44.0' }));
    expect(violations).toHaveLength(2);
    expect(violations.some((v) => v.startsWith('version '))).toBe(true);
    expect(violations.some((v) => v.startsWith('packages[""].version '))).toBe(true);
  });

  it.each([
    ['the root version only', { root: '1.44.0' }],
    ['packages[""] only', { pkgRoot: '1.44.0' }],
  ])('reports %s as one violation', (_label, over) => {
    expect(checkLockfile(lock(), lock(over)).violations).toHaveLength(1);
  });

  it('passes a dependency bump under node_modules', () => {
    expect(checkLockfile(lock(), lock({ dep: '3.2.5' })).violations).toEqual([]);
  });

  it('passes a lockfile with no packages key on either side', () => {
    const bare = JSON.stringify({ name: 'code-conductor', version: '1.43.0', lockfileVersion: 1 }) + '\n';
    expect(checkLockfile(bare, bare).violations).toEqual([]);
  });

  it('strips a BOM at head before parsing', () => {
    const result = checkLockfile(lock(), BOM + lock());
    expect(result).toEqual({ violations: [] });
    expect(result.error).toBeUndefined();
  });
});

const CHANGELOG = '# Changelog\n\n## [Unreleased]\n\n## [1.43.0] - 2026-11-01\n\n- Fixed a tpyo.\n\n## [1.42.0] - 2026-10-20\n\n- Older.\n';
const BACKLOG = [
  '# Backlog', '',
  '### [ ] `[FEAT-045]` CI Records-Guard', '', 'Open text.', '',
  '### [X] `[FEAT-044]` Flow viewer', '', '* **DONE in 1.43.0.**', '',
  '### [~] `[BUG-010]` Parked', '', 'Mentions a DONE line mid-sentence.', '',
].join('\n');

const changelogWith = (from, to) => CHANGELOG.replace(from, to);
const backlogWith = (from, to) => BACKLOG.replace(from, to);
const backlogLines = () => BACKLOG.split('\n');

describe('checkChangelog', () => {
  it('reports an added release heading', () => {
    const head = changelogWith('## [1.43.0]', '## [1.44.0] - 2026-11-08\n\n## [1.43.0]');
    const { violations } = checkChangelog(CHANGELOG, head);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('release heading [1.44.0] added');
  });

  it('reports an added release-candidate heading', () => {
    const head = changelogWith('## [1.43.0]', '## [1.44.0-rc.1]\n\n## [1.43.0]');
    expect(checkChangelog(CHANGELOG, head).violations).toHaveLength(1);
  });

  it('reports a removed release heading', () => {
    const head = changelogWith('## [1.42.0] - 2026-10-20\n', '');
    expect(checkChangelog(CHANGELOG, head).violations).toEqual(['release heading [1.42.0] removed']);
  });

  // None of these changes the set of released versions, which is the only record here.
  it.each([
    ['an [Unreleased] body line', changelogWith('## [Unreleased]\n', '## [Unreleased]\n\n- New entry.\n')],
    ['a lower-case [unreleased] heading', changelogWith('## [Unreleased]', '## [unreleased]')],
    ['a typo fix', changelogWith('tpyo', 'typo')],
    ['a date edit', changelogWith('2026-11-01', '2026-11-02')],
    ['a duplicated release heading', changelogWith('## [1.42.0]', '## [1.43.0]\n\n## [1.42.0]')],
    ['an indented heading', changelogWith('- Older.', '- Older.\n  ## [1.44.0]')],
    ['a heading inside prose', changelogWith('- Older.', '- Older, see ## [1.44.0]')],
    ['CRLF line endings', CHANGELOG.replace(/\n/g, '\r\n')],
  ])('passes %s', (_label, head) => {
    expect(checkChangelog(CHANGELOG, head).violations).toEqual([]);
  });
});

describe('checkBacklog headings', () => {
  it('reports a heading flip naming the id and both states', () => {
    const head = backlogWith('### [ ] `[FEAT-045]`', '### [X] `[FEAT-045]`');
    const { violations } = checkBacklog(BACKLOG, head);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('FEAT-045 heading [ ] -> [X]');
  });

  it.each([
    ['[X] -> [ ] on FEAT-044', backlogWith('### [X] `[FEAT-044]`', '### [ ] `[FEAT-044]`')],
    ['[ ] -> [~] on FEAT-045', backlogWith('### [ ] `[FEAT-045]`', '### [~] `[FEAT-045]`')],
    ['[~] -> [X] on BUG-010', backlogWith('### [~] `[BUG-010]`', '### [X] `[BUG-010]`')],
    ['a new [X] item', `${BACKLOG}### [X] \`[FEAT-099]\` x\n`],
    ['a new [~] item', `${BACKLOG}### [~] \`[FEAT-099]\` x\n`],
    ['removing the FEAT-044 heading', backlogWith('### [X] `[FEAT-044]` Flow viewer', '')],
    ['removing the BUG-010 heading', backlogWith('### [~] `[BUG-010]` Parked', '')],
  ])('reports %s', (_label, head) => {
    expect(checkBacklog(BACKLOG, head).violations).toHaveLength(1);
  });

  // An absent id reads as open, and a lower-case x is the same done state.
  it.each([
    ['a new open item', `${BACKLOG}### [ ] \`[FEAT-099]\` x\n`],
    ['removing the open FEAT-045 heading', backlogWith('### [ ] `[FEAT-045]` CI Records-Guard', '')],
    ['[X] -> [x] on FEAT-044', backlogWith('### [X] `[FEAT-044]`', '### [x] `[FEAT-044]`')],
  ])('passes %s', (_label, head) => {
    expect(checkBacklog(BACKLOG, head).violations).toEqual([]);
  });
});

describe('checkBacklog DONE lines', () => {
  it('reports an added DONE line with its head line number', () => {
    const lines = backlogLines();
    lines.splice(3, 0, '* **DONE in 1.44.0.**');
    expect(checkBacklog(BACKLOG, lines.join('\n')).violations).toEqual(['DONE line added at line 4']);
  });

  it('reports a removed DONE line with its base line number', () => {
    const lines = backlogLines();
    lines.splice(8, 1);
    expect(checkBacklog(BACKLOG, lines.join('\n')).violations).toEqual(['DONE line removed (base line 9)']);
  });

  it('reports an edited DONE line as one added and one removed', () => {
    const head = backlogWith('* **DONE in 1.43.0.**', '* **DONE in 1.43.1.**');
    const { violations } = checkBacklog(BACKLOG, head);
    expect(violations).toHaveLength(2);
    expect(violations.some((v) => v.startsWith('DONE line added'))).toBe(true);
    expect(violations.some((v) => v.startsWith('DONE line removed'))).toBe(true);
  });

  it('passes an edit to non-DONE text', () => {
    expect(checkBacklog(BACKLOG, backlogWith('Open text.', 'Edited text.')).violations).toEqual([]);
  });

  it('counts a duplicated DONE line as one added, as a multiset', () => {
    const head = backlogWith('* **DONE in 1.43.0.**', '* **DONE in 1.43.0.**\n* **DONE in 1.43.0.**');
    expect(checkBacklog(BACKLOG, head).violations).toEqual(['DONE line added at line 10']);
  });

  it('reports every violation when a heading flip and a DONE line land together', () => {
    const head = backlogWith('### [ ] `[FEAT-045]` CI Records-Guard', '### [X] `[FEAT-045]` CI Records-Guard\n* **DONE in 1.44.0.**');
    const { violations } = checkBacklog(BACKLOG, head);
    expect(violations).toHaveLength(2);
    expect(violations[0]).toContain('FEAT-045 heading [ ] -> [X]');
    expect(violations[1]).toBe('DONE line added at line 4');
  });
});

const BASE_TEXT = {
  'VERSION': '1.43.0\n',
  'package.json': pkg(),
  'package-lock.json': lock(),
  'CHANGELOG.md': CHANGELOG,
  'AGENT-READABLE BACKLOG.md': BACKLOG,
};
const REVS = { base: 'abc123', head: 'def456' };
const same = () => RECORD_FILES.map((path) => ({ path, base: BASE_TEXT[path], head: BASE_TEXT[path] }));
const withRecord = (path, base, head) => same().map((f) => (f.path === path ? { path, base, head } : f));
const withHead = (path, head) => withRecord(path, BASE_TEXT[path], head);

describe('checkRecord path and anchor', () => {
  it('prefixes a VERSION violation with the path and ends with the never-do anchor', () => {
    expect(checkRecord('VERSION', '1.43.0\n', '1.44.0\n').violations)
      .toEqual(['RECORDS_GUARD_VIOLATION VERSION: 1.43.0 -> 1.44.0; see CONTRIBUTING.md#what-contributors-must-never-do']);
  });

  it.each([
    ['package.json', pkg(), pkg({ version: '1.44.0' }), 'version 1.43.0 -> 1.44.0'],
    ['package-lock.json', lock(), lock({ pkgRoot: '1.44.0' }), 'packages[""].version 1.43.0 -> 1.44.0'],
    ['CHANGELOG.md', CHANGELOG, changelogWith('## [1.43.0]', '## [1.44.0]\n\n## [1.43.0]'), 'release heading [1.44.0] added'],
  ])('names %s and the never-do anchor', (path, base, head, detail) => {
    const [line] = checkRecord(path, base, head).violations;
    expect(line.startsWith(`RECORDS_GUARD_VIOLATION ${path}: `)).toBe(true);
    expect(line).toContain(detail);
    expect(line.endsWith(`; see ${ANCHOR_NEVER}`)).toBe(true);
  });

  it.each([
    ['a heading flip', backlogWith('### [ ] `[FEAT-045]`', '### [X] `[FEAT-045]`')],
    ['an added DONE line', backlogWith('Open text.', 'Open text.\n* **DONE in 1.44.0.**')],
  ])('names the backlog and the records anchor for %s', (_label, head) => {
    const [line] = checkRecord('AGENT-READABLE BACKLOG.md', BACKLOG, head).violations;
    expect(line.startsWith('RECORDS_GUARD_VIOLATION AGENT-READABLE BACKLOG.md: ')).toBe(true);
    expect(line.endsWith(`; see ${ANCHOR_RECORDS}`)).toBe(true);
  });

  it('throws for a path that is not a record file', () => {
    expect(() => checkRecord('README.md', 'a', 'b')).toThrow();
  });
});

describe('checkRecord presence rules', () => {
  it.each(RECORD_FILES.map((p) => [p]))('reports %s deleted or renamed at head', (path) => {
    const anchor = path === 'AGENT-READABLE BACKLOG.md' ? ANCHOR_RECORDS : ANCHOR_NEVER;
    expect(checkRecord(path, BASE_TEXT[path], null).violations)
      .toEqual([`RECORDS_GUARD_VIOLATION ${path}: deleted or renamed at head; see ${anchor}`]);
  });

  it('reports a record created at head', () => {
    expect(checkRecord('VERSION', null, '1.44.0\n').violations)
      .toEqual([`RECORDS_GUARD_VIOLATION VERSION: created at head; see ${ANCHOR_NEVER}`]);
  });

  it('skips a record absent on both sides', () => {
    expect(checkRecord('VERSION', null, null)).toEqual({ compared: false, violations: [] });
  });

  it('counts only compared records in the OK line', () => {
    expect(evaluate(withRecord('VERSION', null, null))).toEqual({
      code: 0,
      lines: ['RECORDS_GUARD_OK: 4 record files compared, no owner-side change (base base, head head)'],
    });
  });
});

describe('evaluate', () => {
  it('passes unchanged records with one OK line naming both revs', () => {
    expect(evaluate(same(), REVS)).toEqual({
      code: 0,
      lines: ['RECORDS_GUARD_OK: 5 record files compared, no owner-side change (base abc123, head def456)'],
    });
  });

  it('reports invalid JSON at head as a violation, not an abort', () => {
    let result;
    expect(() => { result = evaluate(withHead('package.json', '{ nope'), REVS); }).not.toThrow();
    expect(result.code).toBe(1);
    expect(result.lines).toHaveLength(2);
    expect(result.lines[0]).toMatch(/^RECORDS_GUARD_VIOLATION package\.json: not valid JSON at head \(.+\); its version cannot be verified; see CONTRIBUTING\.md#what-contributors-must-never-do$/);
    expect(result.lines[1]).toBe('RECORDS_GUARD_FAILED: 1 violation(s). Records are written by the owner at release time.');
  });

  it('aborts with one line when a base does not parse, even beside violations', () => {
    const files = withRecord('package-lock.json', '{ nope', lock())
      .map((f) => (f.path === 'VERSION' ? { ...f, head: '1.44.0\n' } : f));
    let result;
    expect(() => { result = evaluate(files, REVS); }).not.toThrow();
    expect(result.code).toBe(1);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].startsWith('RECORDS_GUARD_ABORT: package-lock.json is not valid JSON at base abc123 (')).toBe(true);
  });

  it('counts every violation and puts the FAILED line last', () => {
    const files = withHead('VERSION', '1.44.0\n').map((f) => (f.path === 'AGENT-READABLE BACKLOG.md'
      ? { ...f, head: backlogWith('### [ ] `[FEAT-045]`', '### [X] `[FEAT-045]`') } : f));
    const { code, lines } = evaluate(files, REVS);
    expect(code).toBe(1);
    expect(lines).toHaveLength(3);
    expect(lines.slice(0, 2).every((l) => l.startsWith('RECORDS_GUARD_VIOLATION '))).toBe(true);
    expect(lines[2].startsWith('RECORDS_GUARD_FAILED: 2 violation(s). ')).toBe(true);
  });
});

// The 12 variant-C scenarios from the FEAT-045 POC; each mutates one record of an unchanged set.
const POC_ROWS = [
  ['VERSION bump', 'FAIL', 'VERSION', () => '1.44.0\n'],
  ['package.json version bump', 'FAIL', 'package.json', () => pkg({ version: '1.44.0' })],
  ['package.json script edit only', 'PASS', 'package.json', () => pkg({ scripts: { test: 'vitest run --reporter=dot' } })],
  ['lockfile version bump', 'FAIL', 'package-lock.json', () => lock({ root: '1.44.0', pkgRoot: '1.44.0' })],
  ['lockfile dependency-only change', 'PASS', 'package-lock.json', () => lock({ dep: '3.2.5' })],
  ['CHANGELOG release heading added', 'FAIL', 'CHANGELOG.md', (t) => t.replace('## [1.43.0]', '## [1.44.0] - 2026-11-08\n\n- New.\n\n## [1.43.0]')],
  ['CHANGELOG [Unreleased] entry added', 'PASS', 'CHANGELOG.md', (t) => t.replace('## [Unreleased]\n', '## [Unreleased]\n\n- Pending entry.\n')],
  ['CHANGELOG typo fix in old body', 'PASS', 'CHANGELOG.md', (t) => t.replace('tpyo', 'typo')],
  ['backlog checkbox flip', 'FAIL', 'AGENT-READABLE BACKLOG.md', (t) => t.replace('### [ ] `[FEAT-045]`', '### [X] `[FEAT-045]`')],
  ['backlog [ ] item text edit', 'PASS', 'AGENT-READABLE BACKLOG.md', (t) => t.replace('Open text.', 'Edited open text.')],
  ['backlog DONE line added', 'FAIL', 'AGENT-READABLE BACKLOG.md', (t) => t.replace('Open text.', 'Open text.\n\n* **DONE in 1.44.0.**')],
  ['README edit near Known limits', 'PASS', 'README.md', (t) => `${t}\n## Known limits\n\n- edited\n`],
];

describe('POC variant-C scenarios', () => {
  it('has all 12 rows', () => {
    expect(POC_ROWS).toHaveLength(12);
  });

  it.each(POC_ROWS)('%s -> %s', (_scenario, expected, path, mutate) => {
    // README is not a record file, so its edit never reaches evaluate: the set stays unchanged.
    const isRecord = RECORD_FILES.includes(path);
    if (isRecord) expect(mutate(BASE_TEXT[path])).not.toBe(BASE_TEXT[path]);
    const files = isRecord ? withHead(path, mutate(BASE_TEXT[path])) : same();
    expect(evaluate(files, REVS).code).toBe(expected === 'FAIL' ? 1 : 0);
  });
});

describe('parseArgs', () => {
  it('reads --base and --head', () => {
    expect(parseArgs(['--base', 'a', '--head', 'b'])).toEqual({ base: 'a', head: 'b' });
  });

  it.each([
    ['no arguments', []],
    ['missing --head', ['--base', 'a']],
    ['empty value', ['--base', '', '--head', 'b']],
    ['flag in the value slot', ['--base', '--head', 'b']],
    ['unknown flag', ['--base', 'a', '--head', 'b', '--x', 'y']],
  ])('fails closed on %s', (_label, argv) => {
    const result = parseArgs(argv);
    expect(typeof result.error).toBe('string');
  });
});

describe('imports (AC12)', () => {
  const source = readFileSync(TOOL, 'utf8');

  it('imports only node: builtins, statically', () => {
    const specifiers = [...source.matchAll(/^import\s[^;]*?from\s+'([^']+)'/gm)].map((m) => m[1]);
    expect(specifiers.length).toBeGreaterThan(0);
    for (const specifier of specifiers) expect(specifier.startsWith('node:')).toBe(true);
  });

  it('has no require( or dynamic import(', () => {
    expect(source).not.toMatch(/\brequire\(/);
    expect(source).not.toMatch(/\bimport\(/);
  });
});

describe('the CLI', () => {
  const dirs = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  const README = '# Readme\n\n## Known limits\n\n- none\n';

  function makeRepo() {
    const dir = mkdtempSync(join(tmpdir(), 'cc-records-'));
    dirs.push(dir);
    const g = (args) => execFileSync('git', args, { cwd: dir, env: cleanGitEnv(), stdio: 'pipe' });
    g(['init', '-q']);
    g(['config', 'user.email', 'test@example.com']);
    g(['config', 'user.name', 'Test']);
    g(['config', 'commit.gpgsign', 'false']);
    for (const path of RECORD_FILES) writeFileSync(join(dir, path), BASE_TEXT[path]);
    writeFileSync(join(dir, 'README.md'), README);
    g(['add', '-A']);
    g(['commit', '-q', '-m', 'base']);
    return { dir, g };
  }

  function commitChange({ dir, g }, path, text) {
    writeFileSync(join(dir, path), text);
    g(['add', '-A']);
    g(['commit', '-q', '-m', 'head']);
  }

  const runTool = (dir, args) =>
    spawnSync(process.execPath, [TOOL, ...args], { cwd: dir, env: cleanGitEnv(), encoding: 'utf8' });

  it('(a) fails a VERSION bump', () => {
    const repo = makeRepo();
    commitChange(repo, 'VERSION', '1.44.0\n');
    const r = runTool(repo.dir, ['--base', 'HEAD~1', '--head', 'HEAD']);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain(`RECORDS_GUARD_VIOLATION VERSION: 1.43.0 -> 1.44.0; see ${ANCHOR_NEVER}`);
  });

  it('(b) passes a README edit near Known limits', () => {
    const repo = makeRepo();
    commitChange(repo, 'README.md', README.replace('- none', '- edited'));
    const r = runTool(repo.dir, ['--base', 'HEAD~1', '--head', 'HEAD']);
    expect(r.status).toBe(0);
    expect(r.stdout.startsWith('RECORDS_GUARD_OK: 5 record files compared')).toBe(true);
  });

  it('(c) aborts on a revision missing from the clone', () => {
    const { dir } = makeRepo();
    const r = runTool(dir, ['--base', 'nope-not-a-rev', '--head', 'HEAD']);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('RECORDS_GUARD_ABORT: revision "nope-not-a-rev" is not a commit in this clone');
    expect(r.stdout).toContain('fetch-depth');
  });

  it('(d) aborts with usage when --head is missing', () => {
    const { dir } = makeRepo();
    const r = runTool(dir, ['--base', 'HEAD']);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('RECORDS_GUARD_ABORT:');
    expect(r.stdout).toContain('usage: node tools/records-guard.mjs --base <rev> --head <rev>');
  });

  it('(e) reads the backlog path with a space and fails a checkbox flip', () => {
    const repo = makeRepo();
    const flipped = BACKLOG.replace('### [ ] `[FEAT-045]`', '### [X] `[FEAT-045]`');
    commitChange(repo, 'AGENT-READABLE BACKLOG.md', flipped);
    const r = runTool(repo.dir, ['--base', 'HEAD~1', '--head', 'HEAD']);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain(`RECORDS_GUARD_VIOLATION AGENT-READABLE BACKLOG.md: FEAT-045 heading [ ] -> [X]; see ${ANCHOR_RECORDS}`);
  });

  it('fails a record deleted at head', () => {
    const { dir, g } = makeRepo();
    g(['rm', '-q', 'VERSION']);
    g(['commit', '-q', '-m', 'head']);
    const r = runTool(dir, ['--base', 'HEAD~1', '--head', 'HEAD']);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('VERSION: deleted or renamed at head');
  });
});

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
// Read per case, so a missing workflow fails each case on ENOENT instead of the whole file.
const workflow = (name) =>
  readFileSync(join(REPO_ROOT, '.github', 'workflows', name), 'utf8').replace(/\r\n/g, '\n');
const usesValues = (text) => new Set([...text.matchAll(/^\s*(?:-\s+)?uses:\s*(\S+)\s*$/gm)].map((m) => m[1]));

describe('the workflow', () => {
  it('triggers on pull_request only', () => {
    const text = workflow('records-guard.yml');
    expect(text).toMatch(/^on:\n  pull_request:\n/m);
    expect(text).not.toMatch(/^\s+(push|pull_request_target|workflow_dispatch|schedule|workflow_run):/m);
  });

  it('uses the same action majors as test.yml', () => {
    const uses = usesValues(workflow('records-guard.yml'));
    expect(uses).toEqual(new Set(['actions/checkout@v7', 'actions/setup-node@v7']));
    const testUses = usesValues(workflow('test.yml'));
    for (const value of uses) expect(testUses.has(value)).toBe(true);
  });

  it('fetches depth 2, reads contents only, and exempts the owner', () => {
    const text = workflow('records-guard.yml');
    expect(text).toContain('fetch-depth: 2');
    expect(text).toMatch(/^permissions:\n  contents: read$/m);
    expect(text).toContain('if: github.event.pull_request.user.login != github.repository_owner');
  });

  it('does not key on author_association or head_ref', () => {
    const text = workflow('records-guard.yml');
    expect(text).not.toContain('author_association');
    expect(text).not.toContain('head_ref');
  });

  it('runs the guard against the merge commit first parent', () => {
    expect(workflow('records-guard.yml')).toContain('node tools/records-guard.mjs --base HEAD^1 --head HEAD');
  });
});
