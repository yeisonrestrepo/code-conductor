import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run as runCli } from '../../bin/code-conductor.mjs';
import { CONSENT_PROMPT } from '../../lib/installer/frontend-skills.mjs';

let home, cwd, logs, superpowersSpawns, frontendSpawns, asked;
const log = (stream, msg) => logs.push(`${stream}:${msg}`);
const stderrLines = () => logs.filter((l) => l.startsWith('stderr:')).map((l) => l.slice('stderr:'.length));
const asType = (type) => () => ({ type });
const CHOICE_FILE = () => join(cwd, '.claude', 'frontend-skills.json');
const UIPRO_DIR = () => join(cwd, '.claude', 'skills', 'ui-ux-pro-max');

// Every run is hermetic: the superpowers spawn and the frontend spawn are recorders, and the
// superpowers question is answered no, so nothing prompts or reaches a real CLI.
const exited = (status) => () => { frontendSpawns.push([]); return { status, signal: null }; };
function run(argv, { classify = asType('frontend'), frontendSpawn = exited(0), isInteractive = false, frontendAnswer = '', ...rest } = {}) {
  const ask = (question) => {
    asked.push({ question, settingsExisted: existsSync(join(cwd, '.claude', 'settings.json')) });
    return question.endsWith(CONSENT_PROMPT) ? frontendAnswer : 'n';
  };
  const spawn = (...args) => { superpowersSpawns.push(args); return { status: 1 }; };
  return runCli(argv, { HOME: home }, { cwd, log, isInteractive, ask, spawn, classify, frontendSpawn, platform: 'linux', ...rest });
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'cc-fs-h-'));
  cwd = mkdtempSync(join(tmpdir(), 'cc-fs-c-'));
  logs = [];
  superpowersSpawns = [];
  frontendSpawns = [];
  asked = [];
});
afterEach(() => {
  expect(superpowersSpawns).toEqual([]);
  rmSync(home, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

describe('the frontend skills offer through run()', () => {
  it('C1 asks after the project deploy and installs on an empty answer', () => {
    const rc = run(['--project'], { isInteractive: true });
    const question = asked.find((a) => a.question.endsWith(CONSENT_PROMPT));
    expect(question.settingsExisted).toBe(true);
    expect(frontendSpawns).toHaveLength(3);
    expect(rc).toBe(0);
  });

  it('C2 offers nothing on a backend project', () => {
    expect(run(['--project'], { classify: asType('backend'), isInteractive: true })).toBe(0);
    expect(asked.some((a) => a.question.endsWith(CONSENT_PROMPT))).toBe(false);
    expect(frontendSpawns).toEqual([]);
    expect(existsSync(CHOICE_FILE())).toBe(false);
  });

  it('C3 offers nothing on a library project', () => {
    expect(run(['--project'], { classify: asType('library'), isInteractive: true })).toBe(0);
    expect(asked.some((a) => a.question.endsWith(CONSENT_PROMPT))).toBe(false);
    expect(frontendSpawns).toEqual([]);
    expect(existsSync(CHOICE_FILE())).toBe(false);
  });

  it('C4 does not take --with-plugins as consent for the frontend skills', () => {
    run(['--project', '--with-plugins'], { classify: asType('frontend') });
    expect(frontendSpawns).toEqual([]);
    expect(superpowersSpawns).toHaveLength(1); // --with-plugins is its own consent, for superpowers only
    superpowersSpawns.length = 0;
  });

  it('C5 installs on --with-frontend-skills without asking, on a fullstack project', () => {
    run(['--project', '--with-frontend-skills'], { classify: asType('fullstack') });
    expect(frontendSpawns).toHaveLength(3);
    expect(asked.some((a) => a.question.endsWith(CONSENT_PROMPT))).toBe(false);
  });

  it('C6 lists the flag in the usage line', () => {
    run(['--help']);
    expect(logs.find((l) => l.startsWith('stdout:Usage:'))).toContain('[--with-frontend-skills]');
  });

  it('C7 turns a throwing classifier into one line and exit 0', () => {
    const rc = run(['--project'], { classify: () => { throw new Error('boom'); } });
    expect(rc).toBe(0);
    expect(stderrLines().filter((l) => l.startsWith('code-conductor: could not classify the project ('))).toHaveLength(1);
    expect(frontendSpawns).toEqual([]);
  });

  it('C8 names a ui-ux-pro-max copy that does not match and leaves it', () => {
    mkdirSync(UIPRO_DIR(), { recursive: true });
    writeFileSync(join(UIPRO_DIR(), 'SKILL.md'), 'edited by hand');
    run(['--project'], { classify: asType('backend') });
    expect(stderrLines()).toContain(`code-conductor: left ui-ux-pro-max in place (does not match a known install; review and remove it yourself): ${UIPRO_DIR()}`);
    expect(readFileSync(join(UIPRO_DIR(), 'SKILL.md'), 'utf8')).toBe('edited by hand');
  });

  it("C9 keeps a host's Impeccable hook entry across two project runs", () => {
    const entry = { matcher: 'Edit|Write', hooks: [{ type: 'command', command: '"${CLAUDE_PROJECT_DIR}/.claude/skills/impeccable/scripts/impeccable" hook-after-edit' }] };
    mkdirSync(join(cwd, '.claude'), { recursive: true });
    writeFileSync(join(cwd, '.claude', 'settings.json'), JSON.stringify({ hooks: { PostToolUse: [entry] } }));
    run(['--project'], { classify: asType('backend') });
    run(['--project'], { classify: asType('backend') });
    const settings = JSON.parse(readFileSync(join(cwd, '.claude', 'settings.json'), 'utf8'));
    expect(settings.hooks.PostToolUse.filter((e) => JSON.stringify(e).includes('skills/impeccable/'))).toEqual([entry]);
  });

  it('C10 never classifies on a global-only run', () => {
    let classified = 0;
    run([], { classify: () => { classified++; return { type: 'frontend' }; } });
    expect(classified).toBe(0);
  });

  it('C11 survives a failing install with exit 0 and one line per skill', () => {
    const rc = run(['--project', '--with-frontend-skills'], { frontendSpawn: exited(2) });
    expect(rc).toBe(0);
    expect(stderrLines().filter((l) => l.includes('not installed (exit 2)'))).toHaveLength(3);
  });

  it('C12 recognises --with-frontend-skills', () => {
    run(['--project', '--with-frontend-skills']);
    expect(stderrLines().some((l) => l.includes('ignoring unrecognized argument(s)'))).toBe(false);
  });
});
