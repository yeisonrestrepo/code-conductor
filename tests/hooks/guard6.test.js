import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { RUN_FILE, WRITE_SURFACE } from '../../scripts/orchestrate.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HOOK = join(REPO_ROOT, '.claude/hooks/pre-tool-use.mjs');

// The spike's measured key set (claude 2.1.286). Main session: no agent_id, no agent_type.
// sid null leaves session_id out entirely.
function payload(tool, filePath, { cwd, sid = 'sess-1', agentId, agentType } = {}) {
  return {
    ...(sid === null ? {} : { session_id: sid }), transcript_path: '/tmp/t.jsonl', cwd, prompt_id: 'prompt-1',
    permission_mode: 'default', effort: 'high', hook_event_name: 'PreToolUse',
    tool_name: tool, tool_input: { file_path: filePath, content: 'x' }, tool_use_id: 'toolu_1',
    ...(agentId ? { agent_id: agentId } : {}), ...(agentType ? { agent_type: agentType } : {}),
  };
}

// The whole stdout object, because a warning travels beside the decision, not inside it.
function fire(p) {
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(p), cwd: p.cwd, encoding: 'utf8', timeout: 15000 });
  if (r.error) throw new Error(`hook spawn failed: ${r.error.message}`);
  expect(r.status).toBe(0);
  const out = r.stdout.trim() === '' ? {} : JSON.parse(r.stdout);
  return { decision: out.hookSpecificOutput ?? null, warning: `${out.systemMessage ?? ''}${r.stderr}`, out, stderr: r.stderr };
}

