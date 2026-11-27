#!/usr/bin/env node
// code-conductor context adapter for the Codex CLI, FEAT-048 slice 5.
// Codex reads a UserPromptSubmit reply that starts with `[` as JSON and drops it, which is
// how verbosity-remind.sh's line begins, so this runs the project's unchanged context hooks
// and answers in the JSON shape measured to land as developer context. The root comes from
// THIS file's location (the BUG-094 bootstrap finds it). Fail open: these hooks are advisory,
// so a missing hook, bash or timeout adds nothing and never blocks the prompt.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HOOK_TIMEOUT_MS = 10000;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HOOKS = ['verbosity-remind.sh', 'context-guard.sh'];

// On Windows the `bash` on PATH may be the WSL launcher, which cannot run a native path
// (BUG-062); Git for Windows' bash, found as the test suite finds it, can.
function findBash() {
  if (process.platform !== 'win32') return 'bash';
  const git = spawnSync('git', ['--exec-path'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
  const gitBash = git.status === 0 ? resolve(git.stdout.trim(), '../../../bin/bash.exe') : null;
  return gitBash && existsSync(gitBash) ? gitBash : 'bash';
}

function runHook(bash, name, input) {
  const rel = `.claude/hooks/${name}`;
  if (!existsSync(join(ROOT, rel))) return '';
  const res = spawnSync(bash, [rel], {
    cwd: ROOT,
    input,
    encoding: 'utf8',
    timeout: HOOK_TIMEOUT_MS,
    windowsHide: true,
    env: { ...process.env, CC_PROJECT_ROOT: ROOT, CLAUDE_PROJECT_DIR: ROOT },
  });
  return res.status === 0 ? (res.stdout || '').trim() : '';
}

export function contextFor(input) {
  try { JSON.parse(input); } catch { return ''; }
  const bash = findBash();
  return HOOKS.map((name) => runHook(bash, name, input)).filter(Boolean).join('\n');
}

export function main() {
  let context = '';
  try { context = contextFor(readFileSync(0, 'utf8')); } catch { context = ''; }
  if (!context) return;
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: context } }));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main();
