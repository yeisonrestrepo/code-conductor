#!/usr/bin/env node
// Record parity between CHANGELOG.md, AGENT-READABLE BACKLOG.md and VERSION.
//
// REPO-ONLY. See the note in tools/id-ceiling.mjs.
//
// Why this exists: [BUG-044] shipped as 1.32.0 and was closed out in project.md, and
// its backlog heading read [ ] with no shipping record for an entire release. Two
// load-bearing documents disagreed about a shipped release and no instrument compared
// them. The heading flip had no owner. This is the owner.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// A claim is a bullet under a section that records a SHIPPED change. `Filed` and
// `Notes` are excluded by name, because a bullet under `### Filed` records a minted
// item and reading it as a claim is a false positive this repository's own CHANGELOG
// produced on the first run of the single-level form.
export const SHIPPED_SECTIONS = new Set(['Added', 'Fixed', 'Changed', 'Removed', 'Deprecated', 'Security']);

// [BUG-050] An id may carry suffixes after its number, such as ARCH-008-S1. Both
// patterns read that shape, so a sub-shaped heading is its own entry (its body is never
// credited to its parent) and a sub-shaped claim is seen instead of silently skipped.
const ID = '[A-Z]+-\\d{3,}(?:-[A-Za-z0-9]+)*';
const SUB_SHAPED = /^[A-Z]+-\d{3,}-/;
const HEADING = new RegExp(`^### \\[(.)\\] \`\\[(${ID})\\]\``);
const VERSION_HEADING = /^## \[?(\d+\.\d+\.\d+)\]?/;
const SECTION = /^### (.+?)\s*$/;
// Level two: the id marker must be the bullet's FIRST token.
const CLAIM = new RegExp(`^\\s*[-*]\\s+\\*\\*\\[(${ID})\\]\\*\\*`);
const SHIPPED_AS = /shipped as `?(\d+\.\d+\.\d+)`?/;
const TERMINAL = new Set(['X', '~']);

const lines = (text) => String(text).replace(/\r\n/g, '\n').split('\n');

export function parseBacklog(text) {
  const entries = new Map();
  let cur = null;
  for (const line of lines(text)) {
    const m = line.match(HEADING);
    if (m) { cur = { state: m[1], body: [] }; entries.set(m[2], cur); continue; }
    if (cur) cur.body.push(line);
  }
  const out = new Map();
  for (const [id, e] of entries) out.set(id, { state: e.state, body: e.body.join('\n') });
  return out;
}

export function parseChangelog(text) {
  const versions = [];
  const seen = new Map();
  let cur = null;
  let section = null;
  for (const line of lines(text)) {
    const v = line.match(VERSION_HEADING);
    if (v) {
      cur = { version: v[1], claims: [] };
      versions.push(cur);
      seen.set(v[1], (seen.get(v[1]) ?? 0) + 1);
      section = null;
      continue;
    }
    const s = line.match(SECTION);
    if (s) { section = s[1]; continue; }
    if (!cur || !SHIPPED_SECTIONS.has(section)) continue;
    const c = line.match(CLAIM);
    if (c) cur.claims.push(c[1]);
  }
  const duplicates = [];
  for (const [version, count] of seen) if (count > 1) duplicates.push(version);
  return { versions, duplicates };
}

