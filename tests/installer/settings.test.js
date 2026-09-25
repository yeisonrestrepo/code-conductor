import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verbosityHookCommand, mergeVerbosityHook, pruneMalformedBackups, utcStamp, pruneBackups } from '../../lib/installer/settings.mjs';

let dir, sp;
const CMD = 'bash /h/.claude/hooks/verbosity-remind.sh';
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cc-set-')); sp = join(dir, 'settings.json'); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('verbosityHookCommand', () => {
  it('builds the bash hook command from home', () => {
    expect(verbosityHookCommand('/h')).toContain('verbosity-remind.sh');
    expect(verbosityHookCommand('/h').startsWith('bash ')).toBe(true);
  });
  it('uses forward slashes even for a Windows-style home', () => {
    const cmd = verbosityHookCommand('C:\\Users\\a');
    expect(cmd).not.toContain('\\');
    expect(cmd).toMatch(/verbosity-remind\.sh$/);
  });
});

describe('mergeVerbosityHook', () => {
  it('adds the hook to a graphify-only settings file (fresh install)', () => {
    writeFileSync(sp, JSON.stringify({ hooks: { UserPromptSubmit: [
      { matcher: '', hooks: [{ type: 'command', command: 'python3 ~/.claude/hooks/graphify-ast-refresh.py' }] }
    ] } }));
    expect(mergeVerbosityHook(sp, CMD).status).toBe('merged');
    const arr = JSON.parse(readFileSync(sp, 'utf8')).hooks.UserPromptSubmit;
    expect(arr).toHaveLength(2);
    expect(arr.some(e => e.hooks.some(h => h.command === CMD))).toBe(true);
    expect(arr.some(e => e.hooks.some(h => h.command.includes('graphify')))).toBe(true);
  });
  it('is idempotent — second run does not duplicate', () => {
    writeFileSync(sp, '{}');
    mergeVerbosityHook(sp, CMD);
    expect(mergeVerbosityHook(sp, CMD).status).toBe('idempotent-skip');
    const arr = JSON.parse(readFileSync(sp, 'utf8')).hooks.UserPromptSubmit;
    expect(arr.filter(e => e.hooks.some(h => h.command === CMD))).toHaveLength(1);
  });
  it('replaces a stale verbosity entry (different path) with one fresh entry', () => {
    writeFileSync(sp, JSON.stringify({ hooks: { UserPromptSubmit: [
      { matcher: '', hooks: [{ type: 'command', command: 'bash /old/verbosity-remind.sh' }] }
    ] } }));
    mergeVerbosityHook(sp, CMD);
    const arr = JSON.parse(readFileSync(sp, 'utf8')).hooks.UserPromptSubmit;
    expect(arr.filter(e => e.hooks.some(h => h.command.includes('verbosity-remind.sh')))).toHaveLength(1);
    expect(arr[0].hooks[0].command).toBe(CMD);
  });
  it('creates hooks scaffold when absent', () => {
    writeFileSync(sp, '{"permissions":{"allow":[]}}');
    mergeVerbosityHook(sp, CMD);
    const o = JSON.parse(readFileSync(sp, 'utf8'));
    expect(o.permissions).toEqual({ allow: [] });
    expect(o.hooks.UserPromptSubmit[0].hooks[0].command).toBe(CMD);
  });
  it('initializes a fresh file when settings.json is missing (ENOENT)', () => {
    // sp does not exist in this temp dir.
    expect(mergeVerbosityHook(sp, CMD).status).toBe('merged');
    const o = JSON.parse(readFileSync(sp, 'utf8'));
    expect(o.hooks.UserPromptSubmit[0].hooks[0].command).toBe(CMD);
  });
  it('treats a zero-byte / whitespace-only file as empty, not malformed', () => {
    writeFileSync(sp, '   \n');
    expect(mergeVerbosityHook(sp, CMD).status).toBe('merged');
    expect(readdirSync(dir).some(n => n.includes('malformed-backup'))).toBe(false);
    expect(JSON.parse(readFileSync(sp, 'utf8')).hooks.UserPromptSubmit[0].hooks[0].command).toBe(CMD);
  });
  it('backs up and skips on malformed JSON, leaving the original intact', () => {
    writeFileSync(sp, '{ not: valid, }');
    expect(mergeVerbosityHook(sp, CMD, new Date('2026-07-05T12:34:56Z')).status).toBe('malformed-skipped');
    expect(readFileSync(sp, 'utf8')).toBe('{ not: valid, }');
    const backups = readdirSync(dir).filter(n => n.includes('malformed-backup'));
    expect(backups).toEqual(['settings.json.malformed-backup.20260705T123456Z']);
  });
  it('backs up and skips on a non-object root (array)', () => {
    writeFileSync(sp, '[]');
    expect(mergeVerbosityHook(sp, CMD).status).toBe('malformed-skipped');
  });
});

