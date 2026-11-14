#!/usr/bin/env node
// FEAT-034: the local half of the security seat. Scans the lines a run added (against its
// base commit) for credentials, and judges changed package.json scripts with the base
// commit's own Guard 3. It reads git and writes nothing in the project: the only file
// it creates is a temporary directory of its own, removed before it returns.
// FEAT-059: findings carry the audit's severities, and those already present at the base are printed in an owner-only block, never mixed with the ones the change introduces.
// node: builtins only; no network call.
import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';

// FEAT-059 C15: the router refuses a base scanner from before this contract.
export const SCAN_CONTRACT = 2;

// The generic row fires on test fixtures, so it must not block at the default threshold (C8).
// `marker` rows match a constant header, not the secret itself: a base file holding the same
// header proves nothing about the key, so their hits are never classified as pre-existing.
export const SECRET_PATTERNS = [
  { name: 'private key block', level: 'critical', marker: true, re: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/ },
  { name: 'AWS access key id', level: 'critical', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { name: 'GitHub token', level: 'critical', re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})\b/ },
  { name: 'Slack token', level: 'critical', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { name: 'Stripe live key', level: 'critical', re: /\b[sr]k_live_[A-Za-z0-9]{16,}/ },
  { name: 'Google API key', level: 'critical', re: /\bAIza[0-9A-Za-z_-]{35}/ },
  { name: 'Anthropic API key', level: 'critical', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: 'generic secret assignment', level: 'moderate', re: /\b(?:password|passwd|secret|token|api[_-]?key)\b["']?\s*[:=]\s*["'][^"'\s]{12,}["']/i },
];

const LEVELS = ['low', 'moderate', 'high', 'critical'];
const USAGE = 'security-scan: usage: security-scan.mjs <base> <low|moderate|high|critical>';
const OWNER_OPEN = 'PRE-EXISTING (owner only):';
const OWNER_CLOSE = 'END PRE-EXISTING';
// detect-stack's precedence (scripts/detect-stack.mjs:207-210).
const LOCKFILES = ['pnpm-lock.yaml', 'package-lock.json'];

// C1: the router recomputes this from the run file, so the agent never chooses a severity.
export const severityFor = (level, threshold) => (LEVELS.indexOf(level) >= LEVELS.indexOf(threshold) ? 'blocker' : 'minor');
const findingLine = (level, threshold, location, source, text) => `- [${severityFor(level, threshold)}] ${location} — ${level} ${source}: ${text}`;

const HOOK_REL = '.claude/hooks/pre-tool-use.mjs';
const ALLOWLIST_REL = '.claude/memory/bash-scan-allowlist.txt';
const SNIFF_BYTES = 8000;
const ROOT_TEST_SCRIPTS = ['pretest', 'test', 'posttest'];

class ScanFailure extends Error {}

function git(root, args) {
  const r = spawnSync('git', ['-c', 'core.quotepath=off', ...args], { cwd: root, maxBuffer: 1 << 30 });
  if (r.error) throw new ScanFailure(r.error.message);
  if (r.status !== 0) throw new ScanFailure(String(r.stderr).trim() || `git ${args[0]} failed`);
  return r.stdout;
}

function checkBase(root, base) {
  if (typeof base !== 'string' || !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(base)) {
    throw new ScanFailure('the run recorded no usable base commit');
  }
  git(root, ['rev-parse', '--verify', '--quiet', `${base}^{commit}`]);
}

const unquote = (s) => (s.length > 1 && s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s);

function headerPath(line) {
  const name = unquote(line.slice(4).replace(/\t$/, ''));
  return name === '/dev/null' ? null : name.replace(/^b\//, '');
}

// Added lines of a --unified=0 diff. A `+++` line is a header only before the first hunk of
// a file, so an added line that happens to start with `++ ` is never mistaken for one.
export function diffLines(text) {
  const out = [];
  let path = null;
  let inHunk = false;
  let next = 0;
  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git ')) { inHunk = false; path = null; continue; }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) { inHunk = true; next = Number(hunk[1]); continue; }
    if (!inHunk && line.startsWith('+++ ')) { path = headerPath(line); continue; }
    if (!inHunk || path === null || !line.startsWith('+')) continue;
    out.push({ path, line: next, text: line.slice(1) });
    next += 1;
  }
  return out;
}

function looksBinary(file) {
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(SNIFF_BYTES);
    const n = readSync(fd, buf, 0, SNIFF_BYTES, 0);
    return buf.subarray(0, n).includes(0);
  } finally { closeSync(fd); }
}

function untrackedPaths(root) {
  return git(root, ['ls-files', '--others', '--exclude-standard', '-z']).toString('utf8').split('\0').filter(Boolean);
}

function untrackedLines(root) {
  const out = [];
  for (const path of untrackedPaths(root)) {
    const file = join(root, path);
    if (!lstatSync(file).isFile() || looksBinary(file)) continue;
    readFileSync(file, 'utf8').split('\n').forEach((text, i) => out.push({ path, line: i + 1, text }));
  }
  return out;
}

export function scanSecrets(lines, threshold) {
  const out = [];
  for (const { path, line, text } of lines) {
    const hit = SECRET_PATTERNS.find((p) => p.re.test(text));
    if (!hit) continue;
    out.push({
      value: hit.marker ? null : hit.re.exec(text)[0],
      line: findingLine(hit.level, threshold, `${path}:${line}`, 'secret', `${hit.name}; value withheld`),
    });
  }
  return out;
}

// C3: matched by value, not by line, so a moved or copied credential is pre-existing.
// A null value (a marker row) fails closed: the hit stays introduced.
function atBase(root, base, value) {
  if (value === null) return false;
  const r = spawnSync('git', ['grep', '-F', '-q', '-e', value, base, '--'], { cwd: root });
  if (r.status === 0) return true;
  if (r.status === 1 && !r.error) return false;
  throw new ScanFailure('git grep could not search the base tree');
}

function splitSecrets(root, base, hits) {
  const introduced = [];
  const preExisting = [];
  for (const hit of hits) (atBase(root, base, hit.value) ? preExisting : introduced).push(hit.line);
  return { introduced, preExisting };
}

function parseScripts(text, label) {
  try { return JSON.parse(text.replace(/^﻿/, '')).scripts ?? {}; }
  catch { throw new ScanFailure(`${label} does not parse as JSON`); }
}

function baseScripts(root, base, path) {
  try { return parseScripts(git(root, ['show', `${base}:./${path}`]).toString('utf8'), path); }
  catch { return {}; }
}

function changedPackagePaths(root, base) {
  const changed = git(root, ['diff', '--name-only', '--relative', '-z', base]).toString('utf8').split('\0');
  return [...new Set([...changed, ...untrackedPaths(root)])]
    .filter((p) => p && basename(p) === 'package.json' && existsSync(join(root, p)));
}

// 1-based line of a script's key, so a finding can name package.json:<line>.
export function scriptLine(text, name) {
  const rows = text.split(/\r?\n/);
  const start = rows.findIndex((l) => l.includes('"scripts":'));
  if (start === -1) return 1;
  const key = `${JSON.stringify(name)}:`;
  const at = rows.findIndex((l, i) => i > start && l.trim().startsWith(key));
  return (at === -1 ? start : at) + 1;
}

export function changedScripts(root, base) {
  const out = [];
  for (const path of changedPackagePaths(root, base)) {
    const text = readFileSync(join(root, path), 'utf8');
    const now = parseScripts(text, path);
    const before = baseScripts(root, base, path);
    for (const [name, value] of Object.entries(now ?? {})) {
      if (typeof value === 'string' && before?.[name] !== value) out.push({ path, name, value, line: scriptLine(text, name) });
    }
  }
  return out;
}

// The decision is made by the base commit's hook and allowlist, never the work tree's: the
// change under scan may edit either one.
function withBaseHook(root, base, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'cc-security-'));
  try {
    writeFileSync(join(dir, 'hook.mjs'), git(root, ['show', `${base}:./${HOOK_REL}`]));
    const list = spawnSync('git', ['show', `${base}:./${ALLOWLIST_REL}`], { cwd: root });
    if (list.status === 0) {
      mkdirSync(join(dir, '.claude', 'memory'), { recursive: true });
      writeFileSync(join(dir, ALLOWLIST_REL), list.stdout);
    }
    return fn(dir);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

// The hook's `code` never reaches stdout, so it is read back from the reason it prints.
export function hookCode(reason, decision) {
  const ids = /Pattern ids: ([^.]+)\./.exec(reason);
  if (ids) return ids[1];
  if (reason.includes('exceeds the maximum scan length')) return 'MAX_LENGTH';
  if (reason.includes('Malformed shell syntax')) return 'MALFORMED';
  return decision;
}

function askHook(dir, command) {
  const env = { ...process.env };
  for (const k of ['CC_GUARD3_WARN', 'CC_HOOK_ALLOW', 'CLAUDE_PROJECT_DIR']) delete env[k];
  const input = JSON.stringify({ tool_name: 'Bash', tool_input: { command } });
  const r = spawnSync(process.execPath, [join(dir, 'hook.mjs')], { cwd: dir, input, env: { ...env, CLAUDE_PROJECT_DIR: dir }, encoding: 'utf8' });
  if (r.error || r.status !== 0) throw new ScanFailure('the base hook did not run');
  if (r.stdout.trim() === '') return null;
  let out;
  try { out = JSON.parse(r.stdout).hookSpecificOutput; } catch { throw new ScanFailure('the base hook printed no JSON'); }
  if (!out || !['deny', 'ask'].includes(out.permissionDecision)) return null;
  return hookCode(out.permissionDecisionReason ?? '', out.permissionDecision);
}

export function scanScripts(root, base, threshold) {
  const candidates = changedScripts(root, base);
  if (candidates.length === 0) return [];
  const high = withBaseHook(root, base, (dir) => candidates.flatMap((c) => {
    const code = askHook(dir, c.value);
    if (!code) return [];
    return [findingLine('high', threshold, `${c.path}:${c.line}`, 'script', `scripts.${c.name}; Guard 3 denies this text as a direct command (${code}); base allowlist applied`)];
  }));
  const moderate = candidates
    .filter((c) => c.path === 'package.json' && ROOT_TEST_SCRIPTS.includes(c.name))
    .map((c) => findingLine('moderate', threshold, `package.json:${c.line}`, 'script', `scripts.${c.name}; npm test runs this changed script`));
  return [...high, ...moderate];
}

const addVersion = (map, name, version) => map.set(name, [...(map.get(name) ?? []), String(version)]);

// An empty map would read as "nothing changed" and file every finding owner-only (plan decisions).
function versionSets(map) {
  if (map.size === 0) throw new Error('no package entry');
  return new Map([...map].map(([k, v]) => [k, [...new Set(v)].sort().join(',')]));
}

function npmVersions(text) {
  const { packages } = JSON.parse(text.replace(/^﻿/, ''));
  if (!packages || typeof packages !== 'object') throw new Error('no packages map');
  const map = new Map();
  for (const [key, entry] of Object.entries(packages)) {
    const at = key.lastIndexOf('node_modules/');
    if (at !== -1) addVersion(map, key.slice(at + 'node_modules/'.length), entry?.version);
  }
  return versionSets(map);
}

const PNPM_KEY = /^ {2}'?\/?((?:@[^@\s/']+\/)?[^@\s/'(]+)@([^\s:'(]+)/;

