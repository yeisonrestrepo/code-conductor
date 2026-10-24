#!/usr/bin/env node
// Flow status line (FEAT-044). Claude Code runs this as its statusLine command and shows
// what it prints; /cc-flow runs it with --detail. It reads only the tail of the event file
// the PreToolUse hook appends to, and every path exits 0: a failing status line must never
// put a stack trace under the prompt. Event fields are printed as data, never evaluated.
// Zero dependencies by design; node: builtins only.
import { closeSync, fstatSync, openSync, readFileSync, readSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TAIL_BYTES = 32 * 1024;
const EVENTS_REL = ['.claude', '.flow-events.jsonl'];
const NEWEST = 20;

// One lane per tool family, guards in the hook's dispatch order (spec D3). The hook's
// GUARD_NUMBER table is the other half; tests/installer/flow-status.test.js fails on drift.
export const LANES = [
  { name: 'Read', tools: ['Read'], guards: [4, 1] },
  { name: 'Write', tools: ['Write', 'create_file', 'write_file'], guards: [5, 6, 2] },
  { name: 'Edit', tools: ['Edit'], guards: [5, 6] },
  { name: 'Bash', tools: ['Bash'], guards: [7, 3] },
  { name: 'Agent', tools: ['Agent', 'SendMessage'], guards: [6] },
];

// Null when there is no event file yet. A read that starts mid-file starts mid-line, so
// that first fragment is dropped rather than reported as a broken event.
export function readTail(path) {
  let fd;
  try { fd = openSync(path, 'r'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  try {
    const stat = fstatSync(fd);
    // Windows opens a directory for reading and reports size 0, which would pass for "empty".
    if (!stat.isFile()) throw new Error(`${path} is not a file`);
    const size = stat.size;
    const length = Math.min(size, TAIL_BYTES);
    const buf = Buffer.alloc(length);
    readSync(fd, buf, 0, length, size - length);
    const text = buf.toString('utf8');
    return size > length ? text.slice(text.indexOf('\n') + 1) : text;
  } finally { closeSync(fd); }
}

const isEvent = (ev) => ev !== null && typeof ev === 'object' && typeof ev.verdict === 'string';

// Unparseable lines are skipped; only a broken LAST line is reported, because that is the
// one the next append repairs (spec D7) and the one the status line would otherwise hide.
export function parseEvents(text) {
  const events = [];
  let lastBroken = false;
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    let ev;
    try { ev = JSON.parse(line); } catch { ev = null; }
    lastBroken = !isEvent(ev);
    if (!lastBroken) events.push(ev);
  }
  return { events, lastBroken };
}

// Control characters would break the one-line display; replace them, never interpret them.
const clean = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ');
const decidedBy = (ev) => `G${clean(ev.guard)}${ev.code ? ` ${clean(ev.code)}` : ''}`;

// The spec D2 state table, one line.
export function statusLine(events, lastBroken) {
  if (lastBroken) return 'flow: unreadable, retrying';
  if (events.length === 0) return '';
  const count = (verdict) => events.filter((e) => e.verdict === verdict).length;
  const calls = `${events.length} calls`;
  const last = events.at(-1);
  if (last.verdict === 'deny') return `⛔ ${decidedBy(last)} · ${calls} · ${count('deny')} deny`;
  if (last.verdict === 'ask') return `? ${decidedBy(last)} · ${calls} · ${count('ask')} ask`;
  return `✓ ${calls} · ${count('deny')} deny`;
}

// The status line counts the current session only. Events carry no session id, so the
// session's start is taken from the elapsed wall-clock time Claude Code passes on stdin;
// without it (no stdin, or an older release) every event in the tail counts.
export function sessionStart(session, now = Date.now()) {
  const ms = session?.cost?.total_duration_ms;
  return typeof ms === 'number' && ms >= 0 ? now - ms : 0;
}

function laneRow(lane, events) {
  const mine = events.filter((e) => lane.tools.includes(e.tool));
  const cells = lane.guards.map((g) => {
    const pass = mine.filter((e) => Array.isArray(e.passed) && e.passed.includes(g)).length;
    const deny = mine.filter((e) => e.guard === g && e.verdict === 'deny').length;
    const ask = mine.filter((e) => e.guard === g && e.verdict === 'ask').length;
    return `G${g} ${pass} pass ${deny} deny${ask ? ` ${ask} ask` : ''}`;
  });
  return `${lane.name.padEnd(6)} ${String(mine.length).padStart(4)} calls  ${cells.join(' · ')}`;
}

function eventRow(ev) {
  const time = Number.isFinite(ev.ts) ? new Date(ev.ts).toTimeString().slice(0, 8) : '--:--:--';
  const decided = ev.guard == null ? '' : ` ${decidedBy(ev)}`;
  const agent = ev.agent ? ` [${clean(ev.agent)}]` : '';
  // JSON.stringify escapes a quote or a newline in the target, so one event stays one row.
  return `${time}  ${clean(ev.tool).padEnd(6)} ${clean(ev.verdict)}${decided}  ${JSON.stringify(String(ev.target ?? ''))}${agent}`;
}

// The /cc-flow report: every lane, then the newest events, oldest first.
export function detailReport(events) {
  const newest = events.slice(-NEWEST).map(eventRow);
  return [
    'Flow lanes (guards in dispatch order):',
    ...LANES.map((lane) => laneRow(lane, events)),
    '',
    newest.length ? `Newest ${newest.length} events:` : 'no events yet',
    ...newest,
  ].join('\n');
}

function readSession() {
  if (process.stdin.isTTY) return {};
  try {
    const raw = readFileSync(0, 'utf8');
    return raw.trim() ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function workingDir(session) {
  const dir = session?.workspace?.current_dir ?? session?.cwd;
  return typeof dir === 'string' && dir ? dir : process.cwd();
}

// --detail never reads stdin: run from a shell tool, stdin may be a pipe nobody closes.
export function render(argv, env = process.env) {
  const detail = argv.includes('--detail');
  // Exactly '1', as the README documents and the hook checks: CC_FLOW_OFF=0 leaves it on.
  if (env.CC_FLOW_OFF === '1') return detail ? 'flow log is off (CC_FLOW_OFF=1)' : '';
  const session = detail ? {} : readSession();
  const text = readTail(join(workingDir(session), ...EVENTS_REL));
  const { events, lastBroken } = parseEvents(text ?? '');
  if (detail) return detailReport(events);
  const start = sessionStart(session);
  return statusLine(events.filter((e) => !(e.ts < start)), lastBroken);
}

const invoked = process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (invoked) {
  try { process.stdout.write(`${render(process.argv.slice(2))}\n`); } catch { /* print nothing, never a trace */ }
  process.exitCode = 0;
}
