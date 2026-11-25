#!/usr/bin/env node
// code-conductor guard adapter for the Codex CLI, BUG-094.
// The .codex/hooks.json bootstrap finds the project root from wherever Codex started
// and calls main() here. The root comes from THIS file's location, so the guard that
// runs is always the one next to the hooks.json that was found, never a path resolved
// against the working directory (which failed open when Codex started in a subdirectory).
// The project's unchanged .claude/hooks/pre-tool-use.mjs gets the payload as received and
// its verdict passes through byte for byte. Fail closed: whenever the guard cannot give
// a trustworthy verdict, answer Claude's deny shape. Exits 0 on every path.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const GUARD_TIMEOUT_MS = 60000;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GUARD = join(ROOT, '.claude', 'hooks', 'pre-tool-use.mjs');

const denyJson = (reason) => JSON.stringify({
  hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
});

function runGuard(input) {
  return spawnSync(process.execPath, [GUARD], {
    cwd: ROOT,
    input,
    encoding: 'utf8',
    timeout: GUARD_TIMEOUT_MS,
    windowsHide: true,
    env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT },
  });
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Returns what to print: '' for allow, the guard's own text, or a deny.
function outputFor(input) {
  try { JSON.parse(input); } catch (e) { return denyJson(`code-conductor guard could not read the Codex call: ${e.message}`); }
  const res = runGuard(input);
  const failed = `code-conductor guard could not run (${GUARD})`;
  if (res.error) return denyJson(`${failed}: ${res.error.message}`);
  if (res.signal) return denyJson(`${failed}: killed by ${res.signal}`);
  if (res.status !== 0) return denyJson(`${failed}: exit ${res.status}. ${(res.stderr || '').trim()}`.trim());
  if ((res.stdout || '').trim() === '') return '';
  let parsed;
  try { parsed = JSON.parse(res.stdout); } catch { parsed = undefined; }
  return isPlainObject(parsed) ? res.stdout : denyJson(`${failed}: output was not a JSON object`);
}

export function main() {
  let output;
  try {
    output = outputFor(readFileSync(0, 'utf8'));
  } catch (e) {
    output = denyJson(`code-conductor guard could not read the Codex call: ${e.message}`);
  }
  if (output) process.stdout.write(output);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main();
