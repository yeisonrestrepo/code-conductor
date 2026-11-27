// code-conductor guard for OpenCode (FEAT-048, issue #97; fails closed since the pre-1.44.0
// hardening). An adapter, not a copy: every mapped tool call is turned into the payload(s)
// Claude Code sends, handed to the project's own .claude/hooks/pre-tool-use.mjs, and a deny
// or ask decision is thrown back, which is how OpenCode blocks a call.
// Every tool is one of three kinds: mapped (sent to the guard), read-only (passes, as its
// Claude Code twin passes the hook matcher), or blocked. Anything not named is blocked:
// OpenCode's tool set is not versioned with this guard, so an unknown tool is never trusted.
// An unknown argument of a mapped tool is not trusted either: bash blocks any argument outside the few it knows.
// Since FEAT-048 slice 6, task is mapped too: measured on 1.19.6, a subagent's own calls reach
// this hook, and each call carries the agent of its session, so Guards 5, 6 and 7 apply.
// Zero dependencies by design; node: builtins only.
import { spawnSync } from 'node:child_process';
import { join, resolve, sep } from 'node:path';

const GUARD_REL = join('.claude', 'hooks', 'pre-tool-use.mjs');
// Claude Code's default hook timeout; a hung guard must not hang the session.
const GUARD_TIMEOUT_MS = 60000;

// None of these writes the working tree; todowrite writes OpenCode's own todo list.
const READ_ONLY = new Set([
  'glob', 'grep', 'list', 'lsp', 'todoread', 'todowrite',
  'webfetch', 'websearch', 'codesearch', 'question', 'skill', 'invalid',
]);

const IDENTIFY_REASON = "code-conductor guard could not identify the OpenCode session's agent, so the call is blocked";
const uncovered = (tool) => `code-conductor guard does not cover the OpenCode tool "${tool}"; it is blocked until the guard maps it`;
const blocked = (tool, why) => ({ block: `code-conductor guard blocked "${tool}": ${why}` });
const badArg = (tool, arg, want) => blocked(tool, `argument "${arg}" is missing or not ${want}`);

const isText = (v) => typeof v === 'string' && v.length > 0;
const one = (tool_name, tool_input) => ({ payloads: [{ tool_name, tool_input }] });

// A patch path must stay inside the project. No `\`, no absolute form, and the resolved
// path must sit strictly below the project directory (the directory itself is refused).
function confine(p, directory) {
  if (p.includes('\\')) return { why: 'contains "\\"' };
  if (p.startsWith('/') || /^[A-Za-z]:/.test(p)) return { why: 'is absolute' };
  const root = resolve(directory);
  const abs = resolve(root, p);
  if (!abs.startsWith(root + sep)) return { why: 'resolves outside the project' };
  return { path: abs };
}

// Exact, column-0 markers only. The path group admits no leading or trailing whitespace
// and cannot be empty, so every malformed marker fails the match and blocks the patch.
const MARKER = /^\*\*\* (?:(Begin Patch|End Patch|End of File)|(Add File|Update File|Delete File|Move to): (\S(?:.*\S)?))$/;

