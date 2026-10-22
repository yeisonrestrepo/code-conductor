import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fakeGh } from '../helpers/fake-gh.js';

// --version only: a red run, before the guard exists, reaches nothing that writes.
const CALL_GH = "import { spawnSync } from 'node:child_process'; const r = spawnSync('gh', ['--version'], { encoding: 'utf8' }); process.stdout.write(String(r.status));";
const node = (code, env = process.env) => spawnSync(process.execPath, ['--input-type=module', '-e', code], { env, encoding: 'utf8' });

describe('[BUG-059] the fake gh resolves on every platform', () => {
  it('routes a gh call to the fake through fakeGh().env(), leaving PATH alone', () => {
    const gh = fakeGh({});
    try {
      const env = gh.env();
      expect(env.PATH).toBe(process.env.PATH);
      const r = node(CALL_GH, env);
      expect(r.stderr).not.toMatch(/CC_REAL_GH_BLOCKED/);
      expect(gh.calls()).toEqual([['--version']]);
    } finally { gh.cleanup(); }
  });
});
