import { describe, it, expect, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  IMPECCABLE_PACKAGE, SKILLS_CLI, FRONTEND_SKILLS, FRONTEND_TIMEOUT_MS, DISCLOSURE, CONSENT_PROMPT,
  installArgs, commandLine, acceptsAnswer, readAnswerLine, classifyWithDetector, offerFrontendSkills,
} from '../../lib/installer/frontend-skills.mjs';

const RM = { recursive: true, force: true, maxRetries: 10, retryDelay: 200 };
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const temps = [];
const tempDir = () => { const d = realpathSync(mkdtempSync(join(tmpdir(), 'cc-frontend-test-'))); temps.push(d); return d; };
afterEach(() => { for (const d of temps.splice(0)) rmSync(d, RM); });

const [IMPECCABLE, EMIL, TASTE] = FRONTEND_SKILLS;
const sha = (text) => createHash('sha256').update(text).digest('hex');
const writeAt = (cwd, rel, text) => { mkdirSync(join(cwd, rel, '..'), { recursive: true }); writeFileSync(join(cwd, rel), text); };
const readJson = (cwd, rel) => JSON.parse(readFileSync(join(cwd, rel), 'utf8'));
const record = (cwd) => readJson(cwd, '.claude/frontend-skills.json');
const lockEntry = (skill, commit = skill.pin) => ({ source: skill.source, ref: commit, commit, sourceType: 'github', installMode: 'copy' });

function writeSkill(cwd, name) { writeAt(cwd, `.claude/skills/${name}/SKILL.md`, `# ${name}\n`); }
function writeLock(cwd, name, commit) {
  let lock = { version: 1, skills: {} };
  try { lock = JSON.parse(readFileSync(join(cwd, 'skills-lock.json'), 'utf8')); } catch { /* start fresh */ }
  lock.skills[name] = lockEntry(FRONTEND_SKILLS.find((s) => s.name === name), commit);
  writeAt(cwd, 'skills-lock.json', JSON.stringify(lock));
}
function writeHook(cwd, file = 'settings.json', event = 'PostToolUse') {
  const command = '"${CLAUDE_PROJECT_DIR}/.claude/skills/impeccable/scripts/impeccable" hook-after-edit';
  writeAt(cwd, `.claude/${file}`, JSON.stringify({ hooks: { [event]: [{ matcher: 'Edit|Write', hooks: [{ type: 'command', command }] }] } }));
}

// What each CLI would leave behind on a clean run.
const CLEAN = {
  impeccable: (cwd) => { writeSkill(cwd, 'impeccable'); writeHook(cwd); },
  'emil-design-eng': (cwd) => { writeSkill(cwd, 'emil-design-eng'); writeLock(cwd, 'emil-design-eng'); },
  'design-taste-frontend': (cwd) => { writeSkill(cwd, 'design-taste-frontend'); writeLock(cwd, 'design-taste-frontend'); },
};
const skillOf = (args) => (args.includes(IMPECCABLE_PACKAGE) ? 'impeccable' : args[args.indexOf('--skill') + 1]);

// An injected spawn in the fakeSpawn shape of plugins.test.js: it records every call and
// writes into the project what the CLI would have written, or returns a canned result.
function fakeSpawn(behaviors = {}) {
  const calls = [];
  const spawn = (command, args, options) => {
    calls.push({ command, args, options });
    const name = skillOf(args);
    const behavior = behaviors[name] ?? CLEAN[name];
    if (typeof behavior !== 'function') return behavior;
    behavior(options.cwd);
    return { status: 0, signal: null };
  };
  return { spawn, calls };
}

function offer(cwd, { spawn, ...rest } = {}) {
  return offerFrontendSkills({ cwd, spawn: spawn ?? fakeSpawn().spawn, env: {}, platform: 'linux', nodeVersion: '24.0.0', ...rest });
}

