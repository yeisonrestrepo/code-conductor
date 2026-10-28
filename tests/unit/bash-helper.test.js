import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BASH, findBash, gitForWindowsBash } from '../helpers/bash.js';

// The property the bash suites need is running a script by its native path, which the
// WSL launcher fails (exit 127) while still passing `bash --version` (#92).
describe('bash helper', () => {
  it('rejects a candidate that does not exist', () => {
    expect(findBash(['cc-no-such-bash-062'])).toBeNull();
  });

  it('rejects a candidate that runs but cannot execute the probe script', () => {
    expect(findBash([process.execPath])).toBeNull();
  });

  it.skipIf(!BASH)('the chosen bash runs a script given by its native absolute path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cc-bash-helper-'));
    try {
      const script = join(dir, 'hello.sh');
      writeFileSync(script, 'echo hello\n');
      const r = spawnSync(BASH, [script], { encoding: 'utf8', timeout: 10000 });
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe('hello');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  const gitBash = gitForWindowsBash();
  // The first candidate stands in for the WSL launcher: it exists and runs, but cannot
  // run the probe script. The fallback must be the one chosen, not merely some bash.
  it.skipIf(!gitBash || !existsSync(gitBash))('falls back to Git for Windows bash rather than skipping', () => {
    expect(findBash([process.execPath, gitBash])).toBe(gitBash);
    expect(BASH).not.toBeNull();
  });
});
