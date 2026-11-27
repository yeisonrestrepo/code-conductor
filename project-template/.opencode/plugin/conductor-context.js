// code-conductor context plugin for OpenCode, FEAT-048 slice 7 (issue #97).
// Claude Code runs two UserPromptSubmit hooks on every prompt: verbosity-remind.sh and
// context-guard.sh. This runs the project's unchanged copies from chat.message and adds their
// output as one synthetic text part, which was measured on 1.19.6 to reach the model and stay
// out of what the user is shown to have typed. Fail open: the hooks only advise, so a missing
// hook, bash or timeout, or any error, adds nothing and never blocks the message.
// It repeats the Codex adapter's hook runner on purpose: each harness's files install alone.
// Zero dependencies by design; node: builtins only.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const HOOK_TIMEOUT_MS = 10000;
const HOOKS = ['verbosity-remind.sh', 'context-guard.sh'];
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

// On Windows the `bash` on PATH may be the WSL launcher, which cannot run a native path
// (BUG-062). Git for Windows keeps bash.exe three levels above its exec path
// (<root>/mingw64/libexec/git-core), as tests/helpers/bash-probe.js assumes.
function findBash() {
  if (process.platform !== 'win32') return 'bash';
  const git = spawnSync('git', ['--exec-path'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
  const gitBash = git.status === 0 ? resolve(git.stdout.trim(), '../../../bin/bash.exe') : null;
  return gitBash && existsSync(gitBash) ? gitBash : 'bash';
}

function runHook(bash, root, name, input) {
  const rel = `.claude/hooks/${name}`;
  if (!existsSync(join(root, rel))) return '';
  const res = spawnSync(bash, [rel], {
    cwd: root,
    input,
    encoding: 'utf8',
    timeout: HOOK_TIMEOUT_MS,
    windowsHide: true,
    env: { ...process.env, CC_PROJECT_ROOT: root, CLAUDE_PROJECT_DIR: root },
  });
  return res.status === 0 ? (res.stdout || '').trim() : '';
}

// OpenCode's own part id shape (id/id.ts): prt_, 12 hex digits of time*0x1000, 14 base62.
let lastMs = 0;
let counter = 0;
function partId() {
  const ms = Date.now();
  counter = ms === lastMs ? counter + 1 : 1;
  lastMs = ms;
  const time = (BigInt(ms) * 0x1000n + BigInt(counter)).toString(16).padStart(12, '0').slice(-12);
  const tail = [...randomBytes(14)].map((b) => BASE62[b % 62]).join('');
  return `prt_${time}${tail}`;
}

// Claude Code runs UserPromptSubmit only for the user's prompt, while chat.message also fires
// for the prompt task sends a subagent. A failed lookup counts as the user's own session.
async function isSubagent(client, id) {
  if (!client || !client.session || typeof client.session.get !== 'function') return false;
  try { return Boolean((await client.session.get({ path: { id } }))?.data?.parentID); } catch { return false; }
}

const promptText = (parts) => parts.filter((p) => p && p.type === 'text' && !p.synthetic).map((p) => p.text).join('\n');

export const ConductorContext = async ({ directory, client }) => ({
  'chat.message': async (input, output) => {
    try {
      const { message, parts } = output;
      const sessionID = message.sessionID;
      if (await isSubagent(client, sessionID)) return;
      const payload = JSON.stringify({ session_id: sessionID, cwd: directory, hook_event_name: 'UserPromptSubmit', prompt: promptText(parts) });
      const bash = findBash();
      const text = HOOKS.map((name) => runHook(bash, directory, name, payload)).filter(Boolean).join('\n');
      if (!text) return;
      parts.push({ id: partId(), sessionID, messageID: message.id, type: 'text', synthetic: true, text });
    } catch {
      // Advisory only: the message goes on unchanged.
    }
  },
});