describe('pins and argv', () => {
  it('F1 pins the CLIs by exact version and the skills by full commit, in install order', () => {
    expect(IMPECCABLE_PACKAGE).toMatch(/^impeccable@\d+\.\d+\.\d+$/);
    expect(IMPECCABLE_PACKAGE).toBe('impeccable@4.11.1');
    expect(SKILLS_CLI).toMatch(/^skills@\d+\.\d+\.\d+$/);
    expect(SKILLS_CLI).toBe('skills@1.9.0');
    expect(EMIL.pin).toMatch(/^[0-9a-f]{40}$/);
    expect(TASTE.pin).toMatch(/^[0-9a-f]{40}$/);
    expect(FRONTEND_SKILLS.map((s) => s.name)).toEqual(['impeccable', 'emil-design-eng', 'design-taste-frontend']);
  });

  it('F2 builds exactly the three argv, with no wildcard and one --skill each', () => {
    expect(installArgs(IMPECCABLE)).toEqual(['--yes', 'impeccable@4.11.1', 'install', '-y', '--providers=claude', '--scope=project']);
    expect(installArgs(EMIL)).toEqual(['--yes', 'skills@1.9.0', 'add', `emilkowalski/skill@${EMIL.pin}`, '--skill', 'emil-design-eng', '-a', 'claude-code', '--copy', '-y']);
    expect(installArgs(TASTE)).toEqual(['--yes', 'skills@1.9.0', 'add', `Leonxlnx/taste-skill@${TASTE.pin}`, '--skill', 'design-taste-frontend', '-a', 'claude-code', '--copy', '-y']);
    for (const skill of FRONTEND_SKILLS) {
      const args = installArgs(skill);
      expect(args).not.toContain('--no-hooks');
      expect(args).not.toContain('--all');
      expect(args.some((a) => a.includes('*'))).toBe(false);
      expect(commandLine(skill)).toBe(`npx ${args.join(' ')}`);
    }
    expect(installArgs(EMIL).filter((a) => a === '--skill')).toHaveLength(1);
  });
});

describe('the disclosure and the answer', () => {
  it('F3 discloses the hook, the engine download, the remote fetch and the unpinned bundle, and names the pins', () => {
    for (const phrase of ['hook', "even when you deny the model's own commands", "download Impeccable's engine binary (checksum-verified) on first use",
      'impeccable.style', 'signed by the vendor', 'not pinned to a commit', IMPECCABLE_PACKAGE, EMIL.pin, TASTE.pin]) {
      expect(DISCLOSURE).toContain(phrase);
    }
    expect(CONSENT_PROMPT).toBe('Install the frontend design skills? [Y/n] ');
  });

  it('F4 reads an empty answer as Yes and an unreadable one as no consent', () => {
    for (const yes of ['', 'y', 'Y', 'yes', ' yes ']) expect(acceptsAnswer(yes)).toBe(true);
    for (const no of ['n', 'no', 'maybe', null, undefined]) expect(acceptsAnswer(no)).toBe(false);
    const reader = (text) => { let i = 0; return (fd, buf) => { if (i >= text.length) return 0; buf.write(text[i++], 0, 'latin1'); return 1; }; };
    expect(readAnswerLine(0, reader('\n'))).toBe('');
    expect(readAnswerLine(0, reader('y\n'))).toBe('y');
    expect(readAnswerLine(0, reader('y'))).toBeNull();
    expect(readAnswerLine(0, reader(''))).toBeNull();
  });
});