function parsePatch(tool, text, directory) {
  const files = [];
  let cur = null;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (line.trim().startsWith('***')) {
      const m = MARKER.exec(line);
      if (!m) return blocked(tool, `the patch has a \`***\` line that is not an exact marker: ${JSON.stringify(line)}`);
      if (m[1]) continue;
      const where = confine(m[3], directory);
      if (where.why) return blocked(tool, `the patch path ${JSON.stringify(m[3])} ${where.why}`);
      if (m[2] === 'Move to') {
        if (!cur || cur.kind !== 'Update File' || cur.moveTo) return blocked(tool, 'a "*** Move to:" must directly follow an "*** Update File:" section');
        cur.moveTo = where.path;
        continue;
      }
      cur = { kind: m[2], path: where.path, added: [], removed: [] };
      files.push(cur);
      continue;
    }
    if (!cur) continue;
    if (line.startsWith('+')) cur.added.push(line.slice(1));
    else if (line.startsWith('-')) cur.removed.push(line.slice(1));
  }
  if (!files.length) return blocked(tool, 'the patch names no file');
  const payloads = [];
  for (const f of files) {
    const added = f.added.join('\n');
    if (f.kind === 'Add File') payloads.push({ tool_name: 'Write', tool_input: { file_path: f.path, content: added } });
    else if (f.kind === 'Delete File') payloads.push({ tool_name: 'Edit', tool_input: { file_path: f.path, old_string: '', new_string: '' } });
    else payloads.push({ tool_name: 'Edit', tool_input: { file_path: f.path, old_string: f.removed.join('\n'), new_string: added } });
    // A move writes the target, so Guard 2 sees an existing target as an overwrite.
    if (f.moveTo) payloads.push({ tool_name: 'Write', tool_input: { file_path: f.moveTo, content: added } });
  }
  return { payloads };
}

function patchTool(a, directory, tool) {
  if (!isText(a.patchText)) return badArg(tool, 'patchText', 'a non-empty string');
  return parsePatch(tool, a.patchText, directory);
}

// The guard checks a command as if it runs in the project directory, so an argument that
// could change where or how it runs is not trusted. The set is closed because OpenCode's
// bash schema is not versioned with this guard (BUG-071). An empty command is the guard's
// to judge (it allows it), so only the type of command is checked.
const BASH_ARGS = new Set(['command', 'description', 'timeout']);
const BASH_ARG_REASON = 'not supported; the guard checks a command as if it runs in the project directory, so drop the argument and put any cd in the command, where the guard sees it';

function bashTool(a, _d, tool) {
  if (typeof a.command !== 'string') return badArg(tool, 'command', 'a string');
  const unknown = Object.keys(a).filter((k) => a[k] !== undefined && !BASH_ARGS.has(k)).sort();
  if (unknown.length === 0) return one('Bash', { command: a.command });
  const names = unknown.map((k) => `"${k}"`).join(', ');
  const which = unknown.length === 1 ? `argument ${names} is` : `arguments ${names} are`;
  return blocked(tool, `${which} ${BASH_ARG_REASON}`);
}

// The installer names the band agents conductor-<role>; the guard knows them by role.
const AGENT_PREFIX = 'conductor-';
const roleOf = (agent) => (agent.startsWith(AGENT_PREFIX) ? agent.slice(AGENT_PREFIX.length) : agent);

