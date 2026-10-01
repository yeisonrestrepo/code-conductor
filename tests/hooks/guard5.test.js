import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRE_PARSE_MAX_BYTES, ROLES, TOOL_KINDS, WRITE_TOOLS } from '../../scripts/snap-contract.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HOOK = join(REPO_ROOT, '.claude/hooks/pre-tool-use.mjs');

// The keys the 2026-09-30 spike measured on a subagent's Write (claude 2.1.286). The main
// session sends the same set without agent_id and agent_type.
function payload(tool, filePath, { cwd, agent } = {}) {
  return {
    session_id: 'sess-1', transcript_path: '/tmp/t.jsonl', cwd, prompt_id: 'prompt-1',
    permission_mode: 'default', effort: 'high', hook_event_name: 'PreToolUse',
    tool_name: tool, tool_input: { file_path: filePath, content: 'x' }, tool_use_id: 'toolu_1',
    ...(agent ? { agent_id: 'afb1811e0bd10da56', agent_type: agent } : {}),
  };
}

// Through the hook's real contract: JSON on stdin, a decision on stdout, exit 0 always.
function fire(p) {
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(p), cwd: p.cwd, encoding: 'utf8', timeout: 15000 });
  if (r.error) throw new Error(`hook spawn failed: ${r.error.message}`);
  expect(r.status).toBe(0);
  return r.stdout.trim() === '' ? null : JSON.parse(r.stdout).hookSpecificOutput;
}

