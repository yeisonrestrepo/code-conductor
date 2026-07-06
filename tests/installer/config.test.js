import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeVerbosity, writeVerbosity, seedMemoryFile, writeVersionFile } from '../../lib/installer/config.mjs';

let home, asset;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'cc-h-'));
  asset = mkdtempSync(join(tmpdir(), 'cc-a-'));
  mkdirSync(join(asset, 'global', 'memory'), { recursive: true });
  writeFileSync(join(asset, 'global', 'memory', 'verbosity.md'), '---\nname: v\n---\n\nVERBOSITY: MIN\n');
  writeFileSync(join(asset, 'global', 'memory', 'personal.md'), 'BUNDLED-PERSONAL');
});
afterEach(() => { rmSync(home, { recursive: true, force: true }); rmSync(asset, { recursive: true, force: true }); });

const vpath = () => join(home, '.claude', 'memory', 'verbosity.md');

describe('normalizeVerbosity', () => {
  it('accepts bare and prefixed levels case-insensitively', () => {
    expect(normalizeVerbosity('min')).toBe('MIN');
    expect(normalizeVerbosity('VERBOSITY: verbose')).toBe('VERBOSE');
    expect(normalizeVerbosity('garbage')).toBeNull();
    expect(normalizeVerbosity(42)).toBeNull();
  });
});

describe('writeVerbosity', () => {
  it('seeds MIN from the bundled file on a fresh machine', () => {
    const r = writeVerbosity(home, asset, undefined, false);
    expect(r.level).toBe('MIN');
    expect(existsSync(vpath())).toBe(true);
  });
  it('overwrites the level when a valid flag is given', () => {
    const r = writeVerbosity(home, asset, 'verbose', true);
    expect(r.level).toBe('VERBOSE');
    expect(readFileSync(vpath(), 'utf8')).toMatch(/VERBOSITY: VERBOSE/);
    expect(r.warn).toBeNull();
  });
  it('warns and falls back to MIN on an invalid flag', () => {
    const r = writeVerbosity(home, asset, 'loud', true);
    expect(r.level).toBe('MIN');
    expect(r.warn).toMatch(/invalid/i);
  });
  it('preserves an existing valid level when no flag is given', () => {
    mkdirSync(join(home, '.claude', 'memory'), { recursive: true });
    writeFileSync(vpath(), 'VERBOSITY: INFO\n');
    const r = writeVerbosity(home, asset, undefined, false);
    expect(r.level).toBe('INFO');
  });
  it('resets a corrupt existing file to MIN with a warning', () => {
    mkdirSync(join(home, '.claude', 'memory'), { recursive: true });
    writeFileSync(vpath(), 'totally broken');
    const r = writeVerbosity(home, asset, undefined, false);
    expect(r.level).toBe('MIN');
    expect(r.warn).toMatch(/reset/i);
    expect(readFileSync(vpath(), 'utf8')).toMatch(/VERBOSITY: MIN/);
  });
});

describe('seedMemoryFile', () => {
  it('writes when absent and skips when present', () => {
    expect(seedMemoryFile(home, 'personal.md', asset)).toBe(true);
    expect(readFileSync(join(home, '.claude', 'memory', 'personal.md'), 'utf8')).toBe('BUNDLED-PERSONAL');
    writeFileSync(join(home, '.claude', 'memory', 'personal.md'), 'USER-EDIT');
    expect(seedMemoryFile(home, 'personal.md', asset)).toBe(false);
    expect(readFileSync(join(home, '.claude', 'memory', 'personal.md'), 'utf8')).toBe('USER-EDIT');
  });
});

describe('writeVersionFile', () => {
  it('recursively creates .claude/memory on a fresh home, then writes the bare version', () => {
    // `home` is a fresh mkdtemp with no .claude/ yet — proves recursive parent creation.
    expect(existsSync(join(home, '.claude', 'memory'))).toBe(false);
    writeVersionFile(home, '1.22.0');
    expect(readFileSync(join(home, '.claude', 'memory', 'conductor-version.md'), 'utf8')).toBe('1.22.0\n');
  });
});
