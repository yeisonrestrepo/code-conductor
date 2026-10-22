// scripts/session-metrics.mjs
// FEAT-046: offline token and time metrics over Claude Code's local session logs.
// Zero-dep, strictly read-only: it opens files for reading only and prints one report.
// Every failure degrades to a named note on stdout and exit 0, never a wrong number.
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const THRESHOLDS = { repeatReads: 5, unboundedReadTokens: 2000, contextPeak: 150000, cacheHitPct: 80 };
const TOP = 5;
const NONE = '(none)';
const PHASES = {
  'cc-spec': 'Define', 'cc-plan': 'Define',
  'cc-implement': 'Build', 'cc-refactor': 'Build', 'cc-debug': 'Build',
  'cc-review': 'Verify', 'cc-test': 'Verify',
};
const COMMAND_TAG = /<command-name>\/?([^<\s]+)<\/command-name>/;
const ITEM_IN_BRANCH = /(feat|bug|arch)[-_]?(\d{3})/i;

// Claude Code names a project's log directory after its path, with every non-alphanumeric as '-'.
export function slugOf(path) {
  return path.replace(/[^A-Za-z0-9]/g, '-');
}

export function resolveLogDir({ dir, env, root, home }) {
  if (dir) return dir;
  const base = env.CLAUDE_CONFIG_DIR || join(home, '.claude');
  return join(base, 'projects', slugOf(root));
}

export function listLogFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(join(dir, entry.name));
    if (!entry.isDirectory()) continue;
    const sub = join(dir, entry.name, 'subagents');
    if (!existsSync(sub)) continue;
    for (const name of readdirSync(sub)) if (name.endsWith('.jsonl')) files.push(join(sub, name));
  }
  return files.sort();
}

// A session still being written ends mid-line; that line is skipped, never guessed at.
export function parseLine(line) {
  if (!line.trim()) return null;
  try {
    const record = JSON.parse(line);
    return record && typeof record === 'object' && !Array.isArray(record) ? record : null;
  } catch {
    return null;
  }
}

export function createTotals() {
  return {
    files: 0, subagentFiles: 0, bytes: 0, requests: 0, unparsable: 0, notMeasured: 0, compactions: 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    groups: { tool: {}, command: {}, phase: {}, branch: {}, session: {} },
    seen: new Set(), pending: new Map(), command: NONE,
    reads: {}, unboundedReads: [], peaks: {}, sessionCompactions: {}, activeMs: {},
  };
}

function bump(group, key, field, amount) {
  group[key] ??= { tokens: 0, calls: 0, estTokens: 0, wallMs: 0 };
  group[key][field] += amount;
}

function blocksOf(record) {
  const content = record.message?.content;
  return Array.isArray(content) ? content : [];
}

function textOf(record) {
  const content = record.message?.content;
  if (typeof content === 'string') return content;
  return blocksOf(record).filter((b) => b.type === 'text').map((b) => b.text).join('');
}

function sessionKey(record) {
  const id = String(record.sessionId ?? '?').slice(0, 8);
  return record.agentId ? `${id}/${record.agentId}` : id;
}

// Image and document blocks are not text the model reads as tokens at chars/4; they are skipped.
export function estimateTokens(content) {
  if (typeof content === 'string') return Math.round(content.length / 4);
  if (!Array.isArray(content)) return 0;
  const chars = content.filter((b) => b.type === 'text').reduce((sum, b) => sum + String(b.text).length, 0);
  return Math.round(chars / 4);
}

export function addRecord(totals, record) {
  if (record.type === 'assistant') return addAssistant(totals, record);
  if (record.type === 'user') return addUser(totals, record);
  if (record.type === 'system') return addSystem(totals, record);
}

function addAssistant(totals, record) {
  for (const block of blocksOf(record)) if (block.type === 'tool_use') openTool(totals, record, block);
  const usage = record.message?.usage;
  if (!usage || !record.requestId) { totals.notMeasured++; return; }
  // One API response spans several records sharing a requestId, each repeating the same usage.
  if (totals.seen.has(record.requestId)) return;
  totals.seen.add(record.requestId);
  addUsage(totals, record, usage);
}

