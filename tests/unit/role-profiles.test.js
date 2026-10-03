import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GATES, ROLES } from '../../scripts/snap-contract.mjs';
import { MAY_HAND_BACK, findAgent } from '../../scripts/orchestrate.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const TEMPLATE = 'project-template/.claude/agents';
const MIRROR = '.claude/agents';
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const profile = (role) => read(`${TEMPLATE}/${role}.md`);
const field = (text, key) => text.match(/^---\n([\s\S]*?)\n---\n/)[1].match(new RegExp(`^${key}:[ \\t]*(.*)$`, 'm'))?.[1];

// D2, verbatim. No mask carries Agent, SendMessage or NotebookEdit.
const MASKS = {
  spec: ['Read', 'Grep', 'Glob', 'Write', 'Edit'],
  plan: ['Read', 'Grep', 'Glob', 'Write', 'Edit'],
  code: ['Read', 'Grep', 'Glob', 'Write', 'Edit', 'Bash'],
  audit: ['Read', 'Grep', 'Glob'],
  qa: ['Read', 'Grep', 'Glob', 'Bash'],
};
// D5's five items, each pinned by a fixed phrase: the fixed success condition (two phrases),
// a denial means stop, one hand-back (two phrases), no dispatch, and the scope copy.
const D5 = [
  'Your success condition is fixed:',
  'Do not substitute a stricter or different standard of your own',
  'A hook or owner denial is an instruction to stop and report, never an obstacle to route around.',
  'Deliver exactly one report',
  'exactly one `SNAP_HANDBACK` line',
  'Never dispatch or message another agent.',
  'Copy `ops.scope` verbatim from your envelope into the hand-back; if your envelope has no scope, leave the key out.',
];
const SHELL = 'Run exactly the command named in the run file';
const NO_SHELL = 'You have no shell';
// Each role's Gate semantics row, by the sentence that states its claim.
const CLAIM = {
  spec: 'a spec file was written under `docs/superpowers/specs/` that answers the item',
  plan: 'a plan file was written under `docs/superpowers/plans/` from the approved spec, and each task names its files',
  code: 'after your last edit you ran the test command, and your report states its exact exit status and summary line',
  audit: 'a static review of the changes against the spec and plan was completed, and its findings are listed',
  qa: 'you ran the test command yourself and the suite passed',
};

describe('role agent profiles [FEAT-012]', () => {
  it('ships exactly the five ROLES in both agents directories', () => {
    for (const dir of [TEMPLATE, MIRROR]) expect(readdirSync(join(ROOT, dir)).sort()).toEqual(ROLES.map((r) => `${r}.md`).sort());
  });

  it.each(ROLES)('[AC1] %s names its role and carries the D2 mask exactly', (role) => {
    const text = profile(role);
    expect(field(text, 'name')).toBe(role);
    expect(field(text, 'tools').split(', ')).toEqual(MASKS[role]);
    expect(field(text, 'description')).toMatch(/\S/);
  });

  it.each(ROLES)('[AC2] %s is byte-identical in the .claude/agents mirror', (role) => {
    expect(read(`${MIRROR}/${role}.md`)).toBe(profile(role));
  });

  it.each(ROLES)('[AC3] %s measures at most 999 tokens as ceil(bytes / 4) over the whole file', (role) => {
    expect(Math.ceil(Buffer.byteLength(profile(role), 'utf8') / 4)).toBeLessThanOrEqual(999);
  });

  it.each(ROLES)('[AC4] %s carries every D5 item and the shell rule its mask implies', (role) => {
    const text = profile(role);
    for (const phrase of D5) expect(text).toContain(phrase);
    const shell = MASKS[role].includes('Bash');
    expect(text.includes(SHELL)).toBe(shell);
    expect(text.includes(NO_SHELL)).toBe(!shell);
  });

  it.each(ROLES)('[AC5] %s states its Gate semantics claim and names only the gates it may hand back', (role) => {
    const text = profile(role);
    expect(text).toContain(CLAIM[role]);
    for (const gate of MAY_HAND_BACK[role]) expect(text).toContain(`only the gate \`${gate}\``);
    for (const gate of GATES.filter((g) => !MAY_HAND_BACK[role].includes(g))) expect(text).not.toContain(gate);
  });

  it.each(ROLES)('findAgent resolves %s to its mirror, so ORCH_AGENT_MISSING cannot fire here', (role) => {
    const home = mkdtempSync(join(tmpdir(), 'cc-profiles-home-'));
    try { expect(findAgent(role, ROOT, home)).toBe(join(ROOT, MIRROR, `${role}.md`)); }
    finally { rmSync(home, { recursive: true, force: true }); }
  });
});

// FEAT-031 AC13: FEAT-031 changes no role profile. Each value was measured from v1.37.0 with
// `git show v1.37.0:<path>`; CI checks out no tags, so the hashes are pinned here. A later item
// that changes a profile on purpose updates its row in the same commit.
const PROFILE_SHA256_1_37_0 = {
  audit: '5bfeff19ef086a21d9a6df82dfe570540c55adb7fa5b08f4dbf34003230ad809',
  code: '21b7697ef9317a7aca89dd3e99623208d6541cf7c794712ff2a76e4d0bb0c604',
  plan: '3f1c61b66519fce290821d79d3691f2883ca2d2d93c924b1e87dec8768f96913',
  qa: '19194c34cfc43b7886ef0a63a30e07cd8f633330bf298265eb55a4be4b224644',
  spec: '819553795a7b65a438a2911a4326baa2a19efa372ac2ff387eb11f6cef3b2096',
};

describe('profiles unchanged since 1.37.0 [FEAT-031 AC13]', () => {
  const rows = [TEMPLATE, MIRROR].flatMap((dir) => Object.keys(PROFILE_SHA256_1_37_0).map((role) => [`${dir}/${role}.md`, role]));
  it.each(rows)('%s has its 1.37.0 sha256', (rel, role) => {
    expect(createHash('sha256').update(read(rel)).digest('hex')).toBe(PROFILE_SHA256_1_37_0[role]);
  });
});
