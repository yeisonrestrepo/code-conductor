import { describe, it, expect } from 'vitest';
import { compare, LOCATIONS, firstChangelogVersion } from '../../tools/version-gate.mjs';

const agreeing = (v) => Object.fromEntries(LOCATIONS.map((n) => [n, v]));

describe('compare', () => {
  // The forbidden outcome, stated as the test's own subject. Failure on agreement is
  // the defect this gate replaced, and a gate that only ever says FAIL is
  // indistinguishable from a gate that works.
  it('reports five-way agreement as agreement, never as failure', () => {
    const r = compare(agreeing('1.32.2'));
    expect(r.ok).toBe(true);
    expect(r.want).toBe('1.32.2');
    expect(r.rows).toHaveLength(5);
    expect(r.rows.every((row) => row.ok)).toBe(true);
    expect(r.disagreements).toEqual([]);
  });

  // One case per checked location, so a gate that reads only the first two cannot pass.
  for (const name of LOCATIONS.filter((n) => n !== 'VERSION')) {
    it(`fails and names the location when ${name} disagrees`, () => {
      const found = agreeing('1.32.2');
      found[name] = '1.32.1';
      const r = compare(found);
      expect(r.ok).toBe(false);
      expect(r.disagreements).toEqual([name]);
    });
  }

  it('fails against the authority itself, not the four, when VERSION is malformed', () => {
    const found = agreeing('1.32.2');
    found['VERSION'] = 'v1.32.2-rc1';
    const r = compare(found);
    expect(r.ok).toBe(false);
    expect(r.authorityFailed).toBe(true);
    expect(r.reason).toMatch(/VERSION/);
    expect(r.disagreements).toEqual([]);
  });

  // Review Focus 2: lockfileVersion 1 has no `packages` object, so the reader hands
  // compare a null rather than throwing, and the gate names the location it could
  // not read instead of crashing.
  it('fails naming an unreadable location rather than throwing', () => {
    const found = agreeing('1.32.2');
    found['package-lock.json packages[""].version'] = null;
    const r = compare(found);
    expect(r.ok).toBe(false);
    expect(r.disagreements).toEqual(['package-lock.json packages[""].version']);
  });
});

describe('firstChangelogVersion', () => {
  // Review Focus 3: an `## [Unreleased]` heading must not fall through to the next
  // heading, which would compare VERSION against the PREVIOUS release and report an
  // agreement that does not exist.
  it('returns null for an Unreleased heading rather than the release below it', () => {
    const text = ['# Changelog', '', '## [Unreleased]', '', '## [1.32.1] - 2026-09-28', ''].join('\n');
    expect(firstChangelogVersion(text)).toBeNull();
  });

  it('reads the first released version heading', () => {
    expect(firstChangelogVersion('# Changelog\n\n## [1.32.2] - 2026-09-29\n')).toBe('1.32.2');
  });
});