describe('consent', () => {
  it('F5 asks once, before any spawn, then installs the three in table order', () => {
    const cwd = tempDir();
    const events = [];
    const { spawn, calls } = fakeSpawn();
    const ask = (question) => { events.push(['ask', question]); return ''; };
    offer(cwd, { isInteractive: true, ask, spawn: (...args) => { events.push(['spawn']); return spawn(...args); } });
    expect(events.map((e) => e[0])).toEqual(['ask', 'spawn', 'spawn', 'spawn']);
    expect(events[0][1]).toBe(DISCLOSURE + CONSENT_PROMPT);
    expect(calls).toHaveLength(3);
    FRONTEND_SKILLS.forEach((skill, i) => {
      expect(calls[i].command).toBe('npx');
      expect(calls[i].args).toEqual(installArgs(skill));
      expect(calls[i].options.cwd).toBe(cwd);
      expect(calls[i].options.timeout).toBe(FRONTEND_TIMEOUT_MS);
      expect(calls[i].options.timeout).toBe(120000);
      expect(calls[i].options.env).toMatchObject({ DISABLE_TELEMETRY: '1', DO_NOT_TRACK: '1' });
    });
  });

  it('F6 records a declined answer and prints the manual commands', () => {
    const cwd = tempDir();
    const { spawn, calls } = fakeSpawn();
    const result = offer(cwd, { isInteractive: true, ask: () => 'n', spawn });
    expect(calls).toEqual([]);
    expect(record(cwd).choice).toBe('declined');
    expect(result.stderr[0]).toBe('frontend design skills not installed (declined; pass --with-frontend-skills to install them)');
    expect(result.stderr.slice(1)).toEqual(FRONTEND_SKILLS.map((s) => `to install ${s.name} yourself: ${commandLine(s)}`));
  });

  it('F7 does not ask again after an earlier decline', () => {
    const cwd = tempDir();
    writeAt(cwd, '.claude/frontend-skills.json', JSON.stringify({ choice: 'declined', reason: 'declined', skills: [] }));
    const { spawn, calls } = fakeSpawn();
    const ask = () => { throw new Error('must not ask'); };
    const result = offer(cwd, { isInteractive: true, ask, spawn });
    expect(calls).toEqual([]);
    expect(result.stderr).toEqual(['frontend design skills not installed (declined on an earlier run; pass --with-frontend-skills to install them)']);
  });

  it('F8 skips a non-interactive run without the flag and says how to install', () => {
    const cwd = tempDir();
    const { spawn, calls } = fakeSpawn();
    const result = offer(cwd, { isInteractive: false, spawn });
    expect(calls).toEqual([]);
    expect(result.stderr[0]).toBe('frontend design skills not installed (non-interactive run; pass --with-frontend-skills to install them)');
    expect(result.stderr.slice(1)).toEqual(FRONTEND_SKILLS.map((s) => `to install ${s.name} yourself: ${commandLine(s)}`));
    expect(record(cwd)).toMatchObject({ choice: 'skipped', reason: 'non-interactive run' });
  });

  it('F9 installs on the flag without asking', () => {
    const cwd = tempDir();
    const { spawn, calls } = fakeSpawn();
    const ask = () => { throw new Error('must not ask'); };
    offer(cwd, { withFrontendSkills: true, ask, spawn });
    expect(calls).toHaveLength(3);
  });
});