function pnpmVersions(text) {
  const map = new Map();
  for (const line of text.split(/\r?\n/)) {
    const m = PNPM_KEY.exec(line);
    if (m) addVersion(map, m[1], m[2]);
  }
  return versionSets(map);
}

// C4: the agent and the router read this one function, the router through the base commit's copy.
export function changedPackages(root, base, lockfile) {
  const shown = spawnSync('git', ['show', `${base}:./${lockfile}`], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 30 });
  if (shown.error || shown.status !== 0) return 'all';
  try {
    const read = lockfile === 'pnpm-lock.yaml' ? pnpmVersions : npmVersions;
    const before = read(shown.stdout);
    const now = read(readFileSync(join(root, lockfile), 'utf8'));
    const names = new Set([...before.keys(), ...now.keys()]);
    return [...names].filter((n) => before.get(n) !== now.get(n)).sort();
  } catch { return 'failed'; }
}

const findLockfile = (root) => LOCKFILES.find((f) => existsSync(join(root, f))) ?? null;

function runScan(label, fn) {
  try { return { status: 'ran', found: fn() }; }
  catch (err) {
    if (!(err instanceof ScanFailure)) throw err;
    process.stderr.write(`security-scan: ${label} scan failed: ${err.message}\n`);
    return { status: 'failed', found: { introduced: [], preExisting: [] } };
  }
}

