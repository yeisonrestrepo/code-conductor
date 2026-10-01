import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergeFileInto } from '../../lib/installer/file-merge.mjs';
import { mergeClaudeMdText, SENTINEL_START, SENTINEL_END } from '../../lib/installer/merge-md.mjs';

// AC7's fault injector, and the only one. It lives here, as a vitest module mock: no
// production module carries a seam, flag or environment variable for it. vi.mock
// exists only inside vitest's module graph, tests/ is outside package.json `files`,
// and smoke.test.js requires that no packed file names vitest. Each switch is off by
// default, and every call it does not fail goes to the real function.
const faults = vi.hoisted(() => ({ copyFileSync: false, renameSync: false }));
vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal();
  const injectable = (name) => (...args) => {
    if (faults[name]) throw Object.assign(new Error(`injected ${name} fault`), { code: 'EIO' });
    return fs[name](...args);
  };
  const mocked = { ...fs, copyFileSync: injectable('copyFileSync'), renameSync: injectable('renameSync') };
  return { ...mocked, default: mocked };
});

const TPL = ['# T', '', SENTINEL_START, '## Hard Constraints', '', '- No secrets.', SENTINEL_END, ''].join('\n');
const HOST = '# Mine\n\n## Deployment\n\nkubectl\n';
let dir, tplPath, target, warnings, reported;
const opts = () => ({ warn: (m) => warnings.push(m), onBackup: (p) => reported.push(p) });
const named = (part) => readdirSync(dir).filter((n) => n.includes(part));
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cc-order-'));
  tplPath = join(dir, 'template.md');
  target = join(dir, 'CLAUDE.md');
  writeFileSync(tplPath, TPL);
  writeFileSync(target, HOST);
  warnings = [];
  reported = [];
  faults.copyFileSync = false;
  faults.renameSync = false;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('mergeFileInto — backup ordering under injected faults (AC7)', () => {
  it('[AC7] keeps the backup and leaves the target byte-unchanged when the write throws', () => {
    faults.renameSync = true;
    expect(mergeFileInto(tplPath, target, mergeClaudeMdText, opts())).toBe('write-failed');
    expect(readFileSync(target, 'utf8')).toBe(HOST);
    const [backup] = named('.installer-backup.');
    expect(readFileSync(join(dir, backup), 'utf8')).toBe(HOST);
    expect(reported).toEqual([join(dir, backup)]);
    expect(named('.installer-tmp.')).toEqual([]);
    expect(warnings.join('\n')).toContain(target);
    expect(warnings.join('\n')).toContain(join(dir, backup));
  });
  it('[AC7] writes nothing when the backup throws', () => {
    faults.copyFileSync = true;
    expect(mergeFileInto(tplPath, target, mergeClaudeMdText, opts())).toBe('skipped-backup-failed');
    expect(readFileSync(target, 'utf8')).toBe(HOST);
    expect(named('.installer-backup.')).toEqual([]);
    expect(named('.installer-tmp.')).toEqual([]);
    expect(reported).toEqual([]);
    expect(warnings.join('\n')).toMatch(/could not back it up/);
  });
});
