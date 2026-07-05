import { readFileSync } from 'node:fs';

const MAX_SNAP_BYTES = 10485760;          // 10 MiB (v2)
const V1_MAX_CHARS = 4096;                // handoff-file contract (v1)
const CAPS = { n: [3, 200], f: [20, 300], d: [10, 300], x: [5, 200] };

const die = (msg) => { process.stderr.write(`SNAP_BUILD_ERROR: ${msg}\n`); process.exit(1); };
const byteLen = (s) => Buffer.byteLength(s, 'utf8');

// Async write, then exit 0 once the OS has drained it. A synchronous write to a
// non-blocking stdout pipe throws EAGAIN on large payloads, and process.exit right
// after an async write truncates the un-flushed tail; the drain callback avoids both.
function writeOut(s) { process.stdout.write(s + '\n', () => process.exit(0)); }

// filter empties, dedup (first wins), Unicode-safe per-element truncation, head-drop to count cap
function normArray(raw, [cap, elemCap]) {
  const arr = Array.isArray(raw) ? raw : [];
  const seen = new Set(); const out = [];
  for (const item of arr) {
    if (typeof item !== 'string') continue;
    const t = item.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(Array.from(t).slice(0, elemCap).join(''));
  }
  while (out.length > cap) out.shift();
  return out;
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
const ops = { n: normArray(obj.n, CAPS.n), f: normArray(obj.f, CAPS.f) };
const mem = { d: normArray(obj.d, CAPS.d), x: normArray(obj.x, CAPS.x) };
const pr = typeof obj.pr === 'string' ? obj.pr : '';

if (pr === '') {
  // ---- v1: 4096-char cap, drop oldest of mem.d / ops.f ----
  const snap = { v: 1, sys, ops, mem };
  let line = JSON.stringify(snap);
  while (line.length > V1_MAX_CHARS && (mem.d.length || ops.f.length)) {
    if (mem.d.length >= ops.f.length && mem.d.length) mem.d.shift();
    else ops.f.shift();
    line = JSON.stringify(snap);
  }
  writeOut(line);
} else {
  // ---- v2: 10 MiB cap, truncate raw pr before serialize ----
  const skeletonBytes = byteLen(JSON.stringify({ v: 2, sys, ops, mem, pr: '' }));
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

  const snap = { v: 2, sys, ops, mem, pr: pr.slice(0, keep) };
  writeOut(JSON.stringify(snap));
}
