import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verbosityHookCommand, mergeVerbosityHook, pruneMalformedBackups } from '../../lib/installer/settings.mjs';

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
      { matcher: '', hooks: [{ type: 'command', command: 'python ~/.claude/hooks/graphify-ast-refresh.py' }] }
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