describe('verification and the record', () => {
  it('F10 reports a clean install and records the pins', () => {
    const cwd = tempDir();
    const result = offer(cwd, { withFrontendSkills: true });
    expect(result.stdout).toEqual(FRONTEND_SKILLS.map((s) => `frontend design skill ${s.name}: installed (${s.pin})`));
    expect(result.stderr).toEqual([]);
    const written = record(cwd);
    expect(written).toMatchObject({ choice: 'accepted', reason: null, cli: 'skills@1.9.0' });
    expect(written.skills[0]).toMatchObject({ name: 'impeccable', pin: 'impeccable@4.11.1', status: 'installed' });
    expect(written.skills.map((s) => s.status)).toEqual(['installed', 'installed', 'installed']);
  });

  it("F11 records the sha256 of every file Impeccable installed, a link as 'symlink'", () => {
    const cwd = tempDir();
    const impeccable = (dir) => {
      writeSkill(dir, 'impeccable');
      writeAt(dir, '.claude/skills/impeccable/reference/a.md', 'alpha');
      writeAt(dir, '.claude/skills/impeccable/reference/deep/b.md', 'beta');
      symlinkSync(tempDir(), join(dir, '.claude/skills/impeccable/linked'), 'junction');
      writeHook(dir);
    };
    offer(cwd, { withFrontendSkills: true, spawn: fakeSpawn({ impeccable }).spawn });
    const { files } = record(cwd).skills[0];
    expect(Object.keys(files)).toEqual(['SKILL.md', 'linked', 'reference/a.md', 'reference/deep/b.md']);
    expect(files['SKILL.md']).toBe(sha('# impeccable\n'));
    expect(files['reference/a.md']).toBe(sha('alpha'));
    expect(files['reference/deep/b.md']).toBe(sha('beta'));
    expect(files.linked).toBe('symlink');
  });

  it('F12 does not trust an exit 0 that wrote the wrong folder', () => {
    const cwd = tempDir();
    const taste = (dir) => { writeAt(dir, '.claude/skills/taste-skill/SKILL.md', '# taste\n'); writeLock(dir, 'design-taste-frontend'); };
    const result = offer(cwd, { withFrontendSkills: true, spawn: fakeSpawn({ 'design-taste-frontend': taste }).spawn });
    expect(result.stderr).toEqual(['frontend design skill design-taste-frontend: not verified (no .claude/skills/design-taste-frontend/SKILL.md)']);
  });

  it('F13a names a lock commit that is not the pin', () => {
    const cwd = tempDir();
    const emil = (dir) => { writeSkill(dir, 'emil-design-eng'); writeLock(dir, 'emil-design-eng', 'f'.repeat(40)); };
    const result = offer(cwd, { withFrontendSkills: true, spawn: fakeSpawn({ 'emil-design-eng': emil }).spawn });
    expect(result.stderr).toEqual([`frontend design skill emil-design-eng: not verified (skills-lock.json commit for emil-design-eng is ${'f'.repeat(40)}, expected ${EMIL.pin})`]);
  });

  it('F13b names a missing lock entry', () => {
    const cwd = tempDir();
    const emil = (dir) => { writeSkill(dir, 'emil-design-eng'); writeAt(dir, 'skills-lock.json', JSON.stringify({ version: 1, skills: {} })); };
    const result = offer(cwd, { withFrontendSkills: true, spawn: fakeSpawn({ 'emil-design-eng': emil, 'design-taste-frontend': (dir) => writeSkill(dir, 'design-taste-frontend') }).spawn });
    expect(result.stderr).toContain('frontend design skill emil-design-eng: not verified (no skills-lock.json entry for emil-design-eng)');
  });

  it('F13c names an unreadable lock and leaves its bytes alone', () => {
    const cwd = tempDir();
    const broken = (name) => (dir) => { writeSkill(dir, name); writeAt(dir, 'skills-lock.json', '{not json'); };
    const result = offer(cwd, { withFrontendSkills: true, spawn: fakeSpawn({ 'emil-design-eng': broken('emil-design-eng'), 'design-taste-frontend': broken('design-taste-frontend') }).spawn });
    expect(result.stderr).toContain('frontend design skill emil-design-eng: not verified (skills-lock.json unreadable)');
    expect(readFileSync(join(cwd, 'skills-lock.json'), 'utf8')).toBe('{not json');
  });

  it('F14a reports Impeccable without its hook, and still records its files', () => {
    const cwd = tempDir();
    const result = offer(cwd, { withFrontendSkills: true, spawn: fakeSpawn({ impeccable: (dir) => writeSkill(dir, 'impeccable') }).spawn });
    expect(result.stderr).toEqual(['frontend design skill impeccable: installed without its design hook (no hook entry for .claude/skills/impeccable in .claude/settings*.json)']);
    expect(record(cwd).skills[0]).toMatchObject({ status: 'installed without its design hook', files: { 'SKILL.md': sha('# impeccable\n') } });
  });

  it('F14b finds the hook in settings.local.json alone', () => {
    const cwd = tempDir();
    const impeccable = (dir) => { writeSkill(dir, 'impeccable'); writeHook(dir, 'settings.local.json', 'PreToolUse'); };
    const result = offer(cwd, { withFrontendSkills: true, spawn: fakeSpawn({ impeccable }).spawn });
    expect(result.stdout[0]).toBe(`frontend design skill impeccable: installed (${IMPECCABLE.pin})`);
    expect(result.stderr).toEqual([]);
  });
});

describe('failures never throw', () => {
  const MANUAL = `to install it yourself: ${commandLine(IMPECCABLE)}`;

  it('F15a reports a non-zero exit and still tries the others', () => {
    const cwd = tempDir();
    const { spawn, calls } = fakeSpawn({ impeccable: { status: 1, signal: null } });
    const result = offer(cwd, { withFrontendSkills: true, spawn });
    expect(result.stderr).toEqual([`frontend design skill impeccable: not installed (exit 1); ${MANUAL}`]);
    expect(MANUAL).toBe('to install it yourself: npx --yes impeccable@4.11.1 install -y --providers=claude --scope=project');
    expect(calls).toHaveLength(3);
  });

  it('F15b reports a timeout', () => {
    const cwd = tempDir();
    const result = offer(cwd, { withFrontendSkills: true, spawn: fakeSpawn({ impeccable: { error: { code: 'ETIMEDOUT' } } }).spawn });
    expect(result.stderr).toEqual([`frontend design skill impeccable: not installed (timed out after 120s); ${MANUAL}`]);
  });

  it('F15c reports a missing npx', () => {
    const cwd = tempDir();
    const result = offer(cwd, { withFrontendSkills: true, spawn: fakeSpawn({ impeccable: { error: { code: 'ENOENT' } } }).spawn });
    expect(result.stderr).toEqual([`frontend design skill impeccable: not installed (npx not found on PATH); ${MANUAL}`]);
  });

  it('F16 never spawns the skills CLI on a Node below its floor', () => {
    const cwd = tempDir();
    const { spawn, calls } = fakeSpawn();
    const result = offer(cwd, { withFrontendSkills: true, nodeVersion: '22.19.0', spawn });
    expect(calls.map((c) => skillOf(c.args))).toEqual(['impeccable']);
    expect(result.stderr).toEqual([EMIL, TASTE].map((s) => `frontend design skill ${s.name}: not installed (needs Node >= 22.20, found 22.19.0); to install it yourself: ${commandLine(s)}`));
  });
});

