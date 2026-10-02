#!/usr/bin/env node
// Heading-scoped id ceiling over the working tree UNION origin/main.
//
// REPO-ONLY. This file must never be added to package.json `files` and must never
// be copied by lib/installer/deploy.mjs. tests/tools/tools-not-shipped.test.js pins
// both. A consumer installation has no AGENT-READABLE BACKLOG.md, so shipping this
// would put an inert file on every user's disk.
//
// This is a QUERY, not a gate: its output is read by whoever is deciding what id to
// mint. The assertable invariant that lives alongside it, duplicate-id freedom, is
// asserted live in tests/tools/repo-invariants.test.js.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const BACKLOG = 'AGENT-READABLE BACKLOG.md';

// \d{3,} and not \d{3}: an exact quantifier makes [BUG-1000] invisible forever,
// freezing the ceiling at 999 and minting a duplicate with zero diagnostics. This is
// the one thing worth carrying verbatim out of the retired survivor.
//
// [BUG-050] A sub-shaped heading such as ARCH-008-S1 is seen, not skipped: it consumes
// its parent's number even when the parent has no heading, and it is checked for
// duplicates under its full id, because the ceiling's one job is that no id is minted
// twice.
const HEADING = /^### \[.\] `\[(BUG|FEAT|ARCH)-(\d{3,})((?:-[A-Za-z0-9]+)*)\]`/;

export function scanHeadings(text) {
  const max = {};
  const counts = new Map();
  const subShaped = [];
  let headings = 0;
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  for (const line of lines) {
    const m = line.match(HEADING);
    if (!m) continue;
    const id = `${m[1]}-${m[2]}${m[3]}`;
    counts.set(id, (counts.get(id) ?? 0) + 1);
    if (m[3]) subShaped.push(id);
    else headings += 1;
    const n = Number(m[2]);
    if (max[m[1]] === undefined || n > max[m[1]]) max[m[1]] = n;
  }
  const duplicates = [];
  for (const [id, count] of counts) if (count > 1) duplicates.push({ id, count });
  return { headings, max, duplicates, subShaped };
}

function remoteLeg() {
  const r = spawnSync('git', ['show', `origin/main:${BACKLOG}`], { encoding: 'utf8' });
  if (r.error) return { failed: `could not spawn git: ${r.error.message}` };
  if (r.status !== 0) {
    return { failed: `git show exited ${r.status}: ${String(r.stderr || '').trim()}` };
  }
  if (!String(r.stdout || '').trim()) {
    return { failed: 'git show exited 0 with empty output, which cannot be true for this repository' };
  }
  return { text: r.stdout };
}

function main() {
  const working = scanHeadings(readFileSync(BACKLOG, 'utf8'));
  const remote = remoteLeg();

  // A number derived from half the evidence is worse than no number, and printing one
  // would itself be an instance of the archetype tools/README.md documents: success
  // semantics on a failure path.
  if (remote.failed) {
    console.error(`CEILING_ABORT: origin/main leg failed. ${remote.failed}`);
    console.error('No ceiling printed. Fix the leg and re-run; do not mint from the working tree alone.');
    process.exit(2);
  }

  const other = scanHeadings(remote.text);
  const report = (label, r) =>
    console.log(`${label}: headings=${r.headings} max=${JSON.stringify(r.max)} ` +
      `dupes=${r.duplicates.length ? JSON.stringify(r.duplicates) : 'none'}` +
      (r.subShaped.length ? ` sub-shaped seen=${JSON.stringify(r.subShaped)}` : ''));
  report('working tree', working);
  report('origin/main ', other);

  const allSub = [...new Set([...working.subShaped, ...other.subShaped])];
  if (allSub.length) {
    console.error(`CEILING_NOTE: ${allSub.length} sub-shaped id(s) seen, each counted at its parent number: ${allSub.join(', ')}`);
  }

  const union = {};
  for (const src of [working.max, other.max]) {
    for (const [prefix, n] of Object.entries(src)) {
      if (union[prefix] === undefined || n > union[prefix]) union[prefix] = n;
    }
  }
  console.log(`UNION ceiling ${JSON.stringify(union)}`);
  const bug = union.BUG ?? 0;
  console.log(`next mintable BUG-${String(bug + 1).padStart(3, '0')}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
