import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const BEGIN = '# --- BEGIN tracked-surface block (BUG-042) ---';
const END = '# --- END tracked-surface block (BUG-042) ---';
const SITES = ['.claude', 'docs'];

const lsFiles = (site) =>
  execFileSync('git', ['ls-files', site], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);

// Order IS the contract. Git applies last-match-wins, so a directory's re-include has
// to precede the `/*` line that re-excludes its contents, and every leaf has to follow
// that line. Sorting the comparison would make a dead leaf pass, so nothing here
// normalizes order. [BUG-042]
export function expectedBlock(sites) {
  const out = [];
  for (const [root, files] of sites) {
    out.push(`/${root}/*`);
    const dirs = new Set();
    for (const f of files) {
      let d = dirname(f);
      while (d !== '.' && d !== '' && d !== root) {
        dirs.add(d);
        d = dirname(d);
      }
    }
    for (const d of [...dirs].sort()) out.push(`!/${d}/`, `/${d}/*`);
    for (const f of [...files].sort()) out.push(`!/${f}`);
  }
  return out;
}

// Only the rules are compared. Comments and blank lines inside the markers are free,
// so the block can carry its own explanation, and everything OUTSIDE the markers is
// free too. That scope is what lets this test and the installer's
// mergeGitignoreText merge share one file forever: this file's ! lines trip its
// negation guard, so its block is appended below the END marker and nothing moves.
export function readBlock() {
  const raw = readFileSync(`${ROOT}/.gitignore`, 'utf8').split('\n').map((l) => l.trimEnd());
  const b = raw.indexOf(BEGIN);
  const e = raw.indexOf(END);
  if (b < 0 || e <= b) throw new Error(`block markers missing or inverted: begin=${b} end=${e}`);
  return raw.slice(b + 1, e).map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('#'));
}

describe('.gitignore tracked-surface block', () => {
  const sites = SITES.map((s) => [s, lsFiles(s)]);

  it('equals the block computed from git ls-files, in order', () => {
    expect(readBlock()).toEqual(expectedBlock(sites));
  });

  it('names every tracked file at both sites and nothing else', () => {
    const named = readBlock()
      .filter((l) => l.startsWith('!') && !l.endsWith('/'))
      .map((l) => l.slice(2));
    expect(named.sort()).toEqual(sites.flatMap(([, f]) => f).sort());
  });

  it('keeps every directory re-include above the exclusion it reopens', () => {
    const block = readBlock();
    for (const line of block.filter((l) => l.startsWith('!/') && l.endsWith('/'))) {
      const reExclude = `${line.slice(1)}*`;
      expect(block.indexOf(line)).toBeLessThan(block.indexOf(reExclude));
    }
  });

  // The discriminator. Without it, the equality assertion could be satisfied by a
  // comparison that never distinguishes anything, and no test would notice.
  it('fails when a single leaf is removed', () => {
    const full = expectedBlock(sites);
    const short = full.filter((l) => l !== '!/.claude/settings.json');
    expect(short.length).toBe(full.length - 1);
    expect(readBlock()).not.toEqual(short);
  });
});
