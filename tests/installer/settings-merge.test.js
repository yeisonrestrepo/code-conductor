import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync, existsSync, lstatSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergeSettingsFile, entryMatches, matchingFingerprints } from '../../lib/installer/settings-merge.mjs';
import { MERGE_OWNED_KEYS } from '../../lib/installer/host-owned.mjs';

const FPS = ['pre-tool-use.mjs', 'post-compact.sh', 'verbosity-remind.sh'];
const TPL = {
  hooks: {
    PreToolUse: [{ matcher: 'Read|Bash', hooks: [{ type: 'command', command: 'node .claude/hooks/pre-tool-use.mjs' }] }],
    PostCompact: [{ hooks: [
      { type: 'command', command: 'bash .claude/hooks/post-compact.sh' },
      { type: 'command', command: 'powershell .claude/hooks/post-compact.ps1' },
    ] }],
  },
  permissions: { allow: [], deny: [] },
};
const HOST_ENTRY = { matcher: '', hooks: [{ type: 'command', command: 'bash /home/me/my-own-hook.sh' }] };

let dir, tpl, sp;
const write = (p, o) => writeFileSync(p, `${JSON.stringify(o, null, 2)}\n`, 'utf8');
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cc-sm-'));
  tpl = join(dir, 'template.json');
  sp = join(dir, 'settings.json');
  write(tpl, TPL);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('entryMatches', () => {
  it('matches on any command in the entry and tolerates junk', () => {
    expect(entryMatches({ hooks: [{ command: 'x' }, { command: 'run post-compact.sh now' }] }, 'post-compact.sh')).toBe(true);
    expect(entryMatches({ hooks: [{ command: 'x' }] }, 'post-compact.sh')).toBe(false);
    expect(entryMatches(null, 'x')).toBe(false);
    expect(entryMatches({ hooks: 'nope' }, 'x')).toBe(false);
    expect(entryMatches({ hooks: [null, { command: 7 }] }, 'x')).toBe(false);
  });
  it('reports every fingerprint an entry carries', () => {
    const e = { hooks: [{ command: 'a pre-tool-use.mjs b' }, { command: 'c post-compact.sh d' }] };
    expect(matchingFingerprints(e, FPS)).toEqual(['pre-tool-use.mjs', 'post-compact.sh']);
  });
});

describe('mergeSettingsFile: fresh and degenerate targets', () => {
  it('writes the template verbatim when settings.json is absent', () => {
    expect(mergeSettingsFile(tpl, sp, FPS)).toBe('created');
    expect(readFileSync(sp, 'utf8')).toBe(readFileSync(tpl, 'utf8'));
    expect(read(sp).permissions).toEqual({ allow: [], deny: [] });
  });
  it('reports a missing template instead of throwing', () => {
    expect(mergeSettingsFile(join(dir, 'nope.json'), sp, FPS)).toBe('skipped-missing-template');
    expect(existsSync(sp)).toBe(false);
  });
  it('skips a directory at the target path', () => {
    mkdirSync(sp);
    expect(mergeSettingsFile(tpl, sp, FPS)).toBe('skipped-dir');
  });
  it('skips a dangling symlink rather than replacing it with a file', () => {
    symlinkSync(join(dir, 'gone.json'), sp);
    expect(mergeSettingsFile(tpl, sp, FPS)).toBe('skipped-dangling');
    expect(lstatSync(sp).isSymbolicLink()).toBe(true);
  });
  it('treats a whitespace-only file as empty and merges without a backup', () => {
    writeFileSync(sp, '  \n');
    expect(mergeSettingsFile(tpl, sp, FPS)).toBe('merged');
    expect(readdirSync(dir).some((n) => n.includes('malformed-backup'))).toBe(false);
    expect(read(sp).hooks.PreToolUse).toHaveLength(1);
  });
});

describe('mergeSettingsFile: host preservation', () => {
  it('leaves a host-added entry present and unmodified', () => {
    write(sp, { hooks: { PreToolUse: [HOST_ENTRY] } });
    expect(mergeSettingsFile(tpl, sp, FPS)).toBe('merged');
    const arr = read(sp).hooks.PreToolUse;
    expect(arr[0]).toEqual(HOST_ENTRY);
    expect(arr).toHaveLength(2);
  });
  it('leaves a host-modified permissions block byte-identical, including a removed grant', () => {
    const permissions = { allow: ['Bash(grep:*)'], deny: ['Bash(curl:*)'] };
    write(sp, { permissions, hooks: {} });
    mergeSettingsFile(tpl, sp, FPS);
    expect(read(sp).permissions).toEqual(permissions);
  });
  it('writes no top-level key outside MERGE_OWNED_KEYS', () => {
    const host = {
      permissions: { allow: ['Bash(ls:*)'], deny: [] },
      env: { FOO: 'bar' },
      statusLine: { type: 'command', command: 'echo hi' },
      model: 'claude-opus-5',
      somethingClaudeCodeAddsLater: { a: 1 },
    };
    write(sp, host);
    mergeSettingsFile(tpl, sp, FPS);
    const after = read(sp);
    for (const [k, v] of Object.entries(host)) expect(after[k]).toEqual(v);
    const added = Object.keys(after).filter((k) => !(k in host));
    expect(added.every((k) => MERGE_OWNED_KEYS.includes(k))).toBe(true);
    expect(added).toEqual(['hooks']);
  });
});

