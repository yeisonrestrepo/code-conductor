#!/usr/bin/env node
// The skipped-test set of each named CI environment, asserted against a measured baseline.
//
// REPO-ONLY. See the note in tools/id-ceiling.mjs; tools-not-shipped.test.js pins it.
//
// Why this exists: [BUG-048]. CI read 925 passed / 96 skipped on Node 20 while the
// local suite read 1009 / 12 for the same 1021 tests, and every run was green because
// nothing asserted what CI skipped. A count would not have been enough, since one skip
// can replace another at a constant count. So the SET is compared, and a difference
// names every identity that moved.
//
// This is a gate, not a hook: every doubt aborts. With no --env it only reports, and
// says so, because a developer machine is not a reproducible environment.
import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BASELINE_FILE = 'tools/skip-baseline.json';
// Vitest 3.2 reports skip and skipIf as `skipped`; `pending` and `todo` are the other
// statuses its JSON reporter uses for a test that did not run.
export const NOT_RUN = new Set(['skipped', 'pending', 'todo']);

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const USAGE = 'usage: node tools/skip-baseline.mjs [--env <name>] --report <path>';

// Vitest writes absolute file names; the identity must not depend on the checkout path.
function repoPath(name, root) {
  return (isAbsolute(name) ? relative(root, name) : name).split('\\').join('/');
}

export function skippedIdentities(report, root) {
  const files = report?.testResults;
  if (!Array.isArray(files) || files.length === 0) {
    return { error: 'unreadable report (testResults is missing or empty)' };
  }
  if (report.success !== true) {
    return { error: 'the run did not succeed (success is not true); Vitest\'s red is the signal, nothing compared' };
  }
  const seen = new Set();
  for (const file of files) {
    if (typeof file?.name !== 'string') return { error: 'unreadable report (a test file has no name)' };
    for (const test of file.assertionResults ?? []) {
      if (!NOT_RUN.has(test.status)) continue;
      const id = `${repoPath(file.name, root)} > ${test.fullName}`;
      if (seen.has(id)) return { error: `duplicate identity in report: ${JSON.stringify(id)}` };
      seen.add(id);
    }
  }
  return { identities: [...seen].sort() };
}

export function parseBaseline(text) {
  let data;
  try { data = JSON.parse(text); } catch (e) { return { error: `is not valid JSON (${e.message})` }; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { error: 'is not a JSON object keyed by environment' };
  }
  for (const [key, list] of Object.entries(data)) {
    if (!Array.isArray(list) || !list.every((s) => typeof s === 'string')) {
      return { error: `key "${key}" is not an array of strings` };
    }
    const dup = list.find((s, i) => list.indexOf(s) !== i);
    if (dup !== undefined) return { error: `key "${key}" lists ${JSON.stringify(dup)} more than once` };
  }
  return { envs: data };
}

export function parseArgs(argv) {
  const out = { env: null, report: null };
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    if (flag !== '--env' && flag !== '--report') return { error: `unknown argument ${JSON.stringify(flag)}` };
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) return { error: `${flag} needs a value` };
    out[flag.slice(2)] = value;
  }
  if (!out.report) return { error: '--report <path> is required' };
  return out;
}

const abort = (reason) => ({ code: 1, lines: [`SKIP_BASELINE_ABORT: ${reason}`] });

function diffSets(expected, observed) {
  const want = new Set(expected);
  const have = new Set(observed);
  return {
    added: observed.filter((id) => !want.has(id)).sort(),
    removed: expected.filter((id) => !have.has(id)).sort(),
  };
}

function reportOnly(ids, reportPath) {
  return { code: 0, lines: [
    `SKIP_BASELINE_OBSERVED node ${process.version}: ${ids.length} skipped identities (report: ${reportPath})`,
    ...ids.map((id) => `SKIPPED ${JSON.stringify(id)}`),
    'SKIP_BASELINE_REPORT_ONLY: no --env given, nothing asserted',
  ] };
}

function assertEnv(env, ids, reportPath, baselineText) {
  if (baselineText === null) return abort(`baseline not found at ${BASELINE_FILE}`);
  const base = parseBaseline(baselineText);
  if (base.error) return abort(`baseline ${BASELINE_FILE} ${base.error}`);
  if (!Object.hasOwn(base.envs, env)) {
    const keys = Object.keys(base.envs).join(', ') || 'none';
    return abort(`environment "${env}" has no key in ${BASELINE_FILE} (keys: ${keys}); commit its measured set in this PR`);
  }
  const { added, removed } = diffSets(base.envs[env], ids);
  if (added.length === 0 && removed.length === 0) {
    return { code: 0, lines: [`SKIP_BASELINE_OK ${env}: ${ids.length} skipped identities match ${BASELINE_FILE} (report: ${reportPath})`] };
  }
  return { code: 1, lines: [
    `SKIP_BASELINE_DRIFT ${env}: +${added.length} −${removed.length} (report: ${reportPath}, baseline: ${BASELINE_FILE})`,
    ...added.map((id) => `  + ${JSON.stringify(id)}`),
    ...removed.map((id) => `  − ${JSON.stringify(id)}`),
    `If the change is intended, update key "${env}" in ${BASELINE_FILE} in this PR: add each + identity, remove each −.`,
  ] };
}

export function evaluate({ env, reportPath, reportText, baselineText, root = ROOT }) {
  if (reportText === null) return abort(`report not found at ${reportPath}`);
  let report;
  try { report = JSON.parse(reportText); } catch (e) { return abort(`unreadable report (${e.message})`); }
  const seen = skippedIdentities(report, root);
  if (seen.error) return abort(seen.error);
  if (!env) return reportOnly(seen.identities, reportPath);
  return assertEnv(env, seen.identities, reportPath, baselineText);
}

const readOrNull = (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } };

function main() {
  const args = parseArgs(process.argv.slice(2));
  const r = args.error
    ? abort(`${args.error}; ${USAGE}`)
    : evaluate({
      env: args.env,
      reportPath: args.report,
      reportText: readOrNull(resolve(args.report)),
      baselineText: args.env ? readOrNull(resolve(ROOT, BASELINE_FILE)) : null,
      root: ROOT,
    });
  for (const line of r.lines) console.log(line);
  // exitCode, not exit(): a report-only run prints ~100 lines, and process.exit can
  // truncate a piped stdout on macOS before it drains.
  process.exitCode = r.code;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