export function scanChanges(root, base, threshold) {
  const lockfile = findLockfile(root);
  try { checkBase(root, base); }
  catch (err) {
    if (!(err instanceof ScanFailure)) throw err;
    process.stderr.write(`security-scan: ${err.message}\n`);
    return { secrets: 'failed', scripts: 'failed', introduced: [], preExisting: [], lockfile, changed: 'failed' };
  }
  const secrets = runScan('secrets', () => {
    const diff = git(root, ['diff', '--no-color', '--no-ext-diff', '--unified=0', '--relative', '--src-prefix=a/', '--dst-prefix=b/', base]).toString('utf8');
    return splitSecrets(root, base, scanSecrets([...diffLines(diff), ...untrackedLines(root)], threshold));
  });
  const scripts = runScan('scripts', () => ({ introduced: scanScripts(root, base, threshold), preExisting: [] }));
  return {
    secrets: secrets.status,
    scripts: scripts.status,
    introduced: [...secrets.found.introduced, ...scripts.found.introduced],
    preExisting: secrets.found.preExisting,
    lockfile,
    changed: lockfile ? changedPackages(root, base, lockfile) : [],
  };
}

function lockfileLine({ lockfile, changed }) {
  if (!lockfile) return 'LOCKFILE none';
  const names = changed === 'all' || changed === 'failed' ? 'all' : changed.length === 0 ? 'none' : changed.join(',');
  return `LOCKFILE ${lockfile} changed=${names}`;
}

function main(args) {
  if (args.length !== 2 || !LEVELS.includes(args[1])) {
    process.stderr.write(`${USAGE}\n`);
    return 1;
  }
  const result = scanChanges(process.cwd(), args[0], args[1]);
  const out = [];
  if (result.preExisting.length > 0) out.push(OWNER_OPEN, ...result.preExisting, OWNER_CLOSE);
  out.push(...result.introduced, lockfileLine(result), `SCAN-RESULT secrets=${result.secrets} scripts=${result.scripts}`);
  process.stdout.write(`${out.join('\n')}\n`);
  return 0;
}

const invoked = process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url;
if (invoked) process.exitCode = main(process.argv.slice(2));