let root, sub;
beforeEach(() => {
  // realpath: the macOS tmpdir is a symlink, and the guards compare paths without resolving links.
  root = realpathSync(mkdtempSync(join(tmpdir(), 'cc-guard6-')));
  sub = join(root, 'sub');
  mkdirSync(join(root, '.claude', 'memory'), { recursive: true });
  mkdirSync(join(sub, 'src'), { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const runFile = (text) => writeFileSync(join(root, RUN_FILE), text);
const liveRun = (fields = {}) => runFile(JSON.stringify({ v: 1, session_id: 'sess-1', item: 'FEAT-011', started: '2026-10-01T12:00:00.000Z', gate: 'boundary_routed', ...fields }));
const asMain = (target, opts = {}) => fire(payload('Write', target, { cwd: root, ...opts }));
const denied = (target) => `Guard 6: ORCH_WRITE_DENIED: ${target} is outside the orchestrator's write surface while run FEAT-011 is live; repository writes during a run go through a band role (Guard 5).`;
const tracked = () => join(root, 'README.md');
// R7's tools carry no file_path. The inputs are the shapes FEAT-011 V1 logged on claude 2.1.287.
const DISPATCH_INPUT = {
  Agent: { description: 'Write leaf.txt file', prompt: 'Write leaf.txt', subagent_type: 'leaf' },
  SendMessage: { to: 'main', summary: 'report', message: 'done', type: 'message' },
};
const dispatch = (tool, opts = {}) => fire({ ...payload(tool, '', { cwd: root, ...opts }), tool_input: DISPATCH_INPUT[tool] });
const nested = (tool, agentType) => `Guard 6: ORCH_NESTED_DISPATCH: ${tool} from agent ${agentType} is denied while run FEAT-011 is live; only the orchestrator dispatches or messages agents during a run.`;

describe('Guard 6: the orchestrator holds no repository write access [FEAT-011]', () => {
  it('[R1] steps aside for a band role, which Guard 5 governs', () => {
    liveRun();
    writeFileSync(join(root, '.claude', 'memory', 'band-envelope.json'), JSON.stringify({
      v: 3, sys: { ph: 'impl', c: 'abc1234', s: 'FEAT-011', role: 'code', tk: 'RW' },
      ops: { n: [], f: [], scope: ['sub/src/**'], gate: 'define_approved' }, mem: { d: [], x: [] },
    }));
    expect(fire(payload('Write', join(sub, 'src', 'a.js'), { cwd: sub, agentId: 'a1', agentType: 'code' })).decision).toBeNull();
  });

  it('[R2] allows every write when no run file exists', () => {
    const r = asMain(tracked());
    expect(r.decision).toBeNull();
    expect(r.warning).toBe('');
  });

  it.each([['bad JSON', '{not json'], ['a missing session_id', JSON.stringify({ v: 1, item: 'FEAT-011' })]])(
    '[R3] fails open with ORCH_RUN_INVALID on %s', (_, text) => {
      runFile(text);
      const r = asMain(tracked());
      expect(r.decision).toBeNull();
      expect(r.warning).toContain(`Guard 6: ORCH_RUN_INVALID: ${join(root, RUN_FILE)} is unreadable or not a valid run file`);
      expect(r.warning).toContain('Clear it with: node scripts/orchestrate.mjs end');
    });

  it.each([['another session', 'sess-2'], ['no session_id at all', null]])(
    '[R4] fails open with ORCH_RUN_STALE when the payload carries %s (AC5)', (_, sid) => {
      liveRun();
      const r = asMain(tracked(), { sid });
      expect(r.decision).toBeNull();
      expect(r.warning).toContain('Guard 6: ORCH_RUN_STALE: run FEAT-011 (started 2026-10-01T12:00:00.000Z) belongs to another session');
      expect(r.warning).toContain('Clear it with: node scripts/orchestrate.mjs end');
    });

  it.each([
    '.claude/memory/orchestrator-run.json', '.claude/memory/band-envelope.json',
    '.claude/memory/session-snapshot.json', '.conductor/cache.db',
  ])('[R5] allows the live session to write %s', (rel) => {
    liveRun();
    // Edit, because Guard 2 would rightly ask about the run file, which already exists.
    const r = fire(payload('Edit', join(root, rel), { cwd: root }));
    expect(r.decision).toBeNull();
    expect(r.warning).toBe('');
  });

  it('[R6] denies the main-session shape a tracked path', () => {
    liveRun();
    expect(asMain(tracked()).decision).toEqual({
      hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: denied(tracked()),
    });
  });

  // Discriminator: a Guard 6 keyed on agent_id (as if it marked a subagent) lets this through.
  // T-001 of ARCH-010 measured the shape in interactive mode on claude 2.1.286.
  it('[R6] denies an agent_id-only payload a tracked path', () => {
    liveRun();
    expect(asMain(tracked(), { agentId: 'adcc0758336c23e70' }).decision.permissionDecisionReason).toBe(denied(tracked()));
  });

  it('[R6] denies a non-role agent such as general-purpose a tracked path', () => {
    liveRun();
    expect(asMain(tracked(), { agentId: 'a2', agentType: 'general-purpose' }).decision.permissionDecisionReason).toBe(denied(tracked()));
  });

  it('[R6] denies a write that names no path', () => {
    liveRun();
    expect(asMain('').decision.permissionDecisionReason).toBe(denied('<no path>'));
  });

  it('denies near-miss names of the surface entries', () => {
    liveRun();
    for (const rel of ['.claude/memory/orchestrator-run.json.tmp', '.claude/memory/band-envelope.json.bak', '.conductorx/cache.db', '.claude/memory/project.md']) {
      expect(asMain(join(root, rel)).decision.permissionDecision).toBe('deny');
    }
  });

  it('denies a target above the run root', () => {
    liveRun();
    expect(asMain('../outside.txt').decision.permissionDecisionReason).toBe(denied('../outside.txt'));
  });

  it('anchors the surface at the run root, not at cwd', () => {
    liveRun();
    expect(fire(payload('Write', join(root, '.conductor', 'x.log'), { cwd: sub })).decision).toBeNull();
    expect(fire(payload('Write', join(sub, '.conductor', 'x.log'), { cwd: sub })).decision.permissionDecision).toBe('deny');
  });

  it('outranks Guard 2: an existing tracked file is denied, never asked about', () => {
    liveRun();
    writeFileSync(tracked(), 'exists\n');
    expect(asMain(tracked()).decision.permissionDecision).toBe('deny');
  });

  it('decides nothing with its warning: a stale run still lets Guard 2 ask', () => {
    liveRun({ session_id: 'sess-2' });
    writeFileSync(tracked(), 'exists\n');
    const r = asMain(tracked());
    expect(r.decision.permissionDecision).toBe('ask');
    expect(r.warning).toContain('Guard 6: ORCH_RUN_STALE');
  });

  it('[V3] warns on the channel V3 measured: systemMessage, with stderr left empty', () => {
    liveRun({ session_id: 'sess-2' });
    const r = asMain(tracked());
    expect(r.out.systemMessage).toContain('Guard 6: ORCH_RUN_STALE');
    expect(r.stderr).toBe('');
  });

  it('[AC6] registers Guard 6 between Guard 5 and Guard 2 on four distinct write-family arrays', async () => {
    const text = readFileSync(HOOK, 'utf8').replace(/try \{ main\(\); \}.*$/s, 'export { DISPATCH };\n');
    const dir = mkdtempSync(join(tmpdir(), 'cc-guard6-dispatch-'));
    try {
      writeFileSync(join(dir, 'hook.mjs'), text);
      const { DISPATCH } = await import(pathToFileURL(join(dir, 'hook.mjs')).href);
      const names = (tool) => DISPATCH[tool].map((g) => g.name);
      for (const tool of ['Write', 'create_file', 'write_file']) {
        expect(names(tool)).toEqual(['guard5BandScope', 'guard6OrchestratorRun', 'guard2DuplicateWrite']);
      }
      expect(names('Edit')).toEqual(['guard5BandScope', 'guard6OrchestratorRun']);
      expect(new Set(['Write', 'Edit', 'create_file', 'write_file'].map((t) => DISPATCH[t])).size).toBe(4);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  // Discriminator: a Guard 6 that checks the role skip before R7 lets both role cases through.
  it.each([['Agent', 'code'], ['Agent', 'general-purpose'], ['SendMessage', 'code']])(
    '[R7] denies %s from agent %s while the run is live', (tool, agentType) => {
      liveRun();
      expect(dispatch(tool, { agentId: 'a3', agentType }).decision).toEqual({
        hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: nested(tool, agentType),
      });
    });

  // Silent, not warned: dispatch outside a live run is the shipped cooperative posture.
  it.each([
    ['the main-session shape during a live run', true, {}],
    ['an agent_id-only payload during a live run', true, { agentId: 'adcc0758336c23e70' }],
    ['a role with no run file', false, { agentId: 'a3', agentType: 'code' }],
    ['a role during a stale run', 'stale', { agentId: 'a3', agentType: 'code' }],
  ])('[R7] decides nothing for an Agent call from %s', (_, run, opts) => {
    if (run === true) liveRun();
    if (run === 'stale') liveRun({ session_id: 'sess-2' });
    const r = dispatch('Agent', opts);
    expect(r.decision).toBeNull();
    expect(r.warning).toBe('');
  });

  it('[AC3a] registers Guard 6 alone on Agent and SendMessage, as distinct arrays', async () => {
    const text = readFileSync(HOOK, 'utf8').replace(/try \{ main\(\); \}.*$/s, 'export { DISPATCH };\n');
    const dir = mkdtempSync(join(tmpdir(), 'cc-guard6-r7-'));
    try {
      writeFileSync(join(dir, 'hook.mjs'), text);
      const { DISPATCH } = await import(pathToFileURL(join(dir, 'hook.mjs')).href);
      for (const tool of ['Agent', 'SendMessage']) expect(DISPATCH[tool].map((g) => g.name)).toEqual(['guard6OrchestratorRun']);
      expect(new Set(['Agent', 'SendMessage', 'Write', 'Edit'].map((t) => DISPATCH[t])).size).toBe(4);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('[AC4] carries the write surface and run path equal to scripts/orchestrate.mjs', () => {
    const text = readFileSync(HOOK, 'utf8');
    const list = (name) => JSON.parse(text.match(new RegExp(`const ${name} = (\\[[^\\]]*\\]);`))[1].replace(/'/g, '"'));
    expect(list('ORCH_WRITE_SURFACE')).toEqual(WRITE_SURFACE);
    expect(list('ORCH_RUN_REL').join('/')).toBe(RUN_FILE);
  });
});