// OpenCode 1.19.6 FILE_REGEX (config/markdown.ts): a task prompt's @path is attached to the
// subagent without a tool call, so the file would bypass Guards 1 and 4.
const OC_FILE = /(?<![\w`])@(\.?[^\s`,.]*(?:\.[^\s`,.]+)*)/g;
const attaches = (text) => [...text.matchAll(OC_FILE)].some((m) => m[1]);

// Sent as Claude Code's Agent call, so Guard 6 sees a subagent dispatching (R7). task_id
// resumes a session whose recorded agent need not be the one it runs, so it is refused.
function taskTool(a, _d, tool) {
  if (!isText(a.subagent_type)) return badArg(tool, 'subagent_type', 'a non-empty string');
  if (!isText(a.prompt)) return badArg(tool, 'prompt', 'a non-empty string');
  if (a.task_id !== undefined) return blocked(tool, 'argument "task_id" resumes a session the guard cannot attribute to the agent it runs; start a new task instead');
  if (attaches(a.prompt)) return blocked(tool, 'the prompt has an @ reference, which OpenCode attaches without a tool call the guard could see; name the path without the @');
  return one('Agent', { subagent_type: roleOf(a.subagent_type), description: a.description, prompt: a.prompt });
}

// OpenCode tool name -> { payloads } for the guard, or { block } before any guard runs.
const MAPPED = {
  task: taskTool,
  bash: bashTool,
  read: (a, _d, t) => (isText(a.filePath) ? one('Read', { file_path: a.filePath, offset: a.offset, limit: a.limit }) : badArg(t, 'filePath', 'a non-empty string')),
  write: (a, _d, t) => (isText(a.filePath) ? one('Write', { file_path: a.filePath, content: a.content }) : badArg(t, 'filePath', 'a non-empty string')),
  edit: (a, _d, t) => (isText(a.filePath) ? one('Edit', { file_path: a.filePath, old_string: a.oldString, new_string: a.newString }) : badArg(t, 'filePath', 'a non-empty string')),
  multiedit: (a, _d, t) => {
    if (!isText(a.filePath)) return badArg(t, 'filePath', 'a non-empty string');
    if (!Array.isArray(a.edits) || a.edits.length === 0) return badArg(t, 'edits', 'a non-empty array');
    const payloads = [];
    for (const [i, e] of a.edits.entries()) {
      for (const k of ['oldString', 'newString']) {
        if (!e || typeof e[k] !== 'string') return badArg(t, `edits[${i}].${k}`, 'a string');
      }
      payloads.push({ tool_name: 'Edit', tool_input: { file_path: a.filePath, old_string: e.oldString, new_string: e.newString } });
    }
    return { payloads };
  },
  patch: patchTool,
  apply_patch: patchTool,
};

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

// task creates a subagent session with its agent and parent fixed (tool/task.ts), so only a
// session with a parent is cached; a primary session is looked up on every call, since the
// assumption is not checked for it. A failed lookup is never cached, so one transient error
// does not block the session for good. The cache holds one entry per subagent session.
function sessionLookup(client) {
  const cache = new Map();
  const canGet = Boolean(client && client.session && typeof client.session.get === 'function');
  return async (id) => {
    if (cache.has(id)) return cache.get(id);
    if (!canGet || !isText(id)) return null;
    let data = null;
    try { data = (await client.session.get({ path: { id } }))?.data ?? null; } catch { data = null; }
    if (data && data.parentID) cache.set(id, data);
    return data;
  };
}

// Claude Code sends a subagent's calls with its agent_type and the main session's id, and
// Guard 6 keys a run on that id. OpenCode gives a subagent its own session under a parent.
async function identify(getSession, sessionID) {
  const own = await getSession(sessionID);
  if (!own) return null;
  let rootId = sessionID;
  for (let parent = own.parentID, hops = 0; parent; hops++) {
    const next = hops < 32 ? await getSession(parent) : null;
    if (!next) return null;
    rootId = parent;
    parent = next.parentID;
  }
  const agent = own.agent;
  if (!own.parentID && !(isText(agent) && agent.startsWith(AGENT_PREFIX))) return { session_id: rootId };
  return isText(agent) ? { session_id: rootId, agent_type: roleOf(agent) } : null;
}

export const ConductorGuard = async ({ directory, client }) => {
  const guardPath = join(directory, GUARD_REL);
  const getSession = sessionLookup(client);
  return {
    'tool.execute.before': async (input, output) => {
      const tool = String(input && input.tool);
      if (READ_ONLY.has(tool)) return;
      if (!Object.hasOwn(MAPPED, tool)) throw new Error(uncovered(tool));
      const mapped = MAPPED[tool]((output && output.args) || {}, directory, tool);
      if (mapped.block) throw new Error(mapped.block);
      const who = await identify(getSession, input && input.sessionID);
      if (!who) throw new Error(IDENTIFY_REASON);
      // One guard run per payload; the first deny or ask blocks the whole call.
      for (const p of mapped.payloads) {
        const payload = { ...who, cwd: directory, hook_event_name: 'PreToolUse', ...p };
        const reason = readDecision(runGuard(guardPath, payload, directory), guardPath);
        if (reason) throw new Error(reason);
      }
    },
  };
};
