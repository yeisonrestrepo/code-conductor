#!/usr/bin/env node
// Owner-side release records compared by value between a pull request's base and head.
//
// REPO-ONLY. See the note in tools/id-ceiling.mjs; tools-not-shipped.test.js pins it.
//
// Why this exists: PR #59 shipped release records from a contributor branch, and only a
// human reviewer caught it. A check on touched paths or added lines would fail legitimate
// edits too (a dependency bump rewrites package-lock.json, an [Unreleased] entry edits
// CHANGELOG.md), so the records themselves are parsed and their values compared.
//
// This is a gate: every doubt aborts.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ANCHOR_NEVER = 'CONTRIBUTING.md#what-contributors-must-never-do';
export const ANCHOR_RECORDS = 'CONTRIBUTING.md#records-are-owner-side';
export const RECORD_FILES = Object.freeze(['VERSION', 'package.json', 'package-lock.json', 'CHANGELOG.md', 'AGENT-READABLE BACKLOG.md']);

// The CHANGELOG and backlog regexes anchor on \n; JSON.parse already treats \r\n as whitespace.
const toLf = (text) => text.replace(/\r\n/g, '\n');

// trim() also drops U+FEFF, so a BOM or trailing-newline change alone is not a version change.
export function checkVersionFile(base, head) {
  const before = base.trim();
  const after = head.trim();
  return { violations: before === after ? [] : [`${before} -> ${after}`] };
}

// An editor-added BOM is invisible and fatal to JSON.parse; it is not a contributor's change.
function parseJson(text) {
  try { return { value: JSON.parse(text.replace(/^﻿/, '')) }; } catch (err) { return { message: err.message }; }
}

function compareJsonFields(base, head, fields) {
  const before = parseJson(base);
  if ('message' in before) return { error: { side: 'base', message: before.message } };
  const after = parseJson(head);
  if ('message' in after) return { error: { side: 'head', message: after.message } };
  const changed = fields.filter(([, read]) => read(before.value) !== read(after.value));
  return { violations: changed.map(([label, read]) => `${label} ${read(before.value)} -> ${read(after.value)}`) };
}

export const checkPackageJson = (base, head) => compareJsonFields(base, head, [['version', (j) => j?.version]]);
// Only the two root versions are records; every node_modules entry carries its own "version".
export const checkLockfile = (base, head) => compareJsonFields(base, head, [
  ['version', (j) => j?.version],
  ['packages[""].version', (j) => j?.packages?.['']?.version],
]);

