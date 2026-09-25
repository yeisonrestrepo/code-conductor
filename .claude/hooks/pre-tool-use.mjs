#!/usr/bin/env node
// PreToolUse front door. Contract: https://code.claude.com/docs/en/hooks (read 2026-09-25).
// Claude Code writes the payload to stdin as JSON; a decision is returned as
// hookSpecificOutput.permissionDecision and EVERY path exits 0. Nothing here exits 2:
// a deliberate denial must never be indistinguishable from a crashed script.
// Zero dependencies by design; node: builtins only.
import { readFileSync, statSync } from 'node:fs';
import { posix } from 'node:path';

const LINE_LIMIT = 150;
const BLOCKED_COMPONENTS = new Set(['graphify-out', 'node_modules']);

let emitted = false;

function debug(msg) {
  if (process.env.CC_HOOK_DEBUG) process.stderr.write(`PRE_TOOL_USE: ${msg}\n`);
}

const deny = (reason) => ({ permissionDecision: 'deny', permissionDecisionReason: reason });
const ask = (reason) => ({ permissionDecision: 'ask', permissionDecisionReason: reason });

function emit(decision) {
  if (emitted) return;
  emitted = true;
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', ...decision },
  }) + '\n');
}

// `wc -l` counts newline characters and the 150-line threshold was calibrated against
// it, so count the same way rather than splitting (which would report one line more).
function countLines(text) {
  let n = 0;
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') n++;
  return n;
}

function isRegularFile(path) {
  try { return statSync(path).isFile(); } catch { return false; }
}

// The platform sends `file_path` for Read/Write/Edit. The bash original read `path`,
// which no tool sends, which is why Guard 2 never fired even where the wiring worked;
// both are accepted so an MCP-provided create_file/write_file keeps working.
function targetPath(input) {
  const raw = input.file_path ?? input.path;
  return typeof raw === 'string' ? raw.trim() : '';
}

function stamp(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Guard 4: reads of graphify-out/ and node_modules/ (BUG-017). Runs before Guard 1 for
// Read: a forbidden path is forbidden whatever its size, and deciding here spares a stat
// and a full file read on a path that is about to be denied anyway.
function guard4BlockedRead(input) {
  const path = targetPath(input);
  if (!path) return null; // Case A: nothing to verify
  const normalized = posix.normalize(path.replace(/\\/g, '/'));
  const parts = normalized.split('/').filter(p => p && p !== '.');
  if (!parts.some(p => BLOCKED_COMPONENTS.has(p.toLowerCase()))) return null;
  return deny(
    'Guard 4: direct reads of graphify-out/ and node_modules/ are forbidden. ' +
    'Use Glob for existence checks or the graphify skill: /graphify query "<question>".'
  );
}

// Guard 1: a large-file Read with no limit. A path that cannot be stat'd has no size to
// exceed the threshold, so it allows.
function guard1LargeRead(input) {
  if (input.limit !== undefined) return null;
  const path = targetPath(input);
  if (!path || !isRegularFile(path)) return null;
  let lines;
  try { lines = countLines(readFileSync(path, 'utf8')); }
  catch (e) { debug(`guard 1 could not read ${path}: ${e.message}`); return null; }
  if (lines <= LINE_LIMIT) return null;
  return deny(
    `Guard 1: LARGE FILE READ BLOCKED. File: ${path}. Lines: ${lines} ` +
    `(>${LINE_LIMIT}, no limit specified). Follow the orchestrator lookup chain: ` +
    '1. Check .claude/memory/project.md  2. Query graphify for structural questions  ' +
    '3. Use Grep/Glob for pattern searches  4. Read with explicit offset + limit.'
  );
}

// Guard 2: writing over a file that already exists. "ask" rather than "deny" because the
// bash original printed a three-option prompt, and the contract's "ask" is that prompt in
// the platform's own vocabulary. Not registered for Edit: a targeted edit is the action
// this guard recommends, so gating it would contradict its own text.
function guard2DuplicateWrite(input) {
  const path = targetPath(input);
  if (!path || !isRegularFile(path)) return null;
  let lines = '?';
  try { lines = countLines(readFileSync(path, 'utf8')); } catch { /* keep '?' */ }
  let modified = 'unknown';
  try { modified = stamp(statSync(path).mtimeMs); } catch { /* keep 'unknown' */ }
  return ask(
    'FILE ALREADY EXISTS\n' +
    `   Path:          ${path}\n` +
    `   Lines:         ${lines}\n` +
    `   Last modified: ${modified}\n\n` +
    '   Choose an action:\n' +
    '   1. Edit the existing file instead of overwriting\n' +
    '   2. Confirm you want to overwrite (re-issue the command)\n' +
    '   3. Cancel'
  );
}

// Guard 3: declared and empty. The twelve-pattern bash scanner has never shipped; its
// behavioral authority is tests/fixtures/guard3-reference.sh and [BUG-037] fills this in.
// The slot exists now so that port plugs in a pattern table and nothing else, and so the
// Bash dispatch route is proven live by this release's harness.
function guard3BashScan() {
  return null;
}

const DISPATCH = {
  Read: [guard4BlockedRead, guard1LargeRead],
  Write: [guard2DuplicateWrite],
  create_file: [guard2DuplicateWrite],
  write_file: [guard2DuplicateWrite],
  Edit: [],
  Bash: [guard3BashScan],
};

// Case B. Unparseable input is not "nothing to verify", it is "the verifier could not
// run", which is the condition that fails closed. CC_HOOK_ALLOW bypasses THIS denial only;
// it does not suppress, alter or bypass any guard's decision on input that parses.
function unreadable(why) {
  process.stderr.write(
    `pre-tool-use: ${why}; no guard could inspect this call. ` +
    'Set CC_HOOK_ALLOW=1 to allow calls whose payload this hook cannot read.\n'
  );
  if (process.env.CC_HOOK_ALLOW) return;
  emit(deny(
    `Pre-tool-use hook: ${why}, so no guard could inspect this call. ` +
    'Unreadable input fails closed. Set CC_HOOK_ALLOW=1 to override.'
  ));
}

function main() {
  let raw = '';
  try { raw = readFileSync(0, 'utf8'); }
  catch (e) { debug(`stdin read failed: ${e.message}`); }

  let payload;
  try { payload = JSON.parse(raw); }
  catch { return unreadable('stdin did not parse as JSON'); }

  // Parsed, so not Case B. Anything the table cannot route on is unfamiliar-but-valid,
  // and fail-closed is scoped to unparseable input, never to an additive payload change.
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    debug('payload is not a JSON object; allowing');
    return;
  }
  const name = typeof payload.tool_name === 'string' ? payload.tool_name : '';
  const rawInput = payload.tool_input;
  const input = (rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput)) ? rawInput : {};
  const guards = DISPATCH[name];
  if (!guards) { debug(`no guard registered for tool_name "${name}"; allowing`); return; }
  for (const guard of guards) {
    const decision = guard(input);
    if (decision) { emit(decision); return; }
  }
}

try { main(); } catch (e) { unreadable(`the hook threw (${e && e.message})`); }
