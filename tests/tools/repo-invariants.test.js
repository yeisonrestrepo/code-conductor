import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { scanHeadings } from '../../tools/id-ceiling.mjs';
import { readLocations, compare } from '../../tools/version-gate.mjs';
import { checkParity } from '../../tools/record-parity.mjs';

// These assert about THIS repository, not about the instruments. They live in their
// own file for that reason, following tests/unit/gitignore-block-parity.test.js and
// tests/unit/host-owned-ignore-xor.test.js. CONTRIBUTING.md states the CI gate is
// unconditional, so a red here blocks the merge. That is where halt semantics come
// from; no checklist line enforces anything.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

describe('this repository, at every commit', () => {
  it('agrees with VERSION at all five version locations', () => {
    const r = compare(readLocations(ROOT));
    expect(r.disagreements).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('keeps its CHANGELOG, backlog and VERSION in record parity', () => {
    const r = checkParity({
      backlogText: read('AGENT-READABLE BACKLOG.md'),
      changelogText: read('CHANGELOG.md'),
      versionFile: read('VERSION').trim(),
    });
    expect(r.violations.map((v) => v.detail)).toEqual([]);
    expect(r.ok).toBe(true);
  });

  // The ceiling itself is a query and is not asserted here: its remote leg needs a ref
  // actions/checkout@v7 does not fetch at its default depth, and fetch-depth: 0 was
  // declined because the both-legs filing rule already protects it. Duplicate-id
  // freedom is the assertable half, single leg, and it is the harm the ceiling exists
  // to prevent.
  it('files no id twice', () => {
    expect(scanHeadings(read('AGENT-READABLE BACKLOG.md')).duplicates).toEqual([]);
  });

  // FEAT-021: the package's defining constraints are zero dependencies and npm-native
  // distribution, and the graph hook was the only Python in it.
  it('tracks no Python file', () => {
    expect(execFileSync('git', ['ls-files', '*.py'], { cwd: ROOT, encoding: 'utf8' }).trim()).toBe('');
  });

  // FEAT-021: the graph rung is gone from every surface an agent reads or an install
  // ships. The heal must still name the hook to remove it, and its call site names the
  // heal and prints the upgrade notice; those two files are the whole allowed set.
  it('ships no graph-rung surface: only the heal and its call site name graphify', () => {
    const surfaces = ['global', 'skills', 'project-template', 'bin', 'lib', 'scripts', '.claude/commands', '.claude/hooks', '.claude/settings.json', 'README.md', 'CLAUDE.md'];
    const allowed = ['lib/installer/heal.mjs', 'bin/code-conductor.mjs'];
    const files = execFileSync('git', ['ls-files', ...surfaces], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
    expect(files.filter((f) => !allowed.includes(f) && /graphify/i.test(read(f)))).toEqual([]);
  });

  // FEAT-021, owner ruling 2: an exact set, so a new mention anywhere else fails rather
  // than growing an allowlist silently. Records are excluded; they describe history.
  // The needle is assembled, and named nowhere literally, so this file cannot match itself.
  it('names the Python interpreter command only in the two files whose subject it is', () => {
    const needle = ['python', '3'].join('');
    const records = [':!docs/superpowers', ':!CHANGELOG.md', ':!AGENT-READABLE BACKLOG.md', ':!.claude/memory'];
    const r = spawnSync('git', ['grep', '-l', needle, '--', '.', ...records], { cwd: ROOT, encoding: 'utf8' });
    const hits = r.stdout.split('\n').filter(Boolean).sort();
    expect(hits).toEqual(['tests/fixtures/guard3-corpus.js', 'tests/installer/heal.test.js']);
  });
});