export function checkParity({ backlogText, changelogText, versionFile }) {
  const violations = [];
  const { versions, duplicates } = parseChangelog(changelogText);

  // Zero claims because nothing parsed is a failure, never a pass. Every instrument in
  // tools/README.md's registry could report success on evidence it had not read.
  if (versions.length === 0) {
    violations.push({ direction: 'PARSE', id: null, version: null, detail: 'CHANGELOG has no version heading' });
    return { ok: false, violations };
  }
  for (const version of duplicates) {
    violations.push({ direction: 'PARSE', id: null, version, detail: `CHANGELOG names version ${version} more than once` });
  }

  const backlog = parseBacklog(backlogText);
  const current = versions[0].version;

  // [BUG-050] repair (b), owner-ruled: releases claim only top-level ids. A sub-shaped
  // claim under a shipped section is a named failure; Filed and Notes never reach here.
  for (const { version, claims } of versions) {
    for (const id of claims.filter((c) => SUB_SHAPED.test(c))) {
      violations.push({ direction: 'SUB', id, version, detail: `${version} claims sub-shaped ${id}; releases claim only top-level ids` });
    }
  }

  // Direction A, unscoped: every claim maps to a heading in a terminal state.
  for (const { version, claims } of versions) {
    for (const id of claims.filter((c) => !SUB_SHAPED.test(c))) {
      const e = backlog.get(id);
      if (!e) {
        violations.push({ direction: 'A', id, version, detail: `${version} claims ${id} but there is no backlog heading for it` });
      } else if (!TERMINAL.has(e.state)) {
        violations.push({ direction: 'A', id, version, detail: `${version} claims ${id} but its heading reads [${e.state}]` });
      }
    }
  }

  // Direction B, scoped to the ids the CURRENT version claims. Unscoped it is red 28
  // times against this repository, because the DONE convention is recent: 34 closed
  // headings, 6 carrying a shipped version. A 28-entry grandfather list maintained
  // forever is a toll, priced out loud and declined. Tightening this is a one-line
  // scope change if the convention back-fills.
  for (const id of versions[0].claims.filter((c) => !SUB_SHAPED.test(c))) {
    const e = backlog.get(id);
    // [X] only, not the whole TERMINAL set. [~] is terminal for direction A because a
    // superseded item is legitimately closed, but it never shipped, so demanding a
    // bullet naming a shipped version would be demanding a fact that does not exist.
    // The live repository cannot catch this: direction B is scoped to the ids the
    // CURRENT version claims, and the one [~] entry, BUG-035, is claimed only by
    // 1.28.0 through 1.30.0. The fixture exposed it; the live data hid it.
    if (!e || e.state !== 'X') continue;
    const m = e.body.match(SHIPPED_AS);
    if (!m) {
      violations.push({ direction: 'B', id, version: current, detail: `${id} is closed but carries no bullet naming a shipped version` });
    } else if (versionFile && m[1] !== versionFile) {
      violations.push({ direction: 'B', id, version: current, detail: `${id} names shipped version ${m[1]}, but VERSION reads ${versionFile}` });
    }
  }

  // Direction C, unscoped: a DONE version must exist as a CHANGELOG heading.
  const known = new Set(versions.map((v) => v.version));
  for (const [id, e] of backlog) {
    if (!TERMINAL.has(e.state)) continue;
    const m = e.body.match(SHIPPED_AS);
    if (m && !known.has(m[1])) {
      violations.push({ direction: 'C', id, version: m[1], detail: `${id} names shipped version ${m[1]}, absent from CHANGELOG` });
    }
  }

  // Existing sub-shaped headings are legitimate history: named, never failed.
  const subShaped = [...backlog.keys()].filter((id) => SUB_SHAPED.test(id));
  return { ok: violations.length === 0, violations, subShaped };
}

function main() {
  const root = process.cwd();
  const r = checkParity({
    backlogText: readFileSync(join(root, 'AGENT-READABLE BACKLOG.md'), 'utf8'),
    changelogText: readFileSync(join(root, 'CHANGELOG.md'), 'utf8'),
    versionFile: readFileSync(join(root, 'VERSION'), 'utf8').trim(),
  });
  for (const v of r.violations) console.log(`FAIL [${v.direction}] ${v.detail}`);
  if (r.subShaped.length) console.log(`sub-shaped headings seen: ${r.subShaped.join(', ')}`);
  console.log(r.ok ? 'RECORD_PARITY_OK' : `RECORD_PARITY_FAILED (${r.violations.length} violations)`);
  process.exit(r.ok ? 0 : 1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
