import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
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

describe('[BUG-059] the real gh is unreachable from a test', () => {
  it('kills a node child that names gh without a fake, with a named error', () => {
    const r = node(CALL_GH);
    expect(r.status).toBe(97);
    expect(r.stderr).toMatch(/^CC_REAL_GH_BLOCKED: /);
    expect(r.stdout).toBe('');
  });

  it('kills a node grandchild too, because NODE_OPTIONS is inherited', () => {
    const hop = `import { spawnSync } from 'node:child_process'; const r = spawnSync(process.execPath, ['--input-type=module', '-e', ${JSON.stringify(CALL_GH)}], { encoding: 'utf8' }); process.stderr.write(r.stderr); process.exitCode = r.status;`;
    const r = node(hop);
    expect(r.status).toBe(97);
    expect(r.stderr).toMatch(/^CC_REAL_GH_BLOCKED: /);
  });

  it('blocks gh in the test worker itself, by name and by an .exe path', () => {
    expect(() => spawnSync('gh', ['--version'])).toThrow(/97/);
    expect(() => execFileSync('C:/Program Files/GitHub CLI/gh.exe', ['--version'])).toThrow(/97/);
  });

  it('strands any path the preload cannot see with no gh credentials', () => {
    for (const key of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN']) expect(process.env[key]).toBeUndefined();
    expect(readdirSync(process.env.GH_CONFIG_DIR)).toEqual([]);
  });
});