describe('what is already there', () => {
  it('F17 changes nothing on a second run and keeps the recorded files', () => {
    const cwd = tempDir();
    const files = { 'SKILL.md': sha('# impeccable\n') };
    for (const skill of FRONTEND_SKILLS) writeSkill(cwd, skill.name);
    writeLock(cwd, 'emil-design-eng');
    writeLock(cwd, 'design-taste-frontend');
    const prior = { choice: 'accepted', reason: null, cli: 'skills@1.9.0', skills: [{ name: 'impeccable', pin: IMPECCABLE_PACKAGE, status: 'installed', files }] };
    writeAt(cwd, '.claude/frontend-skills.json', JSON.stringify(prior));
    const ask = () => { throw new Error('must not ask'); };
    const { spawn, calls } = fakeSpawn();
    const result = offer(cwd, { isInteractive: true, ask, spawn });
    expect(calls).toEqual([]);
    expect(result.stdout).toEqual(FRONTEND_SKILLS.map((s) => `frontend design skill ${s.name}: already installed`));
    expect(record(cwd).skills[0].files).toEqual(files);
  });

  it('F18a leaves a skill locked at another commit and installs the rest', () => {
    const cwd = tempDir();
    writeSkill(cwd, 'emil-design-eng');
    writeLock(cwd, 'emil-design-eng', 'a'.repeat(40));
    const { spawn, calls } = fakeSpawn();
    const result = offer(cwd, { withFrontendSkills: true, spawn });
    expect(calls.map((c) => skillOf(c.args))).toEqual(['impeccable', 'design-taste-frontend']);
    expect(result.stderr).toEqual([`frontend design skill emil-design-eng: present at a different revision (${'a'.repeat(40)}); not changed`]);
    expect(result.stdout).toHaveLength(2);
  });

  it('F18b treats an Impeccable folder with no record as unlocked', () => {
    const cwd = tempDir();
    writeSkill(cwd, 'impeccable');
    const { spawn, calls } = fakeSpawn();
    const result = offer(cwd, { withFrontendSkills: true, spawn });
    expect(calls.map((c) => skillOf(c.args))).toEqual(['emil-design-eng', 'design-taste-frontend']);
    expect(result.stderr).toEqual(['frontend design skill impeccable: present at a different revision (unlocked); not changed']);
  });
});

describe('classifyWithDetector', () => {
  const project = (files) => {
    const dir = tempDir();
    for (const [rel, text] of Object.entries(files)) writeAt(dir, rel, text);
    return dir;
  };
  const pkg = (dep) => JSON.stringify({ name: 'fixture', private: true, dependencies: { [dep]: '1.0.0' } });

  it('F19 classifies a React project as frontend', () => {
    expect(classifyWithDetector(ROOT, project({ 'package.json': pkg('react'), 'src/index.js': '' }))).toEqual({ type: 'frontend' });
  });
  it('F19 classifies an Express project as backend', () => {
    expect(classifyWithDetector(ROOT, project({ 'package.json': pkg('express'), 'server/index.js': '' }))).toEqual({ type: 'backend' });
  });
  it('F19 classifies an empty directory as library', () => {
    expect(classifyWithDetector(ROOT, tempDir())).toEqual({ type: 'library' });
  });
  it('F19 reports an error for a path that does not exist', () => {
    expect(classifyWithDetector(ROOT, join(tempDir(), 'missing'))).toHaveProperty('error');
  });
});
