import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, lstatSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveRealTarget, backupFile, writeAtomic, mergeFileInto } from '../../lib/installer/file-merge.mjs';
import { mergeClaudeMdText, SENTINEL_START, SENTINEL_END } from '../../lib/installer/merge-md.mjs';

const TPL = ['# T', '', '## Project Identity', '', '- Name: TBD', '', SENTINEL_START, '## Hard Constraints', '', '- No secrets.', SENTINEL_END, ''].join('\n');

let dir, tplPath, target, warnings;
const warn = (m) => warnings.push(m);
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cc-fm-'));
  tplPath = join(dir, 'template.md');
  target = join(dir, 'CLAUDE.md');
  writeFileSync(tplPath, TPL);
  warnings = [];
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('writeAtomic', () => {
  it('writes through and leaves no temp file behind', () => {
    writeAtomic(target, 'hello\n');
    expect(readFileSync(target, 'utf8')).toBe('hello\n');
    expect(readdirSync(dir).filter(n => n.includes('.installer-tmp.'))).toEqual([]);
  });
});

describe('backupFile', () => {
  it('names the backup with utcStamp and keeps at most 5', () => {
    writeFileSync(target, 'v1');
    for (let i = 1; i <= 7; i++) backupFile(target, new Date(Date.UTC(2026, 0, i)));
    const backups = readdirSync(dir).filter(n => n.includes('.installer-backup.')).sort();
    expect(backups).toHaveLength(5);
    expect(backups[0]).toBe('CLAUDE.md.installer-backup.20260103T000000Z');
  });
  it('keeps both backups written in the same UTC second via a -1 suffix', () => {
    writeFileSync(target, 'v1');
    const now = new Date('2026-01-01T00:00:00.000Z');
    const a = backupFile(target, now);
    writeFileSync(target, 'v2');
    const b = backupFile(target, now);
    expect(a).not.toBe(b);
    expect(b.endsWith('-1')).toBe(true);
    expect(readFileSync(a, 'utf8')).toBe('v1');
    expect(readFileSync(b, 'utf8')).toBe('v2');
  });
});

describe('mergeFileInto', () => {
  it('writes the whole template when the target is absent, with no backup', () => {
    expect(mergeFileInto(tplPath, target, mergeClaudeMdText, { warn })).toBe('created');
    expect(readFileSync(target, 'utf8')).toBe(TPL);
    expect(readdirSync(dir).filter(n => n.includes('.installer-backup.'))).toEqual([]);
  });
  it('treats a zero-byte and a whitespace-only target as a whole copy with no backup', () => {
    for (const seed of ['', '  \n\n']) {
      writeFileSync(target, seed);
      expect(mergeFileInto(tplPath, target, mergeClaudeMdText, { warn })).toBe('merged');
      expect(readFileSync(target, 'utf8')).toBe(TPL);
      expect(readdirSync(dir).filter(n => n.includes('.installer-backup.'))).toEqual([]);
    }
  });
  it('backs up exactly when the file changes, and not when it does not', () => {
    writeFileSync(target, '# Mine\n\n## Deployment\n\nkubectl\n');
    expect(mergeFileInto(tplPath, target, mergeClaudeMdText, { warn })).toBe('merged');
    expect(readdirSync(dir).filter(n => n.includes('.installer-backup.'))).toHaveLength(1);
    expect(mergeFileInto(tplPath, target, mergeClaudeMdText, { warn })).toBe('unchanged');
    expect(readdirSync(dir).filter(n => n.includes('.installer-backup.'))).toHaveLength(1);
  });
  it('makes the pre-migration content recoverable from the backup', () => {
    const before = '# Mine\n\n## Hard Constraints\n\n- my own rule\n';
    writeFileSync(target, before);
    mergeFileInto(tplPath, target, mergeClaudeMdText, { warn });
    const backup = readdirSync(dir).find(n => n.includes('.installer-backup.'));
    expect(readFileSync(join(dir, backup), 'utf8')).toBe(before);
    expect(readFileSync(target, 'utf8')).not.toContain('- my own rule');
  });
  it('merges through a symlink and leaves the link intact', () => {
    const real = join(dir, 'real-CLAUDE.md');
    writeFileSync(real, '# Mine\n\n## Deployment\n\nkubectl\n');
    symlinkSync(real, target);
    expect(mergeFileInto(tplPath, target, mergeClaudeMdText, { warn })).toBe('merged');
    expect(lstatSync(target).isSymbolicLink()).toBe(true);
    expect(readFileSync(real, 'utf8')).toContain('## Project Identity');
    // the backup lands beside the RESOLVED path, not beside the link
    expect(readdirSync(dir).filter(n => n.startsWith('real-CLAUDE.md.installer-backup.'))).toHaveLength(1);
    expect(readdirSync(dir).filter(n => n.startsWith('CLAUDE.md.installer-backup.'))).toEqual([]);
  });
  it('leaves a dangling symlink target untouched with a warning', () => {
    symlinkSync(join(dir, 'missing-CLAUDE.md'), target);
    expect(mergeFileInto(tplPath, target, mergeClaudeMdText, { warn })).toBe('skipped-dangling');
    expect(lstatSync(target).isSymbolicLink()).toBe(true);
    expect(existsSync(join(dir, 'missing-CLAUDE.md'))).toBe(false);
    expect(warnings.join('\n')).toMatch(/dangling symlink/);
  });
  it('skips a directory target with a warning instead of throwing', () => {
    mkdirSync(join(dir, '.gitignore'));
    expect(mergeFileInto(tplPath, join(dir, '.gitignore'), mergeClaudeMdText, { warn })).toBe('skipped-dir');
    expect(warnings.join('\n')).toMatch(/directory/);
  });
  it('skips an unbalanced-sentinel host with a warning and writes nothing', () => {
    const bad = `# Mine\n\n${SENTINEL_END}\n`;
    writeFileSync(target, bad);
    expect(mergeFileInto(tplPath, target, mergeClaudeMdText, { warn })).toBe('skipped-warning');
    expect(readFileSync(target, 'utf8')).toBe(bad);
    expect(readdirSync(dir).filter(n => n.includes('.installer-backup.'))).toEqual([]);
    expect(warnings.join('\n')).toMatch(/SENTINEL_UNBALANCED/);
  });
});

describe('resolveRealTarget', () => {
  it('reports absent, file, directory and dangling-symlink targets', () => {
    expect(resolveRealTarget(join(dir, 'nope')).exists).toBe(false);
    writeFileSync(target, 'x');
    expect(resolveRealTarget(target)).toMatchObject({ exists: true, isDir: false });
    mkdirSync(join(dir, 'adir'));
    expect(resolveRealTarget(join(dir, 'adir')).isDir).toBe(true);
    symlinkSync(join(dir, 'missing'), join(dir, 'dangling'));
    expect(resolveRealTarget(join(dir, 'dangling'))).toMatchObject({ exists: true, dangling: true });
  });
  it('reports a symlink to a directory as a directory', () => {
    mkdirSync(join(dir, 'realdir'));
    symlinkSync(join(dir, 'realdir'), join(dir, 'linkdir'));
    expect(resolveRealTarget(join(dir, 'linkdir')).isDir).toBe(true);
  });
});