let root, sub;
beforeEach(() => {
  // realpath: the macOS tmpdir is a symlink, and Guard 5 compares paths without resolving links.
  root = realpathSync(mkdtempSync(join(tmpdir(), 'cc-guard5-')));
  sub = join(root, 'sub');
  mkdirSync(join(root, '.claude', 'memory'), { recursive: true });
  mkdirSync(join(sub, 'src'), { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const envelopePath = (at = root) => join(at, '.claude', 'memory', 'band-envelope.json');
function envelope({ sys = {}, ops = {} } = {}, at = root) {
  writeFileSync(envelopePath(at), JSON.stringify({
    v: 3,
    sys: { ph: 'impl', c: 'abc1234', s: 'arch010', role: 'code', tk: 'RW', ...sys },
    ops: { n: [], f: [], scope: ['sub/src/**'], gate: 'define_approved', ...ops },
    mem: { d: [], x: [] },
  }));
}
const asCode = (tool, file) => fire(payload(tool, file, { cwd: sub, agent: 'code' }));
const violation = (path, globs) => `Guard 5: BAND_SCOPE_VIOLATION: ${path} is outside the declared scope [${globs}]`;

describe('Guard 5: band scope for role agents [ARCH-010]', () => {
  it('[A] leaves the main session alone even under a restrictive envelope', () => {
    envelope({ ops: { scope: [] } });
    expect(fire(payload('Write', join(root, 'anywhere.txt'), { cwd: sub }))).toBeNull();
  });

  it('[A] leaves an agent whose agent_type is not a role alone', () => {
    envelope({ ops: { scope: [] } });
    expect(fire(payload('Write', join(root, 'x.txt'), { cwd: sub, agent: 'probe-writer' }))).toBeNull();
  });

  // ARCH-010 T-001 measured this shape in interactive mode (claude 2.1.286): a main-session Bash
  // carried agent_id with no agent_type. Guard 5 keys on agent_type alone, so it is Case A.
  it('[A] leaves a payload carrying agent_id without agent_type alone', () => {
    envelope({ ops: { scope: [] } });
    const p = { ...payload('Write', join(root, 'x.txt'), { cwd: sub }), agent_id: 'adcc0758336c23e70' };
    expect(fire(p)).toBeNull();
  });

  it('[B] allows a role agent when no envelope exists above cwd (AC9)', () => {
    const lone = realpathSync(mkdtempSync(join(tmpdir(), 'cc-guard5-lone-')));
    try {
      expect(fire(payload('Write', join(lone, 'x.txt'), { cwd: lone, agent: 'code' }))).toBeNull();
    } finally { rmSync(lone, { recursive: true, force: true }); }
  });

  it.each([
    ['malformed JSON', '{not json'],
    ['a v2 envelope', JSON.stringify({ v: 2, sys: { ph: 'impl', c: 'abc1234', s: 'x' }, ops: { n: [], f: [] }, mem: { d: [], x: [] }, pr: '' })],
    ['a v3 envelope with no role', JSON.stringify({ v: 3, sys: { ph: 'impl', c: 'abc1234', s: 'x', tk: 'RW' }, ops: { n: [], f: [], scope: ['**'], gate: 'define_approved' }, mem: { d: [], x: [] } })],
  ])('[C] denies a role agent on %s, naming the file', (_, text) => {
    writeFileSync(envelopePath(), text);
    const d = asCode('Write', join(sub, 'src', 'a.js'));
    expect(d.permissionDecision).toBe('deny');
    expect(d.permissionDecisionReason).toBe(`Guard 5: BAND_ENVELOPE_INVALID: ${envelopePath()} is unreadable or not a valid v3 band envelope.`);
  });

  it('[C] denies on an envelope larger than the pre-parse ceiling', () => {
    writeFileSync(envelopePath(), ' '.repeat(PRE_PARSE_MAX_BYTES + 1));
    expect(asCode('Write', join(sub, 'src', 'a.js')).permissionDecisionReason).toContain('BAND_ENVELOPE_INVALID');
  });

  it('[D] denies a role agent that is not the envelope role', () => {
    envelope();
    const d = fire(payload('Write', join(sub, 'src', 'a.js'), { cwd: sub, agent: 'qa' }));
    expect(d.permissionDecision).toBe('deny');
    expect(d.permissionDecisionReason).toBe("Guard 5: BAND_ROLE_MISMATCH: agent qa is not the envelope's role code.");
  });

  it.each(['R', 'X'])('[E] denies a write under tk %s', (tk) => {
    envelope({ sys: { tk }, ops: { scope: undefined } });
    const d = asCode('Write', join(sub, 'src', 'a.js'));
    expect(d.permissionDecision).toBe('deny');
    expect(d.permissionDecisionReason).toBe(`Guard 5: BAND_READ_ONLY: role code holds tk ${tk}, not RW.`);
  });

  it('[F] anchors scope globs at the band root, not at cwd', () => {
    envelope({ ops: { scope: ['src/**'] } });
    const file = join(sub, 'src', 'a.js');
    expect(asCode('Write', file).permissionDecisionReason).toBe(violation(file, 'src/**'));
  });

  it('[F] denies a target above the band root', () => {
    envelope({ ops: { scope: ['**'] } });
    const file = join(dirname(root), 'escaped.txt');
    expect(asCode('Write', file).permissionDecisionReason).toBe(violation(file, '**'));
  });

  it('[F] gates Edit, which no other guard covers', () => {
    envelope();
    const file = join(root, 'README.md');
    expect(asCode('Edit', file).permissionDecisionReason).toBe(violation(file, 'sub/src/**'));
  });

  it('[F] an empty scope denies every write', () => {
    envelope({ ops: { scope: [] } });
    const file = join(sub, 'src', 'a.js');
    expect(asCode('Write', file).permissionDecisionReason).toBe(violation(file, ''));
  });

  it('[G] allows an absolute in-scope target from a subdirectory cwd', () => {
    envelope();
    expect(asCode('Write', join(sub, 'src', 'deep', 'a.js'))).toBeNull();
  });

  it('[G] resolves a relative target against the payload cwd', () => {
    envelope();
    expect(asCode('Write', 'src/a.js')).toBeNull();
  });

  it('[G] still lets Guard 2 ask about an existing in-scope file', () => {
    envelope();
    const file = join(sub, 'src', 'exists.js');
    writeFileSync(file, 'y\n');
    expect(asCode('Write', file).permissionDecision).toBe('ask');
  });

  it('[G] allows an in-scope Edit', () => {
    envelope();
    expect(asCode('Edit', join(sub, 'src', 'a.js'))).toBeNull();
  });

  it('keeps a single * inside one path segment', () => {
    envelope({ ops: { scope: ['sub/*.js'] } });
    expect(asCode('Write', join(sub, 'a.js'))).toBeNull();
    expect(asCode('Write', join(sub, 'src', 'a.js')).permissionDecision).toBe('deny');
  });

  it('lets **/ match zero or more directories', () => {
    envelope({ ops: { scope: ['**/*.md'] } });
    expect(asCode('Write', join(root, 'top.md'))).toBeNull();
    expect(asCode('Write', join(sub, 'a', 'b', 'x.md'))).toBeNull();
    expect(asCode('Write', join(root, 'top.txt')).permissionDecision).toBe('deny');
  });

  it('treats a file name that starts with .. as inside the band root', () => {
    envelope({ ops: { scope: ['**'] } });
    expect(asCode('Write', join(root, '..notes.md'))).toBeNull();
  });

  it('uses the nearest envelope above cwd as the band root', () => {
    envelope();
    mkdirSync(join(sub, '.claude', 'memory'), { recursive: true });
    envelope({ sys: { role: 'qa', tk: 'X' }, ops: { scope: undefined, gate: 'build_executed' } }, sub);
    expect(asCode('Write', join(sub, 'src', 'a.js')).permissionDecisionReason)
      .toBe("Guard 5: BAND_ROLE_MISMATCH: agent code is not the envelope's role qa.");
  });

  it('[AC10] carries band constants equal to scripts/snap-contract.mjs (D7)', () => {
    const text = readFileSync(HOOK, 'utf8');
    const list = (name) => JSON.parse(text.match(new RegExp(`const ${name} = (\\[[^\\]]*\\]);`))[1].replace(/'/g, '"'));
    expect(list('BAND_ROLES')).toEqual(ROLES);
    expect(list('BAND_TOOL_KINDS')).toEqual(TOOL_KINDS);
    expect(list('BAND_WRITE_TOOLS')).toEqual(WRITE_TOOLS);
    expect(Number(text.match(/const BAND_ENVELOPE_MAX_BYTES = (\d+);/)[1])).toBe(PRE_PARSE_MAX_BYTES);
  });
});
