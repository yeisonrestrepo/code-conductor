import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { resolveAssetRoot, resolveHome, nodeMajorAtLeast, isAbsolutePath } from '../../lib/installer/env.mjs';

describe('nodeMajorAtLeast', () => {
  it('accepts >= floor and rejects below', () => {
    expect(nodeMajorAtLeast(20, '20.11.1')).toBe(true);
    expect(nodeMajorAtLeast(20, '22.0.0')).toBe(true);
    expect(nodeMajorAtLeast(20, '18.19.1')).toBe(false);
    expect(nodeMajorAtLeast(20, 'garbage')).toBe(false);
  });
});

describe('resolveAssetRoot', () => {
  it('returns a dir that holds the bundled asset folders', () => {
    const root = resolveAssetRoot();
    expect(existsSync(join(root, 'global'))).toBe(true);
    expect(existsSync(join(root, 'skills'))).toBe(true);
    expect(existsSync(join(root, 'project-template'))).toBe(true);
  });
});

describe('resolveHome', () => {
  it('prefers HOME', () => {
    expect(resolveHome({ HOME: '/h', USERPROFILE: '/u' })).toBe('/h');
  });
  it('falls back to USERPROFILE', () => {
    expect(resolveHome({ USERPROFILE: 'C:\\Users\\a' })).toBe('C:\\Users\\a');
  });
  it('returns null when neither is set or blank', () => {
    expect(resolveHome({})).toBeNull();
    expect(resolveHome({ HOME: '   ' })).toBeNull();
  });
  it('rejects a relative HOME as unresolvable', () => {
    expect(resolveHome({ HOME: 'relative/dir' })).toBeNull();
    expect(resolveHome({ HOME: './x' })).toBeNull();
  });
});

describe('isAbsolutePath', () => {
  it('accepts POSIX, Windows-drive, and UNC paths; rejects relative', () => {
    expect(isAbsolutePath('/h')).toBe(true);
    expect(isAbsolutePath('C:\\Users\\a')).toBe(true);
    expect(isAbsolutePath('C:/Users/a')).toBe(true);
    expect(isAbsolutePath('\\\\server\\share')).toBe(true);
    expect(isAbsolutePath('relative/dir')).toBe(false);
    expect(isAbsolutePath('./x')).toBe(false);
  });
});
