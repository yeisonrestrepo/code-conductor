// BUG-059: loaded into every node process of a test run through NODE_OPTIONS --import, it owns
// each child_process call that names gh. A PATH wrapper cannot do this on Windows: libuv runs
// neither an extensionless script nor a .cmd without a shell, so it resolves the real gh.exe.
// With FAKE_GH_STATE the call runs the fake under this node; without it, it would reach the real,
// possibly logged-in gh, so the process dies first with a named error.
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('./fake-gh-cli.mjs', import.meta.url));
// vitest re-runs setup files per test file in one worker; the mark keeps the wrap single.
const WRAPPED = Symbol.for('code-conductor.gh-intercept');
const namesGh = (file) => typeof file === 'string' && /^gh(\.exe)?$/i.test(basename(file));

function realGhBlocked() {
  process.stderr.write('CC_REAL_GH_BLOCKED: a test reached for the real gh; route it through fakeGh().env()\n');
  process.exit(97);
}

function wrap(original) {
  const wrapped = function (file, args, ...rest) {
    if (!namesGh(file)) return original.call(this, file, args, ...rest);
    if (!process.env.FAKE_GH_STATE) realGhBlocked();
    if (!Array.isArray(args)) [args, rest] = [[], [args, ...rest]];
    return original.call(this, process.execPath, [CLI, ...args], ...rest);
  };
  wrapped[WRAPPED] = true;
  return wrapped;
}

for (const name of ['spawn', 'spawnSync', 'execFile', 'execFileSync']) {
  if (!childProcess[name][WRAPPED]) childProcess[name] = wrap(childProcess[name]);
}
// An ESM named import (ticket.mjs:8) reads the builtin's snapshot; this refreshes it.
syncBuiltinESMExports();
