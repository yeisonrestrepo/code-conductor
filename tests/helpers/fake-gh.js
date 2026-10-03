// Installs the fake gh (FEAT-031 T1) first on PATH for one test. POSIX only: there is no
// Windows CI leg (test.yml:11, publish.yml:9), so the wrapper is a sh script.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = join(dirname(fileURLToPath(import.meta.url)), 'fake-gh-cli.mjs');

export const issue = (repo, number, over = {}) => ({
  number, title: `Issue ${number}`, body: `Requirements for ${number}.\n`, state: 'open',
  html_url: `https://github.com/${repo}/issues/${number}`, ...over,
});
export const pull = (repo, number) => ({
  ...issue(repo, number), html_url: `https://github.com/${repo}/pull/${number}`, pull_request: { url: 'x' },
});

export function fakeGh(state) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'cc-fake-gh-')));
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'gh'), `#!/bin/sh\nexec "${process.execPath}" "${CLI}" "$@"\n`, { mode: 0o755 });
  const statePath = join(dir, 'state.json');
  const logPath = join(dir, 'log.jsonl');
  writeFileSync(statePath, JSON.stringify({ cwdRepo: 'acme/widgets', login: 'owner', issues: {}, comments: {}, ...state }));
  return {
    env: (base = process.env) => ({ ...base, PATH: `${bin}${delimiter}${base.PATH}`, FAKE_GH_STATE: statePath, FAKE_GH_LOG: logPath }),
    calls: () => (existsSync(logPath) ? readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []),
    state: () => JSON.parse(readFileSync(statePath, 'utf8')),
    update: (patch) => writeFileSync(statePath, JSON.stringify({ ...JSON.parse(readFileSync(statePath, 'utf8')), ...patch })),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
