import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BASH } from '../helpers/bash.js';

// FEAT-048 slice 7 (#97): OpenCode's chat.message hook runs the project's unchanged context
// hooks and adds their output as one synthetic part, measured to reach the model on 1.19.6.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const TEMPLATE = join(REPO_ROOT, 'project-template');
const PLUGIN = join(TEMPLATE, '.opencode', 'plugin', 'conductor-context.js');

const SESSIONS = {
  ses_main: { id: 'ses_main', agent: 'build' },
  ses_child: { id: 'ses_child', agent: 'conductor-audit', parentID: 'ses_main' },
};
const fakeClient = { session: { get: async ({ path: { id } }) => (SESSIONS[id] ? { data: SESSIONS[id] } : { error: {} }) } };

let plugin, dir, savedEnv;
beforeAll(async () => { plugin = await import(pathToFileURL(PLUGIN).href); });
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cc-opencode-ctx-'));
  mkdirSync(join(dir, '.claude', 'hooks'), { recursive: true });
  // verbosity-remind.sh reads the user's level from HOME; an empty HOME means the default.
  savedEnv = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.HOME = dir;
  process.env.USERPROFILE = dir;
});
afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  rmSync(dir, { recursive: true, force: true });
});

const shipHook = (name) => copyFileSync(join(TEMPLATE, '.claude', 'hooks', name), join(dir, '.claude', 'hooks', name));
const fakeHook = (name, body) => writeFileSync(join(dir, '.claude', 'hooks', name), `#!/usr/bin/env bash\n${body}\n`);

// Drives the hook the way OpenCode's session/prompt.ts does, and returns the parts after it.
async function send({ sessionID = 'ses_main', text = 'hi there', client = fakeClient } = {}) {
  const hooks = await plugin.ConductorContext({ directory: dir, worktree: dir, client });
  const message = { id: 'msg_1', role: 'user', sessionID };
  const parts = [{ id: 'prt_000000000001aaaaaaaaaaaaaa', type: 'text', text, sessionID, messageID: 'msg_1' }];
  await hooks['chat.message']({ sessionID }, { message, parts });
  return parts;
}
const added = (parts) => parts.slice(1);

describe('OpenCode context plugin: module shape (AC6)', () => {
  it('exports the plugin and nothing else', () => {
    expect(Object.keys(plugin)).toEqual(['ConductorContext']);
  });
  it('registers only chat.message', async () => {
    const hooks = await plugin.ConductorContext({ directory: dir, worktree: dir, client: fakeClient });
    expect(Object.keys(hooks)).toEqual(['chat.message']);
  });
});

describe.skipIf(!BASH)('OpenCode context plugin', () => {
  it('adds the shipped verbosity line as one synthetic part (AC1)', async () => {
    shipHook('verbosity-remind.sh');
    shipHook('context-guard.sh');
    const extra = added(await send());
    expect(extra).toHaveLength(1);
    expect(extra[0]).toMatchObject({ type: 'text', synthetic: true, sessionID: 'ses_main', messageID: 'msg_1' });
    expect(extra[0].text).toMatch(/^\[VERBOSITY:MIN\]/);
    expect(extra[0].id).toMatch(/^prt_[0-9a-f]{12}[0-9A-Za-z]{14}$/);
  });
  it('joins both hooks\' output in order, each trimmed (AC2)', async () => {
    fakeHook('verbosity-remind.sh', 'printf "\\n[V] one\\n"');
    fakeHook('context-guard.sh', 'printf "two\\n"');
    expect(added(await send())[0].text).toBe('[V] one\ntwo');
  });
  it('passes the session, the prompt text and the project root to the hooks (AC2)', async () => {
    fakeHook('verbosity-remind.sh', 'cat >/dev/null');
    fakeHook('context-guard.sh', 'in=$(cat); case "$in" in *\'"session_id":"ses_main"\'*\'"prompt":"hi there"\'*) printf "root=%s" "$(basename "$CC_PROJECT_ROOT")";; esac');
    expect(added(await send())[0].text).toBe(`root=${dir.split(/[\\/]/).pop()}`);
  });
  it('skips a hook that exits non-zero and keeps the other (AC3)', async () => {
    fakeHook('verbosity-remind.sh', 'echo bad; exit 3');
    fakeHook('context-guard.sh', 'echo good');
    expect(added(await send())[0].text).toBe('good');
  });
  it('adds nothing when the hooks are missing or print nothing (AC3)', async () => {
    expect(added(await send())).toEqual([]);
    fakeHook('verbosity-remind.sh', 'true');
    expect(added(await send())).toEqual([]);
  });
  it('adds nothing to a subagent\'s prompt (AC4)', async () => {
    fakeHook('verbosity-remind.sh', 'echo v');
    expect(added(await send({ sessionID: 'ses_child' }))).toEqual([]);
  });
  it('still adds the line when the session lookup fails or there is no client (AC4)', async () => {
    fakeHook('verbosity-remind.sh', 'echo v');
    const throwing = { session: { get: async () => { throw new Error('offline'); } } };
    expect(added(await send({ client: throwing }))[0].text).toBe('v');
    expect(added(await send({ client: null }))[0].text).toBe('v');
    expect(added(await send({ sessionID: 'ses_unknown' }))[0].text).toBe('v');
  });
});

describe('OpenCode context plugin: fails open (AC5)', () => {
  it('never throws out of chat.message, even on malformed output', async () => {
    const hooks = await plugin.ConductorContext({ directory: dir, worktree: dir, client: fakeClient });
    await expect(hooks['chat.message']({ sessionID: 'ses_main' }, {})).resolves.toBeUndefined();
    await expect(hooks['chat.message'](undefined, undefined)).resolves.toBeUndefined();
  });
});
