import { describe, it, expect, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { digestTree } from '../../lib/installer/file-digests.mjs';
import { UIPRO_CLAUDE_OUTPUT, UIPRO_FLAT_HASHES, sweepStaleUipro } from '../../lib/installer/stale-uipro.mjs';

const RM = { recursive: true, force: true, maxRetries: 10, retryDelay: 200 };
const temps = [];
const tempDir = () => { const d = realpathSync(mkdtempSync(join(tmpdir(), 'cc-uipro-'))); temps.push(d); return d; };
afterEach(() => { for (const d of temps.splice(0)) rmSync(d, RM); });

const sha = (text) => createHash('sha256').update(text).digest('hex');
const FILES = { 'SKILL.md': 'skill', 'data/styles.csv': 'styles', 'scripts/core.py': 'core' };

// A small stand-in for the uipro-cli output: the same shape, synthetic bytes.
function plantSkill(dir, files = FILES) {
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), text);
  }
}

function setup() {
  const cwd = tempDir();
  const home = tempDir();
  const skillDir = join(cwd, '.claude', 'skills', 'ui-ux-pro-max');
  plantSkill(skillDir);
  const known = new Map([['9.9.9', digestTree(skillDir)]]);
  return { cwd, home, skillDir, known };
}

describe('the shipped table', () => {
  it('S1 holds the uipro-cli 2.2.3 digests and no flat-file hash', () => {
    expect([...UIPRO_CLAUDE_OUTPUT.keys()]).toEqual(['2.2.3']);
    const table = UIPRO_CLAUDE_OUTPUT.get('2.2.3');
    const entries = Object.entries(table);
    expect(entries).toHaveLength(31);
    for (const [, digest] of entries) expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(table['SKILL.md']).toBe('07b87b8998b51b9c234df031e31aa2a85cf86abeaa05efd984c2f66ca7f06d68');
    const lines = entries.sort(([a], [b]) => (a < b ? -1 : 1)).map(([path, digest]) => `${digest} ${path}\n`).join('');
    expect(sha(lines)).toBe('b474d030548bdc3a092512a709cda05362ab263b735d1379418fd05629120a88');
    expect(UIPRO_FLAT_HASHES.size).toBe(0);
  });
});

describe('sweepStaleUipro, project copy', () => {
  it('S2 removes a tree equal to a known version and says which', () => {
    const { cwd, home, skillDir, known } = setup();
    const result = sweepStaleUipro({ cwd, home, known });
    expect(existsSync(skillDir)).toBe(false);
    expect(result).toEqual({ stdout: [`removed stale ui-ux-pro-max skill (uipro-cli 9.9.9 content): ${skillDir}`], stderr: [] });
  });

  it('S3 leaves a tree with one changed byte untouched and names it', () => {
    const { cwd, home, skillDir, known } = setup();
    writeFileSync(join(skillDir, 'SKILL.md'), 'skilL');
    const before = digestTree(skillDir);
    const result = sweepStaleUipro({ cwd, home, known });
    expect(digestTree(skillDir)).toEqual(before);
    expect(result).toEqual({ stdout: [], stderr: [`left ui-ux-pro-max in place (does not match a known install; review and remove it yourself): ${skillDir}`] });
  });

  it('S4 leaves a tree with one extra file and names it', () => {
    const { cwd, home, skillDir, known } = setup();
    writeFileSync(join(skillDir, 'notes.md'), 'mine');
    expect(sweepStaleUipro({ cwd, home, known }).stderr).toHaveLength(1);
    expect(existsSync(join(skillDir, 'notes.md'))).toBe(true);
  });

  it('S5 leaves a tree with one file missing and names it', () => {
    const { cwd, home, skillDir, known } = setup();
    rmSync(join(skillDir, 'scripts', 'core.py'));
    expect(sweepStaleUipro({ cwd, home, known }).stderr).toHaveLength(1);
    expect(existsSync(skillDir)).toBe(true);
  });

  it('S6 leaves a tree holding a junction and never touches its target', () => {
    const { cwd, home, skillDir, known } = setup();
    const target = tempDir();
    writeFileSync(join(target, 'keep.txt'), 'keep');
    symlinkSync(target, join(skillDir, 'linked'), 'junction');
    const result = sweepStaleUipro({ cwd, home, known });
    expect(result.stderr).toEqual([`left ui-ux-pro-max in place (does not match a known install; review and remove it yourself): ${skillDir}`]);
    expect(readFileSync(join(target, 'keep.txt'), 'utf8')).toBe('keep');
    expect(existsSync(skillDir)).toBe(true);
  });

  it('S7 leaves ui-ux-pro-max itself when it is a junction to a matching tree', () => {
    const cwd = tempDir();
    const home = tempDir();
    const elsewhere = tempDir();
    plantSkill(elsewhere);
    mkdirSync(join(cwd, '.claude', 'skills'), { recursive: true });
    const skillDir = join(cwd, '.claude', 'skills', 'ui-ux-pro-max');
    symlinkSync(elsewhere, skillDir, 'junction');
    const known = new Map([['9.9.9', digestTree(elsewhere)]]);
    const result = sweepStaleUipro({ cwd, home, known });
    expect(result.stdout).toEqual([]);
    expect(result.stderr).toEqual([`left ui-ux-pro-max in place (does not match a known install; review and remove it yourself): ${skillDir}`]);
    expect(readFileSync(join(elsewhere, 'SKILL.md'), 'utf8')).toBe('skill');
  });

  it('S10 reports nothing when neither copy exists', () => {
    expect(sweepStaleUipro({ cwd: tempDir(), home: tempDir() })).toEqual({ stdout: [], stderr: [] });
  });

  it('S11 reports a removal that throws and does not throw itself', () => {
    const { cwd, home, skillDir, known } = setup();
    const rm = () => { throw Object.assign(new Error('denied'), { code: 'EPERM' }); };
    const result = sweepStaleUipro({ cwd, home, known, rm });
    expect(result).toEqual({ stdout: [], stderr: [`left ui-ux-pro-max in place (EPERM): ${skillDir}`] });
    expect(existsSync(skillDir)).toBe(true);
  });
});

describe('sweepStaleUipro, flat file', () => {
  const flatFile = (home) => join(home, '.claude', 'skills', 'ui-ux-pro-max.md');
  function plantFlat(home, text) {
    mkdirSync(join(home, '.claude', 'skills'), { recursive: true });
    writeFileSync(flatFile(home), text);
  }

  it('S8 removes a flat file whose hash is in the injected map, with its label', () => {
    const cwd = tempDir();
    const home = tempDir();
    plantFlat(home, 'old download');
    const flatHashes = new Map([[sha('old download'), 'curl download']]);
    const result = sweepStaleUipro({ cwd, home, flatHashes });
    expect(existsSync(flatFile(home))).toBe(false);
    expect(result).toEqual({ stdout: [`removed stale ui-ux-pro-max skill (curl download content): ${flatFile(home)}`], stderr: [] });
  });

  it('S9 leaves the same file with the default empty map and names it', () => {
    const cwd = tempDir();
    const home = tempDir();
    plantFlat(home, 'old download');
    const result = sweepStaleUipro({ cwd, home });
    expect(existsSync(flatFile(home))).toBe(true);
    expect(result).toEqual({ stdout: [], stderr: [`left ui-ux-pro-max in place (does not match a known install; review and remove it yourself): ${flatFile(home)}`] });
  });
});