function openTool(totals, record, block) {
  totals.pending.set(block.id, { name: block.name, ts: Date.parse(record.timestamp), input: block.input ?? {} });
  if (block.name === 'Skill' && block.input?.skill) totals.command = String(block.input.skill);
}

function addUsage(totals, record, usage) {
  const n = (k) => Number(usage[k]) || 0;
  const input = n('input_tokens'), output = n('output_tokens');
  const cacheRead = n('cache_read_input_tokens'), cacheWrite = n('cache_creation_input_tokens');
  const all = input + output + cacheRead + cacheWrite;
  const t = totals.tokens;
  t.input += input; t.output += output; t.cacheRead += cacheRead; t.cacheWrite += cacheWrite;
  totals.requests++;
  const session = sessionKey(record);
  totals.peaks[session] = Math.max(totals.peaks[session] ?? 0, input + cacheRead + cacheWrite);
  const g = totals.groups;
  bump(g.command, totals.command, 'tokens', all);
  bump(g.phase, PHASES[totals.command] ?? NONE, 'tokens', all);
  bump(g.branch, record.gitBranch || NONE, 'tokens', all);
  bump(g.session, session, 'tokens', all);
}

function addUser(totals, record) {
  const command = textOf(record).match(COMMAND_TAG);
  if (command) totals.command = command[1];
  else if (record.promptSource === 'typed') totals.command = NONE;
  for (const block of blocksOf(record)) if (block.type === 'tool_result') closeTool(totals, record, block);
}

function closeTool(totals, record, block) {
  const call = totals.pending.get(block.tool_use_id);
  if (!call) return;
  totals.pending.delete(block.tool_use_id);
  const tool = totals.groups.tool;
  const est = estimateTokens(block.content);
  const ms = Date.parse(record.timestamp) - call.ts;
  bump(tool, call.name, 'calls', 1);
  bump(tool, call.name, 'estTokens', est);
  if (Number.isFinite(ms)) bump(tool, call.name, 'wallMs', ms);
  else totals.notMeasured++;
  if (call.name === 'Read') trackRead(totals, call.input, est);
}

function trackRead(totals, input, est) {
  const file = String(input.file_path ?? '?');
  totals.reads[file] ??= { count: 0, estTokens: 0 };
  totals.reads[file].count++;
  totals.reads[file].estTokens += est;
  if (!input.limit && est > THRESHOLDS.unboundedReadTokens) totals.unboundedReads.push({ file, est });
}

function addSystem(totals, record) {
  const session = sessionKey(record);
  if (record.subtype === 'compact_boundary') {
    totals.compactions++;
    totals.sessionCompactions[session] = (totals.sessionCompactions[session] ?? 0) + 1;
  }
  if (record.subtype === 'turn_duration' && Number.isFinite(record.durationMs)) {
    totals.activeMs[session] = (totals.activeMs[session] ?? 0) + record.durationMs;
  }
}

// A tool call cut off by the end of its transcript is still a call; only its time is unknown.
export function finishFile(totals) {
  for (const call of totals.pending.values()) {
    bump(totals.groups.tool, call.name, 'calls', 1);
    totals.notMeasured++;
  }
  totals.pending.clear();
  totals.command = NONE;
}

export async function readLog(totals, file) {
  totals.files++;
  totals.bytes += statSync(file).size;
  if (file.includes('subagents')) totals.subagentFiles++;
  const lines = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const line of lines) {
    const record = parseLine(line);
    if (record) addRecord(totals, record);
    else if (line.trim()) totals.unparsable++;
  }
  finishFile(totals);
}

export function itemOf(branch) {
  const m = String(branch).match(ITEM_IN_BRANCH);
  return m ? `${m[1].toUpperCase()}-${m[2]}` : null;
}

