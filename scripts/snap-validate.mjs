import { readFileSync } from 'node:fs';
const err = (m) => { process.stderr.write(`SNAP_ERROR: ${m}\n`); process.exit(1); };
const path = process.argv[2]; if (path === undefined) err('no path provided');
let raw; try { raw = readFileSync(path, 'utf8'); } catch (e) { err(e.code === 'ENOENT' ? 'file not found' : e.code); }
if (raw.includes('�')) err('encoding error');
const trimmed = raw.trim(); if (trimmed.includes('\n')) err('internal newline in payload');
if (trimmed === '') err('empty file'); if (raw.length > 4096) err('payload too large');
let snap; try { snap = JSON.parse(trimmed); } catch { err('malformed JSON'); }
if (typeof snap !== 'object' || snap === null || Array.isArray(snap)) err('root must be a plain object');
for (const b of ['sys', 'ops', 'mem']) if (typeof snap[b] !== 'object' || snap[b] === null || Array.isArray(snap[b])) err(`missing block: ${b}`);
const req = { v: snap.v, 'sys.ph': snap.sys.ph, 'sys.c': snap.sys.c, 'sys.s': snap.sys.s, 'ops.n': snap.ops.n, 'ops.f': snap.ops.f, 'mem.d': snap.mem.d, 'mem.x': snap.mem.x };
const missing = Object.entries(req).filter(([, v]) => v === undefined).map(([k]) => k);
if (missing.length) { for (const k of missing) process.stderr.write(`SNAP_ERROR: missing: ${k}\n`); process.exit(1); }
const topExtra = Object.keys(snap).find(k => !['v', 'sys', 'ops', 'mem'].includes(k)); if (topExtra) err(`unexpected key: ${topExtra}`);
const allow = { sys: ['ph', 'c', 's'], ops: ['n', 'f'], mem: ['d', 'x'] };
for (const b of ['sys', 'ops', 'mem']) { const extra = Object.keys(snap[b]).find(k => !allow[b].includes(k)); if (extra) err(`unexpected key: ${b}.${extra}`); }
if (typeof snap.v !== 'number' || !Number.isInteger(snap.v) || snap.v < 1) err('v must be a positive integer'); if (snap.v > 1) err('SNAP_UNKNOWN_VERSION');
if (!['spec', 'plan', 'impl', 'rev'].includes(snap.sys.ph)) err('ph must be spec|plan|impl|rev');
const caps = { 'ops.n': [3, 200], 'ops.f': [20, 300], 'mem.d': [10, 300], 'mem.x': [5, 200] };
for (const [key, [cap, elemCap]] of Object.entries(caps)) {
  const [blk, sub] = key.split('.'); const arr = snap[blk][sub]; if (!Array.isArray(arr)) err(`${key} must be an array`); if (arr.length > cap) err(`${key} exceeds cap`);
  arr.forEach((el, i) => { if (typeof el !== 'string' || el.trim() === '') err(`empty element in ${key}[${i}]`); if (JSON.stringify(el).slice(1, -1).length > elemCap) err(`element too long in ${key}[${i}]`); });
}
snap.ops.f.forEach((el, i) => {
  if (el.includes('\\')) err(`backslash in ops.f[${i}]`);
  const idx = el.lastIndexOf(':'); if (idx <= 0) err(`empty path in ops.f[${i}]`);
  if (!['C', 'M', 'D'].includes(el.slice(idx + 1))) err(`invalid action code in ops.f[${i}]`);
});
if (!/^[0-9a-f]{7}$/.test(snap.sys.c)) err('invalid sys.c format'); if (!/^[a-zA-Z0-9._-]+$/.test(snap.sys.s)) err('invalid chars in sys.s');
process.exit(0);
