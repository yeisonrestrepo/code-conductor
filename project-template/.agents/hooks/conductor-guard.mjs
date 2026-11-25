#!/usr/bin/env node
// code-conductor guard for the Antigravity CLI (agy), FEAT-048.
// agy runs this on every PreToolUse with its payload on stdin. It maps the call to
// Claude Code's {tool_name, tool_input} shape, runs the project's unchanged
// .claude/hooks/pre-tool-use.mjs, and turns a deny or ask into agy's block reply.
// Fail closed: an unmapped tool, a malformed argument or a guard that did not run blocks.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const GUARD_TIMEOUT_MS = 60000;
// agy runs hooks from <project>/.agents/, so the root comes from this file's location.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GUARD = join(ROOT, '.claude', 'hooks', 'pre-tool-use.mjs');

const isText = (v) => typeof v === 'string' && v.length > 0;
const one = (tool_name, tool_input) => ({ payload: { tool_name, tool_input } });
const badArg = (tool, name, want) => ({ block: `code-conductor guard blocked the Antigravity tool "${tool}": argument "${name}" must be ${want}` });
const uncovered = (tool) => `code-conductor guard does not cover the Antigravity tool "${tool}"; it is blocked until the guard maps it`;

// toolSummary is free text every agy tool may carry.
const unknownArgs = (a, known) => Object.keys(a).filter((k) => a[k] !== undefined && !known.has(k)).sort();
const notCovered = (tool, names) => ({ block: `code-conductor guard blocked the Antigravity tool "${tool}": ${names.length === 1 ? 'argument' : 'arguments'} ${names.map((k) => `"${k}"`).join(', ')} not covered by the guard` });

function runCommand(a, tool) {
  if (typeof a.CommandLine !== 'string') return badArg(tool, 'CommandLine', 'a string');
  return one('Bash', { command: a.CommandLine });
}

// StartLine/EndLine are 1-based and inclusive; the guard's Read takes offset and limit.
function readFile(a, tool) {
  if (!isText(a.Path)) return badArg(tool, 'Path', 'a non-empty string');
  const input = { file_path: a.Path };
  if (Number.isInteger(a.StartLine)) input.offset = a.StartLine;
  if (Number.isInteger(a.StartLine) && Number.isInteger(a.EndLine)) input.limit = a.EndLine - a.StartLine + 1;
  return one('Read', input);
}

// Arguments measured on agy 1.5.15. An argument outside a tool's list may change what runs or which
// file is touched (a working directory, a sandbox switch, a path alias), so the call blocks until the
// guard learns it (BUG-071 rule, extended to every mapped tool by BUG-093).
const MAPPED = {
  run_command: { args: new Set(['CommandLine', 'toolSummary', 'WaitMsBeforeAsync', 'BypassSandbox', 'IsDaemon']), map: runCommand },
  read_file: { args: new Set(['Path', 'StartLine', 'EndLine', 'toolSummary']), map: readFile },
  write_file: {
    args: new Set(['Path', 'Content', 'toolSummary']),
    map: (a, t) => (isText(a.Path) ? one('Write', { file_path: a.Path, content: a.Content }) : badArg(t, 'Path', 'a non-empty string')),
  },
  edit_file: {
    args: new Set(['Path', 'Target', 'Replacement', 'toolSummary']),
    map: (a, t) => (isText(a.Path) ? one('Edit', { file_path: a.Path, old_string: a.Target, new_string: a.Replacement }) : badArg(t, 'Path', 'a non-empty string')),
  },
};

export function mapToolCall(toolCall) {
  if (!toolCall || typeof toolCall !== 'object') return { block: 'code-conductor guard blocked an Antigravity call with no toolCall' };
  const tool = String(toolCall.name);
  if (!Object.hasOwn(MAPPED, tool)) return { block: uncovered(tool) };
  const args = toolCall.args && typeof toolCall.args === 'object' ? toolCall.args : {};
  const unknown = unknownArgs(args, MAPPED[tool].args);
  if (unknown.length > 0) return notCovered(tool, unknown);
  return MAPPED[tool].map(args, tool);
}

// Mirrors readDecision in the OpenCode plugin: nothing allows, deny and ask block.
function readDecision(res) {
  const failed = `code-conductor guard could not run (${GUARD})`;
  if (res.error) return `${failed}: ${res.error.message}`;
  if (res.status !== 0) return `${failed}: exit ${res.status}. ${(res.stderr || '').trim()}`.trim();
  const out = (res.stdout || '').trim();
  if (!out) return null;
  let decision;
  try { decision = JSON.parse(out).hookSpecificOutput; } catch { return `${failed}: output was not JSON`; }
  if (!decision) return null;
  if (decision.permissionDecision !== 'deny' && decision.permissionDecision !== 'ask') return null;
  return decision.permissionDecisionReason || 'denied by the code-conductor guard';
}

function runGuard(payload) {
  return spawnSync(process.execPath, [GUARD], {
    cwd: ROOT,
    input: JSON.stringify(payload),
    encoding: 'utf8',
    timeout: GUARD_TIMEOUT_MS,
    windowsHide: true,
    env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT },
  });
}

export function decide(stdinText) {
  const event = JSON.parse(stdinText);
  const mapped = mapToolCall(event && event.toolCall);
  if (mapped.block) return mapped.block;
  const payload = { cwd: ROOT, hook_event_name: 'PreToolUse', ...mapped.payload };
  return readDecision(runGuard(payload));
}

function main() {
  let reason;
  try {
    reason = decide(readFileSync(0, 'utf8'));
  } catch (e) {
    reason = `code-conductor guard could not read the Antigravity call: ${e.message}`;
  }
  if (reason) process.stdout.write(JSON.stringify({ decision: 'deny', reason }) + '\n');
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main();
