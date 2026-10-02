// Provide a clean environment for git commands in test fixtures.
// When tests run from a linked worktree's pre-commit hook, git hands
// absolute GIT_DIR and GIT_INDEX_FILE that aim every child git process
// at the real repository. This helper strips those variables so fixture
// git commands operate only on their own temp directories.
//
// See BUG-053 for the full incident report.

const GIT_ENV_KEYS = [
  'GIT_DIR',
  'GIT_INDEX_FILE',
  'GIT_WORK_TREE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
];

export function cleanGitEnv() {
  const env = { ...process.env };
  for (const key of GIT_ENV_KEYS) delete env[key];
  return env;
}