function releaseVersions(text) {
  const versions = [...toLf(text).matchAll(/^## \[([^\]]+)\]/gm)].map((m) => m[1]);
  return new Set(versions.filter((v) => v.toLowerCase() !== 'unreleased'));
}

export function checkChangelog(base, head) {
  const before = releaseVersions(base);
  const after = releaseVersions(head);
  const added = [...after].filter((v) => !before.has(v)).map((v) => `release heading [${v}] added`);
  const removed = [...before].filter((v) => !after.has(v)).map((v) => `release heading [${v}] removed`);
  return { violations: [...added, ...removed] };
}

// The repo-invariants.test.js heading shape, widened to sub-shaped ids (ARCH-008-S1)
// so their state flips are guarded too; the state is any single character.
const BACKLOG_HEADING = /^### \[(.)\] `\[([A-Z]+-\d+(?:-[A-Z0-9]+)*)\]`/gm;

function headingStates(text) {
  const states = new Map();
  for (const [, mark, id] of toLf(text).matchAll(BACKLOG_HEADING)) {
    states.set(id, [...(states.get(id) ?? []), mark === 'x' ? 'X' : mark]);
  }
  for (const list of states.values()) list.sort();
  return states;
}

// An absent id reads as one open heading, so adding or dropping an open item is no record change.
const statesOf = (states, id) => (states.get(id) ?? [' ']).map((s) => `[${s}]`).join(',');

function headingViolations(base, head) {
  const before = headingStates(base);
  const after = headingStates(head);
  const ids = [...new Set([...before.keys(), ...after.keys()])].sort();
  return ids
    .filter((id) => statesOf(before, id) !== statesOf(after, id))
    .map((id) => `${id} heading ${statesOf(before, id)} -> ${statesOf(after, id)}`);
}

function doneLines(text) {
  return toLf(text).split('\n')
    .map((line, i) => ({ line, number: i + 1 }))
    .filter(({ line }) => line.startsWith('* **DONE'));
}

// Multiset difference: occurrences beyond the other side's count are the changed ones.
function unmatched(lines, other) {
  const budget = new Map();
  for (const { line } of other) budget.set(line, (budget.get(line) ?? 0) + 1);
  return lines.filter(({ line }) => {
    const left = budget.get(line) ?? 0;
    budget.set(line, left - 1);
    return left <= 0;
  });
}

function doneViolations(base, head) {
  const before = doneLines(base);
  const after = doneLines(head);
  const added = unmatched(after, before).map(({ number }) => `DONE line added at line ${number}`);
  const removed = unmatched(before, after).map(({ number }) => `DONE line removed (base line ${number})`);
  return [...added, ...removed];
}

export function checkBacklog(base, head) {
  return { violations: [...headingViolations(base, head), ...doneViolations(base, head)] };
}

const CHECKS = {
  'VERSION': [checkVersionFile, ANCHOR_NEVER],
  'package.json': [checkPackageJson, ANCHOR_NEVER],
  'package-lock.json': [checkLockfile, ANCHOR_NEVER],
  'CHANGELOG.md': [checkChangelog, ANCHOR_NEVER],
  'AGENT-READABLE BACKLOG.md': [checkBacklog, ANCHOR_RECORDS],
};

const violation = (path, detail, anchor) => `RECORDS_GUARD_VIOLATION ${path}: ${detail}; see ${anchor}`;

export function checkRecord(path, base, head) {
  const entry = CHECKS[path];
  if (!entry) throw new Error(`records-guard: ${path} is not a record file`);
  const [check, anchor] = entry;
  if (base === null && head === null) return { compared: false, violations: [] };
  // A rename is a deletion at the record path; the new path is not a record.
  if (head === null) return { compared: true, violations: [violation(path, 'deleted or renamed at head', anchor)] };
  if (base === null) return { compared: true, violations: [violation(path, 'created at head', anchor)] };
  const result = check(base, head);
  // A base that does not parse is main's fault, not the PR's, so it is an instrument fault.
  if (result.error?.side === 'base') return { compared: true, baseError: result.error.message, violations: [] };
  if (result.error) {
    return { compared: true, violations: [violation(path, `not valid JSON at head (${result.error.message}); its version cannot be verified`, anchor)] };
  }
  return { compared: true, violations: result.violations.map((detail) => violation(path, detail, anchor)) };
}

const abort = (reason) => ({ code: 1, lines: [`RECORDS_GUARD_ABORT: ${reason}`] });

export function evaluate(files, { base = 'base', head = 'head' } = {}) {
  const results = files.map((file) => ({ path: file.path, ...checkRecord(file.path, file.base, file.head) }));
  const broken = results.find((r) => r.baseError !== undefined);
  if (broken) return abort(`${broken.path} is not valid JSON at base ${base} (${broken.baseError})`);
  const violations = results.flatMap((r) => r.violations);
  if (violations.length > 0) {
    return { code: 1, lines: [...violations, `RECORDS_GUARD_FAILED: ${violations.length} violation(s). Records are written by the owner at release time.`] };
  }
  const compared = results.filter((r) => r.compared).length;
  return { code: 0, lines: [`RECORDS_GUARD_OK: ${compared} record files compared, no owner-side change (base ${base}, head ${head})`] };
}

const USAGE = 'usage: node tools/records-guard.mjs --base <rev> --head <rev>';

export function parseArgs(argv) {
  const out = { base: null, head: null };
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    if (flag !== '--base' && flag !== '--head') return { error: `unknown argument ${JSON.stringify(flag)}` };
    const value = argv[i + 1];
    // An empty value is rejected too: a gate's rule is fail-closed.
    if (!value || value.startsWith('--')) return { error: `${flag} needs a value` };
    out[flag.slice(2)] = value;
  }
  if (!out.base || !out.head) return { error: 'both --base <rev> and --head <rev> are required' };
  return out;
}

// argv array, no shell: the space in AGENT-READABLE BACKLOG.md needs no quoting.
function git(args) {
  const r = spawnSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw new Error(`git ${args.join(' ')} failed (${r.error.message})`);
  return r;
}

// A rev missing from a shallow clone must never read as "every record absent".
function assertCommit(rev) {
  if (git(['rev-parse', '--verify', '--quiet', `${rev}^{commit}`]).status === 0) return;
  throw new Error(`revision "${rev}" is not a commit in this clone; the checkout needs fetch-depth >= 2 (or fetch the base)`);
}

function readAt(rev, path) {
  if (git(['cat-file', '-e', `${rev}:${path}`]).status !== 0) return null;
  const r = git(['show', `${rev}:${path}`]);
  if (r.status === 0) return r.stdout;
  throw new Error(`git show ${rev}:${path} failed (${r.stderr.split('\n')[0].trim()})`);
}

function run(argv) {
  const args = parseArgs(argv);
  if (args.error) return abort(`${args.error}; ${USAGE}`);
  try {
    assertCommit(args.base);
    assertCommit(args.head);
    const files = RECORD_FILES.map((path) => ({ path, base: readAt(args.base, path), head: readAt(args.head, path) }));
    return evaluate(files, args);
  } catch (err) {
    return abort(err.message);
  }
}

function main() {
  const result = run(process.argv.slice(2));
  for (const line of result.lines) console.log(line);
  // exitCode, not exit(): process.exit can truncate a piped stdout before it drains.
  process.exitCode = result.code;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
