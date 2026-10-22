// FEAT-046: the session-log reader behind /cc-metrics, driven over SYNTHETIC fixtures only.
// The fixtures copy the key names of Claude Code's log records, never any real transcript content,
// so a renamed field in a future log format breaks a named test here instead of the command.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createTotals, listLogFiles, parseLine, readLog, recommend, resolveLogDir, run, slugOf,
} from '../../scripts/session-metrics.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'session-metrics.mjs');
const FX = join(ROOT, 'tests', 'scripts', 'fixtures', 'session-metrics');
const CLEAN = join(FX, 'clean');

async function totalsOf(dir) {
  const totals = createTotals();
  for (const file of listLogFiles(dir)) await readLog(totals, file);
  return totals;
}

const tokensOf = (group) => Object.fromEntries(Object.entries(group).map(([k, v]) => [k, v.tokens]));
const sum = (group) => Object.values(group).reduce((s, v) => s + v.tokens, 0);
const spawnScript = (args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', cwd: tmpdir() });

let tmp;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'cc-metrics-')); });
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe('locating the logs [D3]', () => {
  it('prefers --dir, then CLAUDE_CONFIG_DIR, then ~/.claude, under a path slug', () => {
    expect(slugOf('C:\\a\\b-c.d')).toBe('C--a-b-c-d');
    expect(resolveLogDir({ dir: '/x', env: {}, root: '/r', home: '/h' })).toBe('/x');
    expect(resolveLogDir({ dir: undefined, env: { CLAUDE_CONFIG_DIR: '/cfg' }, root: 'C:\\p', home: '/h' }))
      .toBe(join('/cfg', 'projects', 'C--p'));
    expect(resolveLogDir({ dir: undefined, env: {}, root: '/p/q', home: '/h' })).toBe(join('/h', '.claude', 'projects', '-p-q'));
  });

  it('lists main and subagent transcripts and nothing else', () => {
    mkdirSync(join(tmp, 'sess', 'subagents'), { recursive: true });
    mkdirSync(join(tmp, 'sess', 'tool-results'), { recursive: true });
    for (const f of ['a.jsonl', 'notes.txt', 'sess/subagents/agent-1.jsonl', 'sess/subagents/agent-1.meta.json', 'sess/tool-results/x.jsonl']) {
      writeFileSync(join(tmp, f), '');
    }
    const files = listLogFiles(tmp).map((f) => relative(tmp, f).replace(/\\/g, '/'));
    expect(files).toEqual(['a.jsonl', 'sess/subagents/agent-1.jsonl']);
  });
});

describe('parsing and counting [D6, AC6]', () => {
  it('parseLine returns null for a cut line, a blank line and a non-object', () => {
    expect(parseLine('{"type":"assis')).toBeNull();
    expect(parseLine('   ')).toBeNull();
    expect(parseLine('["a"]')).toBeNull();
    expect(parseLine('{"type":"user"}')).toEqual({ type: 'user' });
  });

  it('counts usage repeated over three records with one requestId once', async () => {
    const t = await totalsOf(CLEAN);
    expect(t.requests).toBe(5);
    expect(t.tokens).toEqual({ input: 23, output: 185, cacheRead: 41500, cacheWrite: 1800 });
  });

  it('pins the usage field names: renaming cache_read_input_tokens drops it from the total', async () => {
    const text = readFileSync(join(CLEAN, 'sess-aaaa1111.jsonl'), 'utf8');
    writeFileSync(join(tmp, 's.jsonl'), text.split('cache_read_input_tokens').join('cache_read_tokens_v2'));
    const t = await totalsOf(tmp);
    expect(t.tokens.cacheRead).toBe(0);
    expect(t.tokens.input).toBe(22);
  });
});

