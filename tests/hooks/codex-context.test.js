import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASH } from '../helpers/bash.js';

// FEAT-048 slice 5 (#97): Codex drops a prompt-submit reply that starts with `[`, so the
// adapter runs the project's unchanged context hooks and answers in JSON.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const TEMPLATE = join(REPO_ROOT, 'project-template');
const PAYLOAD = JSON.stringify({
  session_id: 'probe-session-1', turn_id: 't1', cwd: 'x', hook_event_name: 'UserPromptSubmit', prompt: 'hi',
});

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cc-codex-ctx-'));
  mkdirSync(join(dir, '.codex', 'hooks'), { recursive: true });
  mkdirSync(join(dir, '.claude', 'hooks'), { recursive: true });
  copyFileSync(join(TEMPLATE, '.codex', 'hooks', 'conductor-context.mjs'), join(dir, '.codex', 'hooks', 'conductor-context.mjs'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const shipHook = (name) => copyFileSync(join(TEMPLATE, '.claude', 'hooks', name), join(dir, '.claude', 'hooks', name));
const fakeHook = (name, body) => writeFileSync(join(dir, '.claude', 'hooks', name), `#!/usr/bin/env bash\n${body}\n`);
const run = (input = PAYLOAD) => spawnSync(process.execPath, [join(dir, '.codex', 'hooks', 'conductor-context.mjs')], {
  cwd: dir, input, encoding: 'utf8', timeout: 60000, env: { ...process.env, HOME: dir, USERPROFILE: dir },
});
const contextOf = (res) => JSON.parse(res.stdout).hookSpecificOutput;

describe.skipIf(!BASH)('Codex context adapter', () => {
  it('turns the shipped verbosity line into Codex JSON context', () => {
    shipHook('verbosity-remind.sh');
    shipHook('context-guard.sh');
    const res = run();
    expect(res.status).toBe(0);
    const out = contextOf(res);
    expect(out.hookEventName).toBe('UserPromptSubmit');
    expect(out.additionalContext).toMatch(/^\[VERBOSITY:MIN\]/);
  });
  it('joins both hooks\' output in order, each trimmed', () => {
    fakeHook('verbosity-remind.sh', 'printf "\\n[V] one\\n"');
    fakeHook('context-guard.sh', 'printf "two\\n"');
    expect(contextOf(run()).additionalContext).toBe('[V] one\ntwo');
  });
  it('passes the payload on stdin and the project root to the hooks', () => {
    fakeHook('verbosity-remind.sh', 'cat >/dev/null');
    fakeHook('context-guard.sh', 'grep -q probe-session-1 && printf "root=%s" "$(basename "$CC_PROJECT_ROOT")"');
    expect(contextOf(run()).additionalContext).toBe(`root=${dir.split(/[\\/]/).pop()}`);
  });
  it('skips a hook that exits non-zero and keeps the other', () => {
    fakeHook('verbosity-remind.sh', 'echo bad; exit 3');
    fakeHook('context-guard.sh', 'echo good');
    expect(contextOf(run()).additionalContext).toBe('good');
  });
  it('prints nothing when no hook gives output or the hooks are missing', () => {
    expect(run().stdout).toBe('');
    fakeHook('verbosity-remind.sh', 'true');
    const res = run();
    expect(res.status).toBe(0);
    expect(res.stdout).toBe('');
  });
  it('prints nothing for stdin that is not JSON', () => {
    fakeHook('verbosity-remind.sh', 'echo text');
    const res = run('not json');
    expect(res.status).toBe(0);
    expect(res.stdout).toBe('');
  });
});