describe('pruneMalformedBackups', () => {
  it('keeps only the newest 5 by lexical (== chronological) order', () => {
    for (const t of ['20260101T000000Z','20260102T000000Z','20260103T000000Z','20260104T000000Z','20260105T000000Z','20260106T000000Z']) {
      writeFileSync(`${sp}.malformed-backup.${t}`, 'x');
    }
    pruneMalformedBackups(sp);
    const left = readdirSync(dir).filter(n => n.includes('malformed-backup')).sort();
    expect(left).toHaveLength(5);
    expect(left[0]).toContain('20260102');
  });
});

describe('utcStamp + pruneBackups', () => {
  it('formats a fixed-width UTC stamp whose lexical order is chronological', () => {
    const a = utcStamp(new Date('2026-07-05T12:34:56.789Z'));
    const b = utcStamp(new Date('2026-07-05T12:34:57.001Z'));
    expect(a).toBe('20260705T123456Z');
    expect(a.length).toBe(b.length);
    expect(a < b).toBe(true);
  });
  it('prunes an arbitrary suffix family down to keep, oldest first', () => {
    const target = join(dir, 'CLAUDE.md');
    writeFileSync(target, 'x');
    for (const s of ['20260101T000000Z', '20260102T000000Z', '20260103T000000Z']) {
      writeFileSync(`${target}.installer-backup.${s}`, s);
    }
    pruneBackups(target, '.installer-backup.', 2);
    const left = readdirSync(dir).filter(n => n.includes('.installer-backup.')).sort();
    expect(left).toEqual(['CLAUDE.md.installer-backup.20260102T000000Z', 'CLAUDE.md.installer-backup.20260103T000000Z']);
  });
  it('leaves an unrelated suffix family untouched', () => {
    const target = join(dir, 'CLAUDE.md');
    writeFileSync(target, 'x');
    writeFileSync(`${target}.malformed-backup.20260101T000000Z`, 'a');
    writeFileSync(`${target}.installer-backup.20260101T000000Z`, 'b');
    pruneBackups(target, '.installer-backup.', 0);
    expect(existsSync(`${target}.malformed-backup.20260101T000000Z`)).toBe(true);
    expect(existsSync(`${target}.installer-backup.20260101T000000Z`)).toBe(false);
  });
});

// The first test in this suite that reads the SHIPPED asset rather than a temp
// fixture. Line 27 above is fixture input to mergeVerbosityHook, not a claim
// about what code-conductor ships, which is why the wrong interpreter shipped
// unnoticed: nothing looked at global/settings.json at all.
describe('shipped global/settings.json', () => {
  const SHIPPED = resolve(dirname(fileURLToPath(import.meta.url)), '../../global/settings.json');
  it('wires the graphify hook with python3, not the bare python macOS removed', () => {
    const o = JSON.parse(readFileSync(SHIPPED, 'utf8'));
    const cmds = o.hooks.UserPromptSubmit.flatMap(e => e.hooks.map(h => h.command));
    expect(cmds).toContain('python3 ~/.claude/hooks/graphify-ast-refresh.py');
  });
});
