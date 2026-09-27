import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  GLOBAL_HOST_OWNED, PROJECT_HOST_OWNED, MERGE_OWNED_KEYS,
  GLOBAL_SETTINGS_FINGERPRINTS, PROJECT_SETTINGS_FINGERPRINTS,
  hostOwnedFilter, seedHostOwned,
} from '../../lib/installer/host-owned.mjs';

let src, dst;
beforeEach(() => {
  src = mkdtempSync(join(tmpdir(), 'cc-ho-src-'));
  dst = mkdtempSync(join(tmpdir(), 'cc-ho-dst-'));
});
afterEach(() => {
  rmSync(src, { recursive: true, force: true });
  rmSync(dst, { recursive: true, force: true });
});

describe('policy tables', () => {
  it('use only the three defined policies', () => {
    const seen = new Set([...GLOBAL_HOST_OWNED.values(), ...PROJECT_HOST_OWNED.values()]);
    expect([...seen].sort()).toEqual(['merge', 'seed', 'skip']);
  });
  it('spell every key with forward slashes and no leading slash', () => {
    for (const k of [...GLOBAL_HOST_OWNED.keys(), ...PROJECT_HOST_OWNED.keys()]) {
      expect(k).not.toContain('\\');
      expect(k.startsWith('/')).toBe(false);
    }
  });
  it('declare hooks as the only merge-owned settings key', () => {
    expect(MERGE_OWNED_KEYS).toEqual(['hooks']);
  });
  it('ship no global fingerprints and three project fingerprints', () => {
    expect(GLOBAL_SETTINGS_FINGERPRINTS).toEqual([]);
    expect(PROJECT_SETTINGS_FINGERPRINTS).toEqual(['pre-tool-use.mjs', 'post-compact.sh', 'verbosity-remind.sh']);
  });
});

describe('hostOwnedFilter', () => {
  it('excludes exactly the table paths and keeps their parent directory', () => {
    const f = hostOwnedFilter(src, PROJECT_HOST_OWNED);
    expect(f(src)).toBe(true);
    expect(f(join(src, 'memory'))).toBe(true);
    expect(f(join(src, 'memory', 'project.md'))).toBe(false);
    expect(f(join(src, 'settings.json'))).toBe(false);
    expect(f(join(src, 'commands', 'cc-spec.md'))).toBe(true);
    expect(f(join(src, 'hooks', 'pre-tool-use.mjs'))).toBe(true);
  });
  it('does not exclude a same-named file at a different depth', () => {
    const f = hostOwnedFilter(src, PROJECT_HOST_OWNED);
    expect(f(join(src, 'commands', 'memory', 'project.md'))).toBe(true);
  });
});

describe('seedHostOwned', () => {
  it('writes a seed entry only when the target is absent', () => {
    mkdirSync(join(src, 'memory'), { recursive: true });
    writeFileSync(join(src, 'memory', 'project.md'), 'STUB');
    writeFileSync(join(src, 'memory', 'context-threshold.txt'), '75');
    expect(seedHostOwned(src, dst, PROJECT_HOST_OWNED).sort())
      .toEqual(['memory/context-threshold.txt', 'memory/project.md']);
    expect(readFileSync(join(dst, 'memory', 'project.md'), 'utf8')).toBe('STUB');

    writeFileSync(join(dst, 'memory', 'project.md'), 'HOST PROSE');
    expect(seedHostOwned(src, dst, PROJECT_HOST_OWNED)).toEqual([]);
    expect(readFileSync(join(dst, 'memory', 'project.md'), 'utf8')).toBe('HOST PROSE');
  });
  it('never writes a skip or merge entry', () => {
    writeFileSync(join(src, 'settings.json'), '{}');
    writeFileSync(join(src, 'settings.local.json'), '{}');
    seedHostOwned(src, dst, PROJECT_HOST_OWNED);
    expect(existsSync(join(dst, 'settings.json'))).toBe(false);
    expect(existsSync(join(dst, 'settings.local.json'))).toBe(false);
  });
  it('skips a seed entry whose template source is missing, without throwing', () => {
    expect(() => seedHostOwned(src, dst, GLOBAL_HOST_OWNED)).not.toThrow();
    expect(existsSync(join(dst, 'memory', 'personal.md'))).toBe(false);
  });
});
