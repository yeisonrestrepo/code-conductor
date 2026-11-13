#!/usr/bin/env node
// FEAT-034: the local half of the security seat. Scans the lines a run added (against its
// base commit) for credentials, and judges changed package.json scripts with the base
// commit's own Guard 3. It reads git and writes nothing in the project: the only file
// it creates is a temporary directory of its own, removed before it returns.
// node: builtins only; no network call.
import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';

// The generic row fires on test fixtures, so it must not block at the default threshold (C8).
export const SECRET_PATTERNS = [
  { name: 'private key block', severity: 'critical', re: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/ },
  { name: 'AWS access key id', severity: 'critical', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { name: 'GitHub token', severity: 'critical', re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})\b/ },
  { name: 'Slack token', severity: 'critical', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { name: 'Stripe live key', severity: 'critical', re: /\b[sr]k_live_[A-Za-z0-9]{16,}/ },
  { name: 'Google API key', severity: 'critical', re: /\bAIza[0-9A-Za-z_-]{35}/ },
  { name: 'Anthropic API key', severity: 'critical', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: 'generic secret assignment', severity: 'moderate', re: /\b(?:password|passwd|secret|token|api[_-]?key)\b["']?\s*[:=]\s*["'][^"'\s]{12,}["']/i },
];

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

export function scanSecrets(lines) {
  const out = [];
  for (const { path, line, text } of lines) {
    const hit = SECRET_PATTERNS.find((p) => p.re.test(text));
    if (hit) out.push(`- [${hit.severity}] secret ${path}:${line} — ${hit.name}; value withheld`);
  }
  return out;
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

export function changedScripts(root, base) {
  const out = [];
  for (const path of changedPackagePaths(root, base)) {
    const now = parseScripts(readFileSync(join(root, path), 'utf8'), path);
    const before = baseScripts(root, base, path);
    for (const [name, value] of Object.entries(now ?? {})) {
      if (typeof value === 'string' && before?.[name] !== value) out.push({ path, name, value });
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

export function scanScripts(root, base) {
  const candidates = changedScripts(root, base);
  if (candidates.length === 0) return [];
  const high = withBaseHook(root, base, (dir) => candidates.flatMap((c) => {
    const code = askHook(dir, c.value);
    return code ? [`- [high] script ${c.path} scripts.${c.name} — Guard 3 denies this text as a direct command (${code}); base allowlist applied`] : [];
  }));
  const moderate = candidates
    .filter((c) => c.path === 'package.json' && ROOT_TEST_SCRIPTS.includes(c.name))
    .map((c) => `- [moderate] script ${c.path} scripts.${c.name} — npm test runs this changed script`);
  return [...high, ...moderate];
}

function runScan(label, fn) {
  try { return { status: 'ran', lines: fn() }; }
  catch (err) {
    if (!(err instanceof ScanFailure)) throw err;
    process.stderr.write(`security-scan: ${label} scan failed: ${err.message}\n`);
    return { status: 'failed', lines: [] };
  }
}

export function scanChanges(root, base) {
  try { checkBase(root, base); }
  catch (err) {
    if (!(err instanceof ScanFailure)) throw err;
    process.stderr.write(`security-scan: ${err.message}\n`);
    return { secrets: 'failed', scripts: 'failed', findings: [] };
  }
  const secrets = runScan('secrets', () => scanSecrets([
    ...diffLines(git(root, ['diff', '--no-color', '--no-ext-diff', '--unified=0', '--relative', '--src-prefix=a/', '--dst-prefix=b/', base]).toString('utf8')),
    ...untrackedLines(root),
  ]));
  const scripts = runScan('scripts', () => scanScripts(root, base));
  return { secrets: secrets.status, scripts: scripts.status, findings: [...secrets.lines, ...scripts.lines] };
}

function main(args) {
  if (args.length > 1) {
    process.stderr.write('security-scan: usage: security-scan.mjs <base>\n');
    return 1;
  }
  const result = scanChanges(process.cwd(), args[0]);
  for (const line of result.findings) process.stdout.write(`${line}\n`);
  process.stdout.write(`SCAN-RESULT secrets=${result.secrets} scripts=${result.scripts}\n`);
  return 0;
}

const invoked = process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url;
if (invoked) process.exitCode = main(process.argv.slice(2));
