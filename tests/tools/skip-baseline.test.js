import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  BASELINE_FILE, skippedIdentities, parseBaseline, parseArgs, evaluate,
} from '../../tools/skip-baseline.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const TOOL = join(REPO, 'tools', 'skip-baseline.mjs');
const ROOT = '/home/runner/work/code-conductor/code-conductor';

// A synthesized Vitest JSON report: each file maps to [status, fullName] pairs.
function report(files, { root = ROOT, success = true } = {}) {
  return {
    success,
    testResults: Object.entries(files).map(([file, tests]) => ({
      name: `${root}/${file}`,
      assertionResults: tests.map(([status, fullName]) => ({ status, fullName })),
    })),
  };
}
const ids = (rep, root = ROOT) => skippedIdentities(rep, root).identities;
const run = (env, rep, baseline) => evaluate({
  env,
  reportPath: 'vitest-report.json',
  reportText: rep === null ? null : JSON.stringify(rep),
  baselineText: baseline === null ? null : JSON.stringify(baseline),
  root: ROOT,
});

// The FEAT-021 gate shape: the same tests and the same total, with 83 more skipped
// on Node 20 because node:sqlite is absent there.
const PLUGIN = Array.from({ length: 12 }, (_, i) => ['skipped', `personal skills check ${i}`]);
const PIN = [['skipped', 'SHIPPED_GRAPHIFY_HASHES pins each shipped hash to its blob']];
const SQLITE = Array.from({ length: 83 }, (_, i) => `conductor-db case ${i}`);
const legReport = (sqliteStatus) => report({
  'tests/plugin/code-conductor-plugin.test.js': PLUGIN,
  'tests/installer/heal.test.js': [...PIN, ['passed', 'heal removes the entry']],
  'tests/scripts/conductor-db.test.js': SQLITE.map((t) => [sqliteStatus, t]),
});
const count = (rep) => rep.testResults.reduce((n, f) => n + f.assertionResults.length, 0);

describe('skippedIdentities', () => {
  it('collects skipped, pending and todo as repo-relative identities and ignores what ran', () => {
    const rep = report({ 'tests/a.test.js': [
      ['skipped', 'suite one'], ['pending', 'suite two'], ['todo', 'suite three'],
      ['passed', 'suite four'], ['failed', 'suite five'],
    ] });
    expect(ids(rep)).toEqual([
      'tests/a.test.js > suite one', 'tests/a.test.js > suite three', 'tests/a.test.js > suite two',
    ]);
  });

  // Review Focus 3: Vitest writes absolute file names, so without relativizing, a CI
  // runner and any other checkout could never agree on a single identity.
  it('yields the same identity from a CI checkout and a laptop checkout', () => {
    const files = { 'tests/a.test.js': [['skipped', 'x']] };
    const laptop = '/Users/dev/code-conductor';
    expect(ids(report(files, { root: laptop }), laptop)).toEqual(ids(report(files)));
    expect(ids(report(files))).toEqual(['tests/a.test.js > x']);
  });

  it('refuses a report with zero test files rather than reporting an empty set', () => {
    expect(skippedIdentities({ success: true, testResults: [] }, ROOT).error).toMatch(/^unreadable report/);
    expect(skippedIdentities({ success: true }, ROOT).error).toMatch(/^unreadable report/);
  });

  // Review Focus 5.
  it('refuses a report whose run failed, because Vitest red is already the signal', () => {
    const rep = report({ 'tests/a.test.js': [['skipped', 'x']] }, { success: false });
    expect(skippedIdentities(rep, ROOT).error).toMatch(/run did not succeed/);
  });

  // Review Focus 4.
  it('refuses a duplicate identity, which a set would silently collapse', () => {
    const rep = report({ 'tests/a.test.js': [['skipped', 'same'], ['skipped', 'same']] });
    expect(skippedIdentities(rep, ROOT).error).toBe('duplicate identity in report: "tests/a.test.js > same"');
  });

  it('compares whole strings: " > " inside a title and non-ASCII names survive intact', () => {
    const rep = report({ 'tests/a.test.js': [['skipped', 'a > b'], ['skipped', 'reads ñandú — ✓']] });
    expect(ids(rep)).toEqual(['tests/a.test.js > a > b', 'tests/a.test.js > reads ñandú — ✓']);
    const baseline = { 'ci-node20': ['tests/a.test.js > reads ñandú — ✓', 'tests/a.test.js > a > b'] };
    expect(run('ci-node20', rep, baseline).code).toBe(0);
  });
});

describe('parseBaseline', () => {
  it('accepts an empty set as a valid baseline', () => {
    expect(parseBaseline('{"ci-node24": []}')).toEqual({ envs: { 'ci-node24': [] } });
  });

  it('rejects unparseable JSON', () => {
    expect(parseBaseline('{"ci-node20": [').error).toMatch(/^is not valid JSON/);
  });

  it('names the key whose value is not an array of strings', () => {
    expect(parseBaseline('{"ci-node20": "tests/a.test.js > x"}').error).toBe('key "ci-node20" is not an array of strings');
    expect(parseBaseline('{"ci-node24": [1]}').error).toBe('key "ci-node24" is not an array of strings');
  });

  // Review Focus 4, baseline side.
  it('names a duplicate identity', () => {
    expect(parseBaseline('{"ci-node20": ["t > x", "t > x"]}').error).toBe('key "ci-node20" lists "t > x" more than once');
  });
});

