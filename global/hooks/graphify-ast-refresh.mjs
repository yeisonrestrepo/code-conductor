#!/usr/bin/env node
// UserPromptSubmit hook: Node wrapper over the Python AST-refresh payload.
//
// Node hosts the decision because Python is the thing being probed: a Python
// script cannot report that Python is missing. Every path exits 0 and prints
// nothing unless CC_GRAPHIFY_DEBUG is set (the CC_VERBOSITY_DEBUG and
// CC_GUARD4_DEBUG precedent), so a machine without the toolchain is silent.

import { statSync, accessSync, constants } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK_DIR = dirname(fileURLToPath(import.meta.url));
const PAYLOAD = join(HOOK_DIR, 'graphify-ast-refresh.py');

function debug(msg) {
  if (process.env.CC_GRAPHIFY_DEBUG) process.stderr.write(`GRAPHIFY_HOOK: ${msg}\n`);
}

// Mirrors the payload's int(os.environ.get("GRAPHIFY_STALE_MINUTES", "60")) and
// its ValueError fallback. Python's int() accepts surrounding whitespace and a
// sign and rejects everything else, while parseInt would read "120abc" as 120;
// the regex keeps the two readers of this variable in agreement.
function staleMinutes() {
  const raw = process.env.GRAPHIFY_STALE_MINUTES;
  if (typeof raw !== 'string' || !/^\s*[+-]?\d+\s*$/.test(raw)) return 60;
  return Number.parseInt(raw, 10);
}

function isFresh(cwd) {
  try {
    const { mtimeMs } = statSync(join(cwd, 'graphify-out', '.graphify_ast_done'));
    return (Date.now() - mtimeMs) / 60000 < staleMinutes();
  } catch {
    return false; // absent or unreadable sentinel counts as stale
  }
}

function isExecutableFile(candidate) {
  try {
    if (!statSync(candidate).isFile()) return false;
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// A PATH scan, never an execution: starting an interpreter to learn whether an
// interpreter exists is the cost this hook is meant to avoid, and it is the
// reason no negative cache is needed.
function resolveInterpreter() {
  const override = process.env.GRAPHIFY_PYTHON;
  if (override && isExecutableFile(override)) return override;
  const exts = process.platform === 'win32' ? ['.exe', '.bat', '.cmd'] : [''];
  const dirs = (process.env.PATH || '').split(delimiter).filter(Boolean);
  for (const name of ['python3', 'python']) {
    for (const dir of dirs) {
      for (const ext of exts) {
        const candidate = join(dir, `${name}${ext}`);
        if (isExecutableFile(candidate)) return candidate;
      }
    }
  }
  return null;
}

function main() {
  const cwd = process.cwd();
  if (isFresh(cwd)) return;
  const python = resolveInterpreter();
  if (!python) {
    debug('no python3 or python on PATH; graph refresh skipped');
    return;
  }
  // Detached with stdio ignored and unref'd: the child's exit status can never
  // surface as a hook error, which is what keeps the `import graphify` guard in
  // the payload where it already lives.
  const child = spawn(python, [PAYLOAD], { cwd, detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', (e) => debug(`spawn failed: ${e.message}`));
  child.unref();
}

// No explicit process.exit: the unref'd child holds nothing open, so the default
// exit code 0 stands, and the deferred 'error' event above still gets to fire.
try {
  main();
} catch (e) {
  debug(`unexpected: ${e && e.message}`);
}
