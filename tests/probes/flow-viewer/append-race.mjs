// Probe for spec risk R1 and decision D7: parallel appends of flowEvent lines, with and
// without the spec's unlocked tmp-and-rename rotation. Not a vitest suite: it measures, it does not assert.
// Usage: node tests/probes/flow-viewer/append-race.mjs
import { appendFileSync, statSync, readFileSync, writeFileSync, renameSync, mkdtempSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
// [processes, appends per process, line bytes, rotate-at bytes (0 = never)]
const CONFIGS = [
  [8, 200, 258, 0], [16, 500, 258, 0], [8, 200, 4096, 0], [8, 200, 65536, 0],
  [8, 200, 258, 163840], [16, 500, 258, 163840], [16, 500, 258, 16384],
];

function makeLine(worker, seq, bytes) {
  const ev = { ts: Date.now(), tool: 'Bash', verdict: 'deny', guard: 3, code: 'P5 P9', target: '', passed: [7], w: worker, s: seq };
  const bare = 'flowEvent(' + JSON.stringify(ev) + ');\n';
  ev.target = 'x'.repeat(Math.max(0, bytes - bare.length));
  return 'flowEvent(' + JSON.stringify(ev) + ');\n';
}

// The rotation exactly as D7 specifies it: no lock, last 250 lines to a temp file, rename over.
function rotateUnlocked(path) {
  const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, lines.slice(-250).join('\n') + '\n');
  renameSync(tmp, path);
}

function runWorker([, , , file, worker, n, bytes, rot]) {
  let renameErrors = 0, otherErrors = 0;
  for (let i = 0; i < Number(n); i++) {
    try {
      if (Number(rot) && statSync(file, { throwIfNoEntry: false })?.size > Number(rot)) rotateUnlocked(file);
    } catch (e) { if (/EPERM|EBUSY|EACCES/.test(e.code)) renameErrors++; else otherErrors++; }
    try { appendFileSync(file, makeLine(worker, i, Number(bytes))); } catch { otherErrors++; }
  }
  process.stdout.write(JSON.stringify({ renameErrors, otherErrors }));
}

function spawnWorker(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SELF, 'worker', ...args]);
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.on('close', () => resolve(JSON.parse(out || '{}')));
  });
}

function countTorn(lines) {
  let torn = 0;
  for (const l of lines) {
    try { if (!l.startsWith('flowEvent(') || !l.endsWith(');')) throw new Error(); JSON.parse(l.slice(10, -2)); }
    catch { torn++; }
  }
  return torn;
}

async function runConfig([procs, n, bytes, rot]) {
  const dir = mkdtempSync(join(tmpdir(), 'flow-race-'));
  const file = join(dir, 'flow-events.js');
  const t0 = performance.now();
  const results = await Promise.all(Array.from({ length: procs }, (_, w) => spawnWorker([file, w, n, bytes, rot].map(String))));
  const ms = Math.round(performance.now() - t0);
  const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
  const sum = (k) => results.reduce((a, r) => a + (r[k] || 0), 0);
  rmSync(dir, { recursive: true, force: true });
  return { procs, appends: n, lineBytes: bytes, rotateAt: rot, expected: procs * n, linesInFile: lines.length,
    torn: countTorn(lines), renameErrors: sum('renameErrors'), otherErrors: sum('otherErrors'), ms };
}

if (process.argv[2] === 'worker') runWorker(process.argv);
else for (const cfg of CONFIGS) console.log(JSON.stringify(await runConfig(cfg)));
