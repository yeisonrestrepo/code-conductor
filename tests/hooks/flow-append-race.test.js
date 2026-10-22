import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// FEAT-044 T-001-A: the measurements M7 and M9 from #83, kept as assertions so every
// platform that runs the suite re-proves them (spec AC11). They exercise the file-system
// primitives the emitter rests on, not the emitter itself: parallel O_APPEND writes must
// never tear a line, and a rotation under a 'wx' lock must never fail an append or leave
// a lock or temporary file behind (M8 is why the lock exists).
//
// A rotation's rename MAY fail here: measured on Windows 11, 2026-10-22, renaming over a
// file that another process holds open for append raises EPERM. The emitter swallows that
// and the next call retries, so the asserted invariants are the ones a reader depends on:
// every append succeeds and lands whole, the file still shrinks, and nothing is stranded.
// A line appended between a rotation's read and its rename is dropped with the old file;
// for a convenience log bounded at 250 lines that is accepted.
//
// The worker is CommonJS through `node -e` so the probe needs no fixture file. Its
// rotation is the D7 algorithm: wx lock, 10 s stale cutoff, last 250 parseable lines to a
// temporary file, rename over the original.
const WORKER = `
const fs = require('node:fs');
const [file, worker, n, bytes, rotateAt] = process.argv.slice(1);
const lock = file.replace(/\\.jsonl$/, '.lock');
const tmp = file + '.tmp';
let appendErrors = 0; let rotateErrors = 0;
function line(seq) {
  const ev = { ts: Date.now(), tool: 'Bash', verdict: 'deny', guard: 3, code: 'P5 P9', target: '', agent: null, passed: [7], w: +worker, s: seq };
  ev.target = 'x'.repeat(Math.max(0, +bytes - JSON.stringify(ev).length - 1));
  return JSON.stringify(ev) + '\\n';
}
function takeLock() {
  try { return fs.openSync(lock, 'wx'); } catch {}
  try {
    if (Date.now() - fs.statSync(lock).mtimeMs < 10000) return null;
    fs.unlinkSync(lock);
    return fs.openSync(lock, 'wx');
  } catch { return null; }
}
const parses = (l) => { try { JSON.parse(l); return true; } catch { return false; } };
function rotate() {
  const fd = takeLock();
  if (fd === null) return;
  try {
    const keep = fs.readFileSync(file, 'utf8').split('\\n').filter((l) => l && parses(l)).slice(-250);
    fs.writeFileSync(tmp, keep.join('\\n') + '\\n');
    fs.renameSync(tmp, file);
  } catch { rotateErrors++; try { fs.unlinkSync(tmp); } catch {} }
  finally { fs.closeSync(fd); try { fs.unlinkSync(lock); } catch {} }
}
for (let i = 0; i < +n; i++) {
  try { if (+rotateAt && (fs.statSync(file, { throwIfNoEntry: false })?.size || 0) > +rotateAt) rotate(); } catch { rotateErrors++; }
  try { fs.appendFileSync(file, line(i)); } catch { appendErrors++; }
}
process.stdout.write(JSON.stringify({ appendErrors, rotateErrors }));
`;

function spawnWorker(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', WORKER, ...args.map(String)]);
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.on('error', reject);
    child.on('close', () => resolve(JSON.parse(out || '{"appendErrors":-1}')));
  });
}

async function race(dir, { procs, appends, bytes, rotateAt }) {
  const file = join(dir, '.flow-events.jsonl');
  const runs = Array.from({ length: procs }, (_, w) => spawnWorker([file, w, appends, bytes, rotateAt]));
  const results = await Promise.all(runs);
  const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
  const torn = lines.filter((l) => { try { JSON.parse(l); return false; } catch { return true; } }).length;
  return { lines: lines.length, torn, appendErrors: results.reduce((a, r) => a + r.appendErrors, 0) };
}

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cc-flow-race-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('flow event file under parallel writers [FEAT-044 AC11]', () => {
  it('M7: 16 processes x 500 appends of a capped line tear no line and lose none', async () => {
    const r = await race(dir, { procs: 16, appends: 500, bytes: 258, rotateAt: 0 });
    expect(r).toEqual({ lines: 8000, torn: 0, appendErrors: 0 });
  }, 120000);

  it('M7: 64 KiB lines appended in parallel tear no line', async () => {
    const r = await race(dir, { procs: 4, appends: 50, bytes: 65536, rotateAt: 0 });
    expect(r).toEqual({ lines: 200, torn: 0, appendErrors: 0 });
  }, 120000);

  it('M9: locked rotation under 16 parallel writers fails no append, tears no line, leaves no file behind', async () => {
    const r = await race(dir, { procs: 16, appends: 500, bytes: 258, rotateAt: 16384 });
    expect(r.torn).toBe(0);
    expect(r.appendErrors).toBe(0);
    expect(r.lines).toBeLessThan(8000);
    expect(readdirSync(dir)).toEqual(['.flow-events.jsonl']);
  }, 120000);
});
