import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROJECT_HOST_OWNED } from '../../lib/installer/host-owned.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const rc = (args) => {
  try {
    execFileSync('git', args, { cwd: ROOT, stdio: 'ignore' });
    return 0;
  } catch (e) {
    return e.status ?? -1;
  }
};

// A host-owned row must be exactly one of ignored or tracked, never both and never
// neither. Neither means the index can swallow a host file on the next bulk add. Both
// means git is tracking a file it has been told to hide, which is the state that makes
// a later ignore-rule edit silently stop mattering.
//
// BUG-042's audit expected to find PROJECT_HOST_OWNED duplicated in .gitignore syntax
// and had to correct that premise: the deny-by-default block names zero host-owned
// paths and leaks zero. This invariant is what the relationship actually is. [BUG-042]
export function xorViolations(rows, { isIgnored, isTracked }) {
  return rows
    .filter(([rel]) => isIgnored(rel) === isTracked(rel))
    .map(([rel]) => rel);
}

const live = {
  isIgnored: (rel) => rc(['check-ignore', '-q', `.claude/${rel}`]) === 0,
  isTracked: (rel) => rc(['ls-files', '--error-unmatch', `.claude/${rel}`]) === 0,
};

describe('PROJECT_HOST_OWNED rows are ignored XOR tracked', () => {
  const rows = [...PROJECT_HOST_OWNED];

  it('holds for every row', () => {
    expect(xorViolations(rows, live)).toEqual([]);
  });

  it('tracks exactly project.md and settings.json', () => {
    const tracked = rows.filter(([rel]) => live.isTracked(rel)).map(([rel]) => rel);
    expect(tracked.sort()).toEqual(['memory/project.md', 'settings.json']);
  });

  // The two discriminators. They are cases, not comments: without them the checker
  // could return an empty array unconditionally and the first case would still pass.
  it('reports a row that is both tracked and ignored', () => {
    const probes = { isIgnored: () => true, isTracked: (rel) => rel === 'settings.local.json' };
    expect(xorViolations(rows, probes)).toContain('settings.local.json');
  });

  it('reports a row that is neither tracked nor ignored', () => {
    const probes = { isIgnored: () => false, isTracked: () => false };
    expect(xorViolations(rows, probes)).toEqual(rows.map(([rel]) => rel));
  });
});
