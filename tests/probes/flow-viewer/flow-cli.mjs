// Prototype of an opt-in terminal view of .claude/flow-events.js. Prints nothing unless asked:
//   node flow-cli.mjs [dir]           lanes + last 10 events (what a /cc-flow command would print)
//   node flow-cli.mjs --line [dir]    one line, for an opt-in Claude Code statusLine
//   node flow-cli.mjs --watch [dir]   redraws every 1.5 s, for a second terminal pane
// Honors NO_COLOR. Reads the statusLine stdin payload for the project dir when one is piped.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const LANES = [
  ['Read', ['Read'], [4, 1]],
  ['Write', ['Write', 'create_file', 'write_file'], [5, 6, 2]],
  ['Edit', ['Edit'], [5, 6]],
  ['Bash', ['Bash'], [7, 3]],
  ['Agent', ['Agent', 'SendMessage'], [6]],
];
const GUARD_NAMES = { 1: 'Large read', 2: 'Duplicate write', 3: 'Bash scan', 4: 'Blocked read', 5: 'Band scope', 6: 'Orchestrator run', 7: 'Role shell' };
const plain = 'NO_COLOR' in process.env;
const paint = (code) => (s) => (plain ? s : `\x1b[${code}m${s}\x1b[0m`);
const green = paint(32), red = paint(31), amber = paint(33), dim = paint(2), bold = paint(1);
const MARK = { allow: green('✓'), deny: red('✕'), ask: amber('?') };

function projectDir(args) {
  const dir = args.find((a) => !a.startsWith('--'));
  if (dir) return dir;
  if (process.stdin.isTTY) return process.cwd();
  try { const p = JSON.parse(readFileSync(0, 'utf8')); return p.workspace?.current_dir || p.cwd || process.cwd(); }
  catch { return process.cwd(); }
}

// Same transport as the browser viewer: each line is flowEvent(<json>);. Bad lines are skipped, not fatal.
function loadEvents(dir) {
  const path = join(dir, '.claude', 'flow-events.js');
  if (!existsSync(path)) return { events: [], bad: 0, missing: true };
  const events = [];
  let bad = 0;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line) continue;
    try { events.push(JSON.parse(line.slice(10, -2))); } catch { bad++; }
  }
  return { events, bad, missing: false };
}

function chain(e) {
  const steps = (e.passed || []).map((g) => `G${g}${MARK.allow}`);
  if (e.guard) steps.push(`G${e.guard}${MARK[e.verdict]}`);
  return steps.join(dim(' → ')) || dim('no guards');
}

function statusLine({ events, missing }) {
  if (missing || !events.length) return dim('flow: no events');
  const n = (v) => events.filter((e) => e.verdict === v).length;
  const last = events[events.length - 1];
  const lastText = last.guard ? `G${last.guard} ${last.code || ''} ${last.target}`.replace(/\s+/g, ' ').trim() : `${last.tool} ${last.target}`;
  return `flow ${MARK.allow}${n('allow')} ${MARK.deny}${n('deny')} ${MARK.ask}${n('ask')} ${dim('·')} last ${MARK[last.verdict]} ${lastText.slice(0, 40)}`;
}

function guardCell(laneEvents, g) {
  const reached = laneEvents.filter((e) => e.guard === g || (e.passed || []).includes(g));
  const deny = reached.filter((e) => e.guard === g && e.verdict === 'deny').length;
  const ask = reached.filter((e) => e.guard === g && e.verdict === 'ask').length;
  const counts = `${green('✓' + (reached.length - deny - ask))} ${deny ? red('✕' + deny) : dim('✕0')} ${ask ? amber('?' + ask) : dim('?0')}`;
  return `${bold('G' + g)} ${GUARD_NAMES[g].padEnd(16)} ${counts}`;
}

function fullView({ events, bad, missing }) {
  if (missing) return dim('No flow events yet. They appear in .claude/flow-events.js after the first routed tool call.');
  const out = [`${bold('code-conductor flow')}  ${dim(`${events.length} events${bad ? `, ${bad} unreadable line(s) skipped` : ''}`)}`, ''];
  for (const [name, tools, guards] of LANES) {
    const mine = events.filter((e) => tools.includes(e.tool));
    out.push(`${bold(name.padEnd(6))} ${dim(String(mine.length).padStart(3) + (mine.length === 1 ? ' call ' : ' calls'))}  ${guards.map((g) => guardCell(mine, g)).join(dim('  │  '))}`);
  }
  out.push('', dim('Last 10'));
  for (const e of events.slice(-10).reverse()) {
    const t = new Date(e.ts).toLocaleTimeString([], { hour12: false });
    out.push(`  ${dim(t)}  ${e.tool.padEnd(6)} ${MARK[e.verdict]} ${String(e.target).slice(0, 36).padEnd(36)} ${chain(e)}${e.code ? ' ' + red(e.code) : ''}`);
  }
  return out.join('\n');
}

const args = process.argv.slice(2);
const dir = projectDir(args);
if (args.includes('--line')) console.log(statusLine(loadEvents(dir)));
else if (args.includes('--watch')) setInterval(() => process.stdout.write('\x1b[2J\x1b[H' + fullView(loadEvents(dir)) + '\n'), 1500);
else console.log(fullView(loadEvents(dir)));