describe('groupings [D4]', () => {
  it('tool: calls, text-only result estimate and wall seconds', async () => {
    const { tool } = (await totalsOf(CLEAN)).groups;
    expect(tool.Read).toMatchObject({ calls: 2, estTokens: 99, wallMs: 3000 });
    expect(tool.Bash).toMatchObject({ calls: 1, estTokens: 1, wallMs: 10000 });
    expect(tool.Skill.calls).toBe(1);
    expect(tool.Grep.calls).toBe(1);
  });

  it('command: a typed <command-name> and a Skill call open windows; a typed prompt closes them', async () => {
    const t = await totalsOf(CLEAN);
    expect(tokensOf(t.groups.command)).toEqual({ 'cc-spec': 10060, 'cc-implement': 21330, '(none)': 12118 });
  });

  it('phase: cc-spec is Define, cc-implement is Build, anything else is (none)', async () => {
    const t = await totalsOf(CLEAN);
    expect(tokensOf(t.groups.phase)).toEqual({ Define: 10060, Build: 21330, '(none)': 12118 });
  });

  it('branch and item: the item id comes from the branch name', async () => {
    const out = await run({ dir: CLEAN, root: FX, env: {} });
    expect(out).toMatch(/fix\/bug-999-fixture\s+32\.5k\s+BUG-999\s+P1/);
    expect(out).toMatch(/\n {2}main\s+11\.0k\n/);
  });

  it('pillar: from the backlog heading above the item, or a named omission without a backlog', async () => {
    const withBacklog = await run({ dir: CLEAN, root: FX, env: {} });
    expect(withBacklog).toContain('by pillar (tokens): P1 32.5k 75% | (unattributed) 11.0k 25%');
    const without = await run({ dir: CLEAN, root: tmp, env: {} });
    expect(without).toContain('pillar: no AGENT-READABLE BACKLOG.md');
  });

  it('session: a subagent transcript is its own row and every table sums to the total', async () => {
    const t = await totalsOf(CLEAN);
    expect(tokensOf(t.groups.session)).toEqual({ 'sess-aaa': 42402, 'sess-aaa/x1': 1106 });
    for (const g of ['command', 'phase', 'branch', 'session']) expect(sum(t.groups[g])).toBe(43508);
    expect(t.activeMs['sess-aaa']).toBe(120000);
    expect(t.compactions).toBe(1);
  });
});

describe('fail-open [AC2]', () => {
  it('a missing and an empty directory print the named note and exit 0', () => {
    const missing = spawnScript(['--dir', join(tmp, 'nope')]);
    expect(missing.status).toBe(0);
    expect(missing.stdout).toBe(`cc-metrics: no session logs at ${join(tmp, 'nope')}\n`);
    const empty = spawnScript(['--dir', tmp]);
    expect(empty.status).toBe(0);
    expect(empty.stdout).toContain('cc-metrics: no session logs at');
  });

  it('a partial last line, unknown types and missing fields are counted, never thrown', () => {
    const partial = spawnScript(['--dir', join(FX, 'partial')]);
    expect(partial.status).toBe(0);
    expect(partial.stderr).toBe('');
    expect(partial.stdout).toContain('1 requests, 1 unparsable lines, 0 not measured');
    const noisy = spawnScript(['--dir', join(FX, 'noisy')]);
    expect(noisy.status).toBe(0);
    expect(noisy.stderr).toBe('');
    expect(noisy.stdout).toContain('1 requests, 1 unparsable lines, 2 not measured');
  });
});

describe('recommendations [D5, AC5]', () => {
  it('each rule fires on the trip fixture and quotes its number', async () => {
    const recs = recommend(await totalsOf(join(FX, 'trip')));
    expect(recs).toEqual([
      expect.stringContaining('R1 hot.md Read 5x (~500 est tok)'),
      expect.stringContaining('R2 1 Read(s) without limit returned >2.0k est tok (largest ~2.3k in big.md)'),
      expect.stringContaining('R3 session sess-ddd peaked at 260.0k context with 0 compaction(s)'),
      expect.stringContaining('R4 cache hit 62.1% (cacheR 165.0k of 265.6k input tok)'),
    ]);
  });

  it('none fires on the clean fixture', async () => {
    expect(recommend(await totalsOf(CLEAN))).toEqual([]);
    expect(await run({ dir: CLEAN, root: FX, env: {} })).toContain('  - none fired');
  });
});

describe('read-only [AC1]', () => {
  it('uses no write API and leaves the log tree unchanged', () => {
    const src = readFileSync(SCRIPT, 'utf8');
    expect(src).not.toMatch(/\b(writeFile|appendFile|mkdir|rmSync|rmdir|unlink|rename|createWriteStream|copyFile|cpSync|truncate)/);
    const snapshot = (dir) => readdirSync(dir, { recursive: true }).sort()
      .map((f) => `${f}:${statSync(join(dir, String(f))).mtimeMs}`);
    const before = snapshot(FX);
    const r = spawnScript(['--dir', CLEAN]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('cc-metrics: 2 logs (1 subagent)');
    expect(snapshot(FX)).toEqual(before);
  });
});
