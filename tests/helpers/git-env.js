// Provide a clean environment for git commands in test fixtures.
// When tests run from a linked worktree's pre-commit hook, git hands
// absolute GIT_DIR and GIT_INDEX_FILE that aim every child git process
// at the real repository. This helper strips those variables so fixture
// git commands operate only on their own temp directories.
//
// See BUG-053 for the full incident report.

import { execFileSync } from 'node:child_process';

// The list is git's own, so it cannot go stale. There is no fallback list: a
// silent partial scrub would let a leaking test pass, and a suite without a
// working git cannot run its fixtures anyway.
function localEnvVars() {
  try {
    return execFileSync('git', ['rev-parse', '--local-env-vars'], { encoding: 'utf8' })
      .split('\n').filter(Boolean);
  } catch (err) {
    throw new Error(`cleanGitEnv: \`git rev-parse --local-env-vars\` failed, so the GIT_* scrub list is unknown: ${err.message}`);
  }
}

let keys;

export function cleanGitEnv(base = process.env) {
  keys ??= localEnvVars();
  const env = { ...base };
  for (const key of keys) delete env[key];
  return env;
}
