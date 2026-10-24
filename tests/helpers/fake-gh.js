// Installs the fake gh (FEAT-031 T1) for one test. The gh-intercept preload serves it, so it
// resolves identically on Linux, macOS and Windows and needs no wrapper on PATH (BUG-059).
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A file URL, not a path: --import rejects a Windows path (BUG-058 cause 2).
export const GH_HOOK = `--import=${new URL('./gh-intercept.mjs', import.meta.url).href}`;

export const issue = (repo, number, over = {}) => ({
  number, title: `Issue ${number}`, body: `Requirements for ${number}.\n`, state: 'open',
  html_url: `https://github.com/${repo}/issues/${number}`, ...over,
});
export const pull = (repo, number) => ({
  ...issue(repo, number), html_url: `https://github.com/${repo}/pull/${number}`, pull_request: { url: 'x' },
});

const withHook = (options = '') => (options.includes(GH_HOOK) ? options : `${options} ${GH_HOOK}`.trim());

export function fakeGh(state) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'cc-fake-gh-')));
  const statePath = join(dir, 'state.json');
  const logPath = join(dir, 'log.jsonl');
  writeFileSync(statePath, JSON.stringify({ cwdRepo: 'acme/widgets', login: 'owner', issues: {}, comments: {}, ...state }));
  return {
    env: (base = process.env) => ({ ...base, NODE_OPTIONS: withHook(base.NODE_OPTIONS), FAKE_GH_STATE: statePath, FAKE_GH_LOG: logPath }),
    calls: () => (existsSync(logPath) ? readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []),
    state: () => JSON.parse(readFileSync(statePath, 'utf8')),
    update: (patch) => writeFileSync(statePath, JSON.stringify({ ...JSON.parse(readFileSync(statePath, 'utf8')), ...patch })),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
