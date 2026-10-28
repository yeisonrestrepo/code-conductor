// The bash suites hand bash a script by its native absolute path. `bash --version` is not
// enough: on Windows the WSL launcher passes it, then exits 127 on `bash C:\...\hook.sh`
// because it drops the backslashes. So a candidate counts only if it runs a probe script
// that way, and on win32 Git for Windows' bash is tried when the PATH one cannot (#92).
// No vitest import here: the global setup loads this in the main process.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// `git --exec-path` is <git>/mingw64/libexec/git-core; bash lives at <git>/bin/bash.exe.
export function gitForWindowsBash() {
  if (process.platform !== 'win32') return null;
  const r = spawnSync('git', ['--exec-path'], { encoding: 'utf8', timeout: 5000 });
  if (r.status !== 0) return null;
  return resolve(r.stdout.trim(), '../../../bin/bash.exe');
}

function runsScript(bash, script) {
  const r = spawnSync(bash, [script], { encoding: 'utf8', timeout: 10000 });
  return r.status === 0 && (r.stdout ?? '').trim() === 'ok';
}

export function findBash(candidates) {
  const dir = mkdtempSync(join(tmpdir(), 'cc-bash-probe-'));
  try {
    const script = join(dir, 'probe.sh');
    writeFileSync(script, 'echo ok\n');
    return candidates.find((bash) => bash && runsScript(bash, script)) ?? null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function probeBash() {
  return findBash(['bash', gitForWindowsBash()]);
}
