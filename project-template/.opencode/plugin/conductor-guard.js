// code-conductor guard for OpenCode (FEAT-048, issue #97).
// An adapter, not a copy: every mapped tool call is turned into the payload Claude Code
// sends, handed to the project's own .claude/hooks/pre-tool-use.mjs, and a deny or ask
// decision is thrown back, which is how OpenCode blocks a call.
// Zero dependencies by design; node: builtins only.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const GUARD_REL = join('.claude', 'hooks', 'pre-tool-use.mjs');
// Claude Code's default hook timeout; a hung guard must not hang the session.
const GUARD_TIMEOUT_MS = 60000;

// OpenCode tool name -> the Claude tool name and arguments the guard reads.
// Tools not named here reach no guard, as under the Claude Code matcher.
const TOOL_MAP = {
  bash: (a) => ({ tool_name: 'Bash', tool_input: { command: a.command } }),
  read: (a) => ({ tool_name: 'Read', tool_input: { file_path: a.filePath, offset: a.offset, limit: a.limit } }),
  write: (a) => ({ tool_name: 'Write', tool_input: { file_path: a.filePath, content: a.content } }),
  edit: (a) => ({ tool_name: 'Edit', tool_input: { file_path: a.filePath, old_string: a.oldString, new_string: a.newString } }),
};

function toClaudePayload(input, args, directory) {
  const map = TOOL_MAP[input.tool];
  if (!map) return null;
  return { session_id: input.sessionID, cwd: directory, hook_event_name: 'PreToolUse', ...map(args || {}) };
}

// The guard emits nothing to allow and one JSON line to decide. Anything else means it
// did not run, and a call no guard inspected fails closed, as in the guard itself.
function readDecision(res, guardPath) {
  const failed = `code-conductor guard could not run (${guardPath})`;
  if (res.error) return `${failed}: ${res.error.message}`;
  if (res.status !== 0) return `${failed}: exit ${res.status}. ${(res.stderr || '').trim()}`.trim();
  const out = (res.stdout || '').trim();
  if (!out) return null;
  let decision;
  try { decision = JSON.parse(out).hookSpecificOutput; } catch { return `${failed}: output was not JSON`; }
  if (!decision) return null;
  // A plugin cannot ask the user, so an ask blocks with the guard's own reason.
  if (decision.permissionDecision !== 'deny' && decision.permissionDecision !== 'ask') return null;
  return decision.permissionDecisionReason || 'denied by the code-conductor guard';
}

// `node` from PATH, not process.execPath: inside OpenCode that is the OpenCode binary.
function runGuard(guardPath, payload, directory) {
  return spawnSync('node', [guardPath], {
    cwd: directory,
    input: JSON.stringify(payload),
    encoding: 'utf8',
    timeout: GUARD_TIMEOUT_MS,
    windowsHide: true,
    env: { ...process.env, CLAUDE_PROJECT_DIR: directory },
  });
}

export const ConductorGuard = async ({ directory }) => {
  const guardPath = join(directory, GUARD_REL);
  return {
    'tool.execute.before': async (input, output) => {
      const payload = toClaudePayload(input, output && output.args, directory);
      if (!payload) return;
      const reason = readDecision(runGuard(guardPath, payload, directory), guardPath);
      if (reason) throw new Error(reason);
    },
  };
};
