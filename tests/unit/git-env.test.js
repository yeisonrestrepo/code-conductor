import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanGitEnv } from '../helpers/git-env.js';

// BUG-053 AC2: a linked-worktree hook hands every child an absolute GIT_DIR. The decoy
// stands in for the real repository; the fixture is what a test believes it is writing.
const trees = [];
afterEach(() => { while (trees.length) rmSync(trees.pop(), { recursive: true, force: true }); });

function setup() {
  const decoy = mkdtempSync(join(tmpdir(), 'git-env-decoy-'));
  const fixture = mkdtempSync(join(tmpdir(), 'git-env-fixture-'));
  trees.push(decoy, fixture);
  execFileSync('git', ['init', '-q'], { cwd: decoy, env: cleanGitEnv() });
  const leaked = { ...process.env, GIT_DIR: join(decoy, '.git'), GIT_INDEX_FILE: join(decoy, '.git', 'index') };
  const state = () => readFileSync(join(decoy, '.git', 'config'), 'utf8')
    + execFileSync('git', ['for-each-ref'], { cwd: decoy, env: cleanGitEnv(), encoding: 'utf8' });
  return { decoy, fixture, leaked, state };
}

function fixtureGit(fixture, env) {
  for (const args of [['init', '-q'], ['config', 'user.name', 'T'], ['config', 'user.email', 't@t.t']]) {
    execFileSync('git', args, { cwd: fixture, env, stdio: 'ignore' });
  }
}

describe('cleanGitEnv [BUG-053 AC2]', () => {
  it('reproduces the leak: an unscrubbed fixture git writes into the decoy', () => {
    const { fixture, leaked, state } = setup();
    const before = state();
    fixtureGit(fixture, leaked);
    expect(state()).not.toBe(before);
    expect(state()).toContain('name = T');
    expect(existsSync(join(fixture, '.git'))).toBe(false);
  });

  it('closes the leak: with cleanGitEnv the decoy stays byte-identical', () => {
    const { fixture, leaked, state } = setup();
    const before = state();
    fixtureGit(fixture, cleanGitEnv(leaked));
    expect(state()).toBe(before);
    expect(existsSync(join(fixture, '.git'))).toBe(true);
  });
});