describe('mergeSettingsFile: owned entries', () => {
  it('replaces a conductor entry in position when its command changed', () => {
    const stale = { matcher: 'Write', hooks: [{ type: 'command', command: 'node .claude/hooks/pre-tool-use.mjs' }] };
    write(sp, { hooks: { PreToolUse: [HOST_ENTRY, stale, { matcher: 'z', hooks: [{ command: 'tail' }] }] } });
    mergeSettingsFile(tpl, sp, FPS);
    const arr = read(sp).hooks.PreToolUse;
    expect(arr).toHaveLength(3);
    expect(arr[0]).toEqual(HOST_ENTRY);
    expect(arr[1].matcher).toBe('Read|Bash');
    expect(arr[2].matcher).toBe('z');
  });
  it('collapses a duplicated conductor entry to one, keeping the first position', () => {
    const owned = { matcher: 'old', hooks: [{ type: 'command', command: 'node .claude/hooks/pre-tool-use.mjs' }] };
    write(sp, { hooks: { PreToolUse: [owned, HOST_ENTRY, owned] } });
    mergeSettingsFile(tpl, sp, FPS);
    const arr = read(sp).hooks.PreToolUse;
    expect(arr).toHaveLength(2);
    expect(arr[0].matcher).toBe('Read|Bash');
    expect(arr[1]).toEqual(HOST_ENTRY);
  });
  it('is byte-identical on a second run of an unchanged release', () => {
    write(sp, { hooks: { PreToolUse: [HOST_ENTRY] }, permissions: { allow: ['Bash(ls:*)'] } });
    mergeSettingsFile(tpl, sp, FPS);
    const first = readFileSync(sp, 'utf8');
    expect(mergeSettingsFile(tpl, sp, FPS)).toBe('unchanged');
    expect(readFileSync(sp, 'utf8')).toBe(first);
  });
  it('treats a non-array hook event as absent without discarding sibling events', () => {
    write(sp, { hooks: { PreToolUse: 'nonsense', UserPromptSubmit: [HOST_ENTRY] } });
    expect(mergeSettingsFile(tpl, sp, FPS)).toBe('merged');
    const after = read(sp);
    expect(after.hooks.PreToolUse).toHaveLength(1);
    expect(after.hooks.UserPromptSubmit).toEqual([HOST_ENTRY]);
  });
});

describe('mergeSettingsFile: malformed', () => {
  it('backs up invalid JSON and writes the template so the host keeps a working file', () => {
    writeFileSync(sp, '{ not: valid, }');
    expect(mergeSettingsFile(tpl, sp, FPS, { now: new Date('2026-07-05T12:34:56Z') })).toBe('malformed-replaced');
    expect(readdirSync(dir).filter((n) => n.includes('malformed-backup')))
      .toEqual(['settings.json.malformed-backup.20260705T123456Z']);
    expect(readFileSync(join(dir, 'settings.json.malformed-backup.20260705T123456Z'), 'utf8')).toBe('{ not: valid, }');
    expect(read(sp).hooks.PreToolUse).toHaveLength(1);
  });
  it('treats an array root as malformed', () => {
    writeFileSync(sp, '[]');
    expect(mergeSettingsFile(tpl, sp, FPS, { now: new Date('2026-07-05T12:34:56Z') })).toBe('malformed-replaced');
  });
});

describe('mergeSettingsFile: symlink', () => {
  it('writes through the link and leaves it a link', () => {
    const real = join(dir, 'real-settings.json');
    write(real, { hooks: { PreToolUse: [HOST_ENTRY] } });
    symlinkSync(real, sp);
    expect(mergeSettingsFile(tpl, sp, FPS)).toBe('merged');
    expect(lstatSync(sp).isSymbolicLink()).toBe(true);
    expect(read(real).hooks.PreToolUse).toHaveLength(2);
  });
});
