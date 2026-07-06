import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertAssets, deployGlobal, deployProject, chmodHooks } from '../../lib/installer/deploy.mjs';

let asset, home;
beforeEach(() => {
  asset = mkdtempSync(join(tmpdir(), 'cc-asset-'));
  home = mkdtempSync(join(tmpdir(), 'cc-home-'));
  mkdirSync(join(asset, 'global', 'hooks'), { recursive: true });
  mkdirSync(join(asset, 'global', 'memory'), { recursive: true });
  mkdirSync(join(asset, 'skills'), { recursive: true });
  mkdirSync(join(asset, 'project-template'), { recursive: true });
  writeFileSync(join(asset, 'global', 'CLAUDE.md'), 'managed-v2');
  writeFileSync(join(asset, 'global', 'hooks', 'h.sh'), '#!/bin/sh\n');
  writeFileSync(join(asset, 'global', 'memory', 'personal.md'), 'BUNDLED');
  writeFileSync(join(asset, 'skills', 's.md'), 'skill');
  writeFileSync(join(asset, 'project-template', 'CLAUDE.md'), 'proj');
});
afterEach(() => {
  rmSync(asset, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

describe('assertAssets', () => {
  it('throws MISSING_ASSET for an absent dir', () => {
    expect(() => assertAssets(asset, ['nope'])).toThrowError(/MISSING_ASSET|missing bundled/);
    try { assertAssets(asset, ['nope']); } catch (e) { expect(e.code).toBe('MISSING_ASSET'); }
  });
  it('passes when all dirs exist', () => {
    expect(() => assertAssets(asset, ['global', 'skills'])).not.toThrow();
  });
});

describe('deployGlobal', () => {
  it('copies managed assets and skills but not global/memory', () => {
    const dir = deployGlobal(asset, home);
    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8')).toBe('managed-v2');
    expect(existsSync(join(dir, 'skills', 's.md'))).toBe(true);
    expect(existsSync(join(dir, 'hooks', 'h.sh'))).toBe(true);
    expect(existsSync(join(dir, 'memory', 'personal.md'))).toBe(false);
    expect(existsSync(join(dir, 'memory'))).toBe(true); // dir created despite the filter
  });
  it('overwrites an existing managed file on re-run', () => {
    const dir = join(home, '.claude');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'CLAUDE.md'), 'stale');
    deployGlobal(asset, home);
    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8')).toBe('managed-v2');
  });
});

describe('deployProject', () => {
  it('copies the template into cwd/.claude', () => {
    const dir = deployProject(asset, home);
    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8')).toBe('proj');
  });
});

describe('chmodHooks', () => {
  it('marks *.sh executable without throwing', () => {
    const dir = deployGlobal(asset, home);
    expect(() => chmodHooks(dir)).not.toThrow();
    if (process.platform !== 'win32') {
      const { statSync } = require('node:fs');
      expect(statSync(join(dir, 'hooks', 'h.sh')).mode & 0o111).toBeGreaterThan(0);
    }
  });
});
