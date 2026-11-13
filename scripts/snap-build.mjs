import { readFileSync } from 'node:fs';
import { CAPS, PRE_PARSE_MAX_BYTES as MAX_SNAP_BYTES, V1_MAX_CHARS, V3_CAPS, ROLES_BY_VERSION, elementLength } from './snap-contract.mjs';

const die = (msg) => { process.stderr.write(`SNAP_BUILD_ERROR: ${msg}\n`); process.exit(1); };
const byteLen = (s) => Buffer.byteLength(s, 'utf8');

// Async write, then exit 0 once the OS has drained it. A synchronous write to a
// non-blocking stdout pipe throws EAGAIN on large payloads, and process.exit right
// after an async write truncates the un-flushed tail; the drain callback avoids both.
function writeOut(s) { process.stdout.write(s + '\n', () => process.exit(0)); }

// Issue #132: cut to the validator's measure, one code point at a time, so the cut never
// splits a surrogate pair or an escape. JSON escapes each code point on its own, so the
// per-code-point sum equals elementLength of the prefix and the result always validates.
function truncateToCap(str, elemCap) {
  if (elementLength(str) <= elemCap) return str;
  let used = 0; let end = 0;
  for (const ch of str) {
    used += elementLength(ch);
    if (used > elemCap) break;
    end += ch.length;
  }
  return str.slice(0, end);
}

// Issue #136: an ops.f entry is `<path>:<C|M|D>` and the validator requires that suffix, so an
// over-cap entry loses path, never its action code. Without a code there is nothing valid to keep.
function truncateFileEntry(entry, elemCap, index) {
  const size = elementLength(entry);
  if (size <= elemCap) return entry;
  const code = entry.slice(-2);
  if (!/^:[CMD]$/.test(code)) die(`SNAP_FILE_NO_ACTION: ops.f[${index}] is ${size} characters, over the cap of ${elemCap}, and has no :C, :M or :D suffix to keep`);
  return truncateToCap(entry.slice(0, -2), elemCap - code.length) + code;
}

// filter empties, dedup (first wins), Unicode-safe per-element truncation, head-drop to count cap
function normArray(raw, [cap, elemCap], truncate = truncateToCap) {
  const arr = Array.isArray(raw) ? raw : [];
  const seen = new Set(); const out = [];
  for (const [index, item] of arr.entries()) {
    if (typeof item !== 'string') continue;
    const t = item.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(truncate(t, elemCap, index));
  }
  while (out.length > cap) out.shift();
  return out;
}

// D9 (issue #119): a scope is a Guard 5 envelope, so it is refused at its caps, never truncated.
// Blanks and duplicates still drop: they narrow nothing.
function scopeArray(raw) {
  const [cap, elemCap] = V3_CAPS['ops.scope'];
  const charLen = (el) => elementLength(el.trim());
  const long = raw.findIndex((el) => typeof el === 'string' && charLen(el) > elemCap);
  if (long >= 0) die(`SNAP_SCOPE_OVER_CAP: ops.scope[${long}] is ${charLen(raw[long])} characters; the cap is ${elemCap}`);
  const scope = normArray(raw, [Infinity, elemCap]);
  if (scope.length > cap) die(`SNAP_SCOPE_OVER_CAP: ops.scope has ${scope.length} entries; the cap is ${cap}`);
  return scope;
}

// back off one unit if the boundary would keep a lone high surrogate
function surrogateSafe(str, n) {
  if (n > 0 && n <= str.length) {
    const code = str.charCodeAt(n - 1);
    if (code >= 0xD800 && code <= 0xDBFF) return n - 1;
  }
  return n;
}

let input;
try { input = readFileSync(0, 'utf8'); } catch (e) { die(`cannot read stdin: ${e.code || e.message}`); }

let obj;
try { obj = JSON.parse(input); } catch { die('malformed JSON on stdin'); }
if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) die('stdin must be a JSON object');

for (const k of ['ph', 'c', 's']) {
  if (typeof obj[k] !== 'string' || obj[k] === '') die(`missing or empty scalar: ${k}`);
}

const sys = { ph: obj.ph, c: obj.c, s: obj.s };
const ops = { n: normArray(obj.n, CAPS['ops.n']), f: normArray(obj.f, CAPS['ops.f'], truncateFileEntry) };
const mem = { d: normArray(obj.d, CAPS['mem.d']), x: normArray(obj.x, CAPS['mem.x']) };
const pr = typeof obj.pr === 'string' ? obj.pr : '';

// ---- v3: any band field selects the band envelope (ARCH-010); without one, v1/v2 are untouched ----
const band = ['role', 'tk', 'scope', 'gate', 'p'].some((k) => obj[k] !== undefined);
if (band) {
  for (const k of ['role', 'tk', 'gate']) {
    if (typeof obj[k] !== 'string' || obj[k] === '') die(`missing or empty scalar: ${k}`);
  }
  if (obj.scope !== undefined && !Array.isArray(obj.scope)) die('scope must be an array');
  if (obj.p !== undefined && (typeof obj.p !== 'object' || obj.p === null || Array.isArray(obj.p))) die('p must be a plain object');
  // Assignment order is serialization order: BLOCK_FIELDS[3] lists scope before gate.
  Object.assign(sys, { role: obj.role, tk: obj.tk });
  if (obj.scope !== undefined) ops.scope = scopeArray(obj.scope);
  ops.gate = obj.gate;
  if (obj.p !== undefined) mem.p = obj.p;
}

if (pr === '' && !band) {
  // ---- v1: V1_MAX_CHARS cap, drop oldest of mem.d / ops.f ----
  const snap = { v: 1, sys, ops, mem };
  let line = JSON.stringify(snap);
  while (line.length > V1_MAX_CHARS && (mem.d.length || ops.f.length)) {
    if (mem.d.length >= ops.f.length && mem.d.length) mem.d.shift();
    else ops.f.shift();
    line = JSON.stringify(snap);
  }
  writeOut(line);
} else {
  // ---- v2 and v3: 10 MiB cap, truncate raw pr before serialize ----
  // FEAT-034: v4 only where v3 cannot name the role, so every existing envelope stays byte-identical.
  const v = !band ? 2 : ROLES_BY_VERSION[3].includes(obj.role) ? 3 : 4;
  const skeletonBytes = byteLen(JSON.stringify({ v, sys, ops, mem, pr: '' }));
  if (skeletonBytes > MAX_SNAP_BYTES) die('skeleton exceeds cap even without prose');

  // total serialized bytes for a candidate pr value (skeleton already counts the two empty-value quotes)
  const totalBytes = (val) => skeletonBytes + byteLen(JSON.stringify(val)) - 2;

  let keep = pr.length;
  if (totalBytes(pr) > MAX_SNAP_BYTES) {
    let lo = 0, hi = pr.length, best = 0;
    for (let i = 0; i < 64 && lo <= hi; i++) {
      const mid = (lo + hi) >> 1;
      if (totalBytes(pr.slice(0, mid)) <= MAX_SNAP_BYTES) { best = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    keep = surrogateSafe(pr, best);
    // defensive fallback if the search somehow left us over cap
    if (totalBytes(pr.slice(0, keep)) > MAX_SNAP_BYTES) {
      keep = surrogateSafe(pr, Math.max(0, Math.floor((MAX_SNAP_BYTES - skeletonBytes - 2) / 6)));
    }
  }

  const snap = { v, sys, ops, mem, pr: pr.slice(0, keep) };
  writeOut(JSON.stringify(snap));
}