describe('parseArgs', () => {
  it('requires --report', () => {
    expect(parseArgs(['--env', 'ci-node20']).error).toBe('--report <path> is required');
  });

  it('rejects an unknown argument and a flag with no value', () => {
    expect(parseArgs(['--report', 'r.json', '--baseline', 'b.json']).error).toBe('unknown argument "--baseline"');
    expect(parseArgs(['--report', 'r.json', '--env']).error).toBe('--env needs a value');
    expect(parseArgs(['--env', 'ci-node20', '--report', 'r.json'])).toEqual({ env: 'ci-node20', report: 'r.json' });
  });
});

describe('evaluate, assert mode', () => {
  it('reports a matching set as SKIP_BASELINE_OK naming env, count, baseline and report', () => {
    const rep = legReport('skipped');
    const r = run('ci-node20', rep, { 'ci-node20': ids(rep), 'ci-node24': [] });
    expect(r.code).toBe(0);
    expect(r.lines).toEqual([`SKIP_BASELINE_OK ci-node20: 96 skipped identities match ${BASELINE_FILE} (report: vitest-report.json)`]);
  });

  // The FEAT-021 merge gate, frozen: its CI prediction was derived from a Node 24
  // baseline and missed by exactly this, with the totals matching.
  it('FEAT-021 red case: 83 more skips at unchanged totals fails and names every identity', () => {
    const node24 = legReport('passed');
    const node20 = legReport('skipped');
    expect(count(node20)).toBe(count(node24));
    const r = run('ci-node20', node20, { 'ci-node20': ids(node24) });
    expect(r.code).toBe(1);
    expect(r.lines[0]).toBe(`SKIP_BASELINE_DRIFT ci-node20: +83 −0 (report: vitest-report.json, baseline: ${BASELINE_FILE})`);
    const added = r.lines.filter((l) => l.startsWith('  + '));
    expect(added).toHaveLength(83);
    expect(added).toContain('  + "tests/scripts/conductor-db.test.js > conductor-db case 0"');
  });

  it('fails a same-count swap, naming the removal and the addition', () => {
    const rep = report({ 'tests/a.test.js': [['skipped', 'new'], ['passed', 'old']] });
    const r = run('ci-node24', rep, { 'ci-node24': ['tests/a.test.js > old'] });
    expect(r.code).toBe(1);
    expect(r.lines.slice(0, 3)).toEqual([
      `SKIP_BASELINE_DRIFT ci-node24: +1 −1 (report: vitest-report.json, baseline: ${BASELINE_FILE})`,
      '  + "tests/a.test.js > new"',
      '  − "tests/a.test.js > old"',
    ]);
  });

  it('fails on coverage gained: a baseline skip that now runs is a removal', () => {
    const rep = report({ 'tests/a.test.js': [['passed', 'x']] });
    const r = run('ci-node24', rep, { 'ci-node24': ['tests/a.test.js > x'] });
    expect(r.code).toBe(1);
    expect(r.lines[0]).toMatch(/^SKIP_BASELINE_DRIFT ci-node24: \+0 −1 /);
  });

  it('aborts on an environment with no key, naming the keys that exist', () => {
    const r = run('ci-node26', legReport('passed'), { 'ci-node20': [], 'ci-node24': [] });
    expect(r).toEqual({ code: 1, lines: [
      `SKIP_BASELINE_ABORT: environment "ci-node26" has no key in ${BASELINE_FILE} (keys: ci-node20, ci-node24); commit its measured set in this PR`,
    ] });
  });

  // Review Focus 1: assert mode cannot pass on a baseline that was never committed.
  it('aborts when the baseline file is missing', () => {
    expect(run('ci-node20', legReport('passed'), null))
      .toEqual({ code: 1, lines: [`SKIP_BASELINE_ABORT: baseline not found at ${BASELINE_FILE}`] });
  });

  it('aborts when the report is missing', () => {
    expect(run('ci-node20', null, { 'ci-node20': [] }))
      .toEqual({ code: 1, lines: ['SKIP_BASELINE_ABORT: report not found at vitest-report.json'] });
  });
});

describe('evaluate, report-only mode', () => {
  it('prints every identity and the REPORT_ONLY line, exits 0, never reads the baseline', () => {
    const r = run(null, legReport('passed'), null);
    expect(r.code).toBe(0);
    expect(r.lines[0]).toBe(`SKIP_BASELINE_OBSERVED node ${process.version}: 13 skipped identities (report: vitest-report.json)`);
    expect(r.lines.filter((l) => l.startsWith('SKIPPED "'))).toHaveLength(13);
    expect(r.lines.at(-1)).toBe('SKIP_BASELINE_REPORT_ONLY: no --env given, nothing asserted');
  });

  it('still fails closed on an unreadable report', () => {
    const r = evaluate({ env: null, reportPath: 'r.json', reportText: '{not json', baselineText: null, root: ROOT });
    expect(r.code).toBe(1);
    expect(r.lines[0]).toMatch(/^SKIP_BASELINE_ABORT: unreadable report \(/);
  });
});

describe('the CLI', () => {
  let dir;
  beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'cc-skip-')); });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('report-only run exits 0 and ends with the REPORT_ONLY line', () => {
    const path = join(dir, 'report.json');
    writeFileSync(path, JSON.stringify(report({ 'tests/a.test.js': [['skipped', 'x']] }, { root: REPO })));
    const r = spawnSync(process.execPath, [TOOL, '--report', path], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('SKIPPED "tests/a.test.js > x"\n');
    expect(r.stdout.trimEnd().split('\n').at(-1)).toBe('SKIP_BASELINE_REPORT_ONLY: no --env given, nothing asserted');
  });

  it('a missing --report exits 1 with a usage abort', () => {
    const r = spawnSync(process.execPath, [TOOL, '--env', 'ci-node20'], { encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/^SKIP_BASELINE_ABORT: --report <path> is required; usage: /);
  });
});
