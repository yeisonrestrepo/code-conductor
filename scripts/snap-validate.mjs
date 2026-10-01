import { readFileSync } from 'node:fs'; import { BLOCK_FIELDS, CAPS, GATES, MAX_VERSION, POST_PARSE_MAX, PRE_PARSE_MAX_BYTES, ROLES, TOOL_KINDS, TOP_FIELDS, V3_CAPS, expectedGate } from './snap-contract.mjs';
const err = (m) => { process.stderr.write(`SNAP_ERROR: ${m}\n`); process.exit(1); };
const [path, flag, to] = process.argv.slice(2); if (path === undefined) err('no path provided');
if (flag !== undefined && (flag !== '--to' || !ROLES.includes(to))) err(`usage: snap-validate.mjs <file> [--to ${ROLES.join('|')}]`);
let raw; try { raw = readFileSync(path, 'utf8'); } catch (e) { err(e.code === 'ENOENT' ? 'file not found' : e.code); }
if (raw.includes('�')) err('encoding error');
const trimmed = raw.trim(); if (trimmed.includes('\n')) err('internal newline in payload');
if (trimmed === '') err('empty file');
if (raw.length > PRE_PARSE_MAX_BYTES) err(`payload too large: ${raw.length} > ${PRE_PARSE_MAX_BYTES} (pre-parse ceiling)`);
let snap; try { snap = JSON.parse(trimmed); } catch { err('malformed JSON'); }
if (typeof snap !== 'object' || snap === null || Array.isArray(snap)) err('root must be a plain object');
// D2: v is decided before every check whose meaning depends on it (BUG-038's check-order class, second sighting).
if (snap.v === undefined) err('missing: v'); if (typeof snap.v !== 'number' || !Number.isInteger(snap.v) || snap.v < 1) err('v must be a positive integer');
if (snap.v > MAX_VERSION) err('SNAP_UNKNOWN_VERSION');
for (const b of ['sys', 'ops', 'mem']) if (typeof snap[b] !== 'object' || snap[b] === null || Array.isArray(snap[b])) err(`missing block: ${b}`);
const band = snap.v >= 3; const at = (k) => snap[k.split('.')[0]][k.split('.')[1]];
const missing = ['sys.ph', 'sys.c', 'sys.s', 'ops.n', 'ops.f', 'mem.d', 'mem.x', ...(band ? ['sys.role', 'sys.tk', 'ops.gate'] : [])].filter(k => at(k) === undefined);
if (missing.length) { for (const k of missing) process.stderr.write(`SNAP_ERROR: missing: ${k}\n`); process.exit(1); }
const topExtra = Object.keys(snap).find(k => !TOP_FIELDS[snap.v].includes(k)); if (topExtra) err(`unexpected key: ${topExtra}`);
if (snap.pr !== undefined && typeof snap.pr !== 'string') err('pr must be a string');
for (const b of ['sys', 'ops', 'mem']) { const extra = Object.keys(snap[b]).find(k => !BLOCK_FIELDS[snap.v][b].includes(k)); if (extra) err(`unexpected key: ${b}.${extra}`); }
if (raw.length > POST_PARSE_MAX[snap.v]) err(`payload too large: ${raw.length} > ${POST_PARSE_MAX[snap.v]} (v${snap.v} cap)`);
if (!['spec', 'plan', 'impl', 'rev'].includes(snap.sys.ph)) err('ph must be spec|plan|impl|rev');
if (band && !ROLES.includes(snap.sys.role)) err(`role must be ${ROLES.join('|')}`); if (band && !TOOL_KINDS.includes(snap.sys.tk)) err(`tk must be ${TOOL_KINDS.join('|')}`);
if (band && !GATES.includes(snap.ops.gate)) err(`gate must be ${GATES.join('|')}`); if (band && snap.sys.tk === 'RW' && snap.ops.scope === undefined) err('missing: ops.scope (required when tk is RW)');
const p = snap.mem.p; if (p !== undefined && (typeof p !== 'object' || p === null || Array.isArray(p))) err('p must be a plain object');
const arrayCaps = { ...CAPS, ...(snap.ops.scope === undefined ? {} : V3_CAPS) };
for (const [key, [cap, elemCap]] of Object.entries(arrayCaps)) {
  const [blk, sub] = key.split('.'); const arr = snap[blk][sub]; if (!Array.isArray(arr)) err(`${key} must be an array`); if (arr.length > cap) err(`${key} exceeds cap`);
  arr.forEach((el, i) => { if (typeof el !== 'string' || el.trim() === '') err(`empty element in ${key}[${i}]`); if (JSON.stringify(el).slice(1, -1).length > elemCap) err(`element too long in ${key}[${i}]`); });
}
snap.ops.f.forEach((el, i) => {
  if (el.includes('\\')) err(`backslash in ops.f[${i}]`);
  const idx = el.lastIndexOf(':'); if (idx <= 0) err(`empty path in ops.f[${i}]`);
  if (!['C', 'M', 'D'].includes(el.slice(idx + 1))) err(`invalid action code in ops.f[${i}]`);
});
if (!/^[0-9a-f]{7,64}$/.test(snap.sys.c)) err('invalid sys.c format'); if (!/^[a-zA-Z0-9._-]+$/.test(snap.sys.s)) err('invalid chars in sys.s');
if (to !== undefined && !band) err('--to requires a v3 envelope'); if (to !== undefined && snap.ops.gate !== expectedGate(to)) err(`SNAP_GATE_MISMATCH: ${to} expects ${expectedGate(to)}, got ${snap.ops.gate}`);
process.exit(0);