export function pillarMap(backlogText) {
  const map = {};
  let pillar = null;
  for (const line of backlogText.split(/\r?\n/)) {
    const heading = line.match(/^## PILLAR (\d+)/i);
    if (heading) pillar = `P${heading[1]}`;
    const item = line.match(/^### \[.\] `\[([A-Z]+-\d+)\]`/);
    if (item && pillar) map[item[1]] = pillar;
  }
  return map;
}

export function pillarTotals(branchGroup, pillars) {
  const out = {};
  for (const [branch, v] of Object.entries(branchGroup)) {
    const key = pillars[itemOf(branch)] ?? '(unattributed)';
    out[key] = (out[key] ?? 0) + v.tokens;
  }
  return out;
}

export function fmt(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(n);
}

export function cacheHitPct(tokens) {
  const input = tokens.input + tokens.cacheRead + tokens.cacheWrite;
  return input ? (100 * tokens.cacheRead) / input : null;
}

function repeatedReadLine(totals) {
  const hot = Object.entries(totals.reads).filter(([, r]) => r.count >= THRESHOLDS.repeatReads);
  if (!hot.length) return null;
  const [file, r] = hot.sort((a, b) => b[1].count - a[1].count)[0];
  const more = hot.length > 1 ? ` (+${hot.length - 1} more files)` : '';
  return `R1 ${basename(file)} Read ${r.count}x (~${fmt(r.estTokens)} est tok)${more}: grep before reading, or keep the fact in memory`;
}

function unboundedReadLine(totals) {
  const reads = totals.unboundedReads;
  if (!reads.length) return null;
  const top = [...reads].sort((a, b) => b.est - a.est)[0];
  return `R2 ${reads.length} Read(s) without limit returned >${fmt(THRESHOLDS.unboundedReadTokens)} est tok (largest ~${fmt(top.est)} in ${basename(top.file)}): pass offset/limit`;
}

function contextPeakLine(totals) {
  const high = Object.entries(totals.peaks).filter(([, p]) => p > THRESHOLDS.contextPeak);
  if (!high.length) return null;
  const [session, peak] = high.sort((a, b) => b[1] - a[1])[0];
  const compactions = totals.sessionCompactions[session] ?? 0;
  const more = high.length > 1 ? ` (+${high.length - 1} more sessions)` : '';
  return `R3 session ${session} peaked at ${fmt(peak)} context with ${compactions} compaction(s)${more}: run /cc-compact earlier`;
}

function cacheMissLine(totals) {
  const pct = cacheHitPct(totals.tokens);
  if (pct === null || pct >= THRESHOLDS.cacheHitPct) return null;
  const t = totals.tokens;
  return `R4 cache hit ${pct.toFixed(1)}% (cacheR ${fmt(t.cacheRead)} of ${fmt(t.input + t.cacheRead + t.cacheWrite)} input tok): keep the prompt prefix stable`;
}

export function recommend(totals) {
  return [repeatedReadLine, unboundedReadLine, contextPeakLine, cacheMissLine]
    .map((rule) => rule(totals))
    .filter(Boolean);
}

function topRows(group, field) {
  return Object.entries(group).sort((a, b) => b[1][field] - a[1][field]).slice(0, TOP);
}

function shareRow(entries, total) {
  return entries.map(([k, v]) => `${k} ${fmt(v)} ${total ? Math.round((100 * v) / total) : 0}%`).join(' | ');
}

function headerLines(totals) {
  const t = totals.tokens;
  const pct = cacheHitPct(t);
  return [
    `cc-metrics: ${totals.files} logs (${totals.subagentFiles} subagent), ${fmt(totals.bytes)}B, ${totals.requests} requests, ` +
      `${totals.unparsable} unparsable lines, ${totals.notMeasured} not measured, ${totals.compactions} compactions`,
    `tokens: in ${fmt(t.input)} out ${fmt(t.output)} cacheR ${fmt(t.cacheRead)} cacheW ${fmt(t.cacheWrite)} | ` +
      `cache hit ${pct === null ? 'n/a' : `${pct.toFixed(1)}%`}`,
  ];
}

function toolLines(totals) {
  const rows = topRows(totals.groups.tool, 'calls').map(([name, v]) =>
    `  ${name.padEnd(12)} ${String(v.calls).padStart(6)} ${fmt(v.estTokens).padStart(8)} ${String(Math.round(v.wallMs / 1000)).padStart(7)}`);
  return ['by tool (calls, est result tok, wall s):', ...rows];
}

function groupLine(label, group, total) {
  const entries = topRows(group, 'tokens').map(([k, v]) => [k, v.tokens]);
  return `by ${label} (tokens): ${shareRow(entries, total)}`;
}

function branchLines(totals, pillars) {
  const rows = topRows(totals.groups.branch, 'tokens').map(([branch, v]) => {
    const item = itemOf(branch);
    const tags = item ? `  ${item}  ${pillars?.[item] ?? ''}`.trimEnd() : '';
    return `  ${branch.slice(0, 34).padEnd(34)} ${fmt(v.tokens).padStart(8)}${tags}`;
  });
  return ['by branch (tokens):', ...rows];
}

function sessionLines(totals) {
  const rows = topRows(totals.groups.session, 'tokens').map(([s, v]) => {
    const ms = totals.activeMs[s];
    const active = ms === undefined ? '—' : String(Math.round(ms / 60000));
    return `  ${s.padEnd(20)} ${fmt(v.tokens).padStart(8)} ${active.padStart(6)}`;
  });
  return ['by session (tokens, active min):', ...rows];
}

function pillarLine(totals, pillars, total) {
  if (!pillars) return 'pillar: no AGENT-READABLE BACKLOG.md';
  const entries = Object.entries(pillarTotals(totals.groups.branch, pillars)).sort((a, b) => b[1] - a[1]);
  return `by pillar (tokens): ${shareRow(entries, total)}`;
}

export function formatReport(totals, pillars) {
  const total = Object.values(totals.groups.session).reduce((s, v) => s + v.tokens, 0);
  const recs = recommend(totals);
  const th = THRESHOLDS;
  return [
    ...headerLines(totals),
    ...toolLines(totals),
    groupLine('command', totals.groups.command, total),
    groupLine('phase', totals.groups.phase, total),
    ...branchLines(totals, pillars),
    pillarLine(totals, pillars, total),
    ...sessionLines(totals),
    'recommendations:',
    ...(recs.length ? recs.map((r) => `  - ${r}`) : ['  - none fired']),
    `thresholds: R1>=${th.repeatReads} reads, R2>${fmt(th.unboundedReadTokens)} tok, R3>${fmt(th.contextPeak)} ctx, R4<${th.cacheHitPct}% cache`,
  ].join('\n');
}

function readPillars(root) {
  const file = join(root, 'AGENT-READABLE BACKLOG.md');
  return existsSync(file) ? pillarMap(readFileSync(file, 'utf8')) : null;
}

export async function run({ dir, root, env = process.env, home = homedir() }) {
  const logDir = resolveLogDir({ dir, env, root, home });
  if (!existsSync(logDir)) return `cc-metrics: no session logs at ${logDir}`;
  const files = listLogFiles(logDir);
  if (!files.length) return `cc-metrics: no session logs at ${logDir}`;
  const totals = createTotals();
  for (const file of files) await readLog(totals, file);
  return formatReport(totals, readPillars(root));
}

function projectRoot() {
  try {
    const top = execFileSync('git', ['rev-parse', '--show-toplevel'],
      { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (top) return top;
  } catch { /* not a git checkout: fall back to cwd */ }
  return process.cwd();
}

export function parseArgs(argv) {
  const i = argv.indexOf('--dir');
  return { dir: i >= 0 ? argv[i + 1] : undefined };
}

async function main() {
  try {
    const { dir } = parseArgs(process.argv.slice(2));
    process.stdout.write(`${await run({ dir, root: projectRoot() })}\n`);
  } catch (e) {
    process.stdout.write(`cc-metrics: failed: ${(e && e.message) || e}\n`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
