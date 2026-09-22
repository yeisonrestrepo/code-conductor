import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, lstatSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertAssets, deployGlobal, deployProject, chmodHooks, assertMergeTargets } from '../../lib/installer/deploy.mjs';
import { SENTINEL_START, SENTINEL_END } from '../../lib/installer/merge-md.mjs';

const TPL_GLOBAL = [
  '# Global Claude Configuration', '',
  SENTINEL_START,
  '## Workflow', '', 'Spec, then plan, then implement.', '',
  '## Safety', '', 'Confirm before writes.',
  SENTINEL_END, '',
].join('\n');

const TPL_PROJECT = [
  '# Project Claude Configuration', '',
  '## Project Identity', '', '- Name: TBD', '',
  '## Conventions', '', '- TBD', '',
  SENTINEL_START,
  '## Agent Identity', '', 'You are an orchestrator.', '',
  '## Hard Constraints', '', '- Never hardcode secrets.',
  SENTINEL_END, '',
].join('\n');

const TPL_GITIGNORE = '.claude/memory/turn-count.txt\n*.installer-backup.*\n';
const SKILL_MD = '---\nname: critical-review\ndescription: "adversarial review"\ntype: skill\n---\n\n# Critical Review\n';

let asset, home;
beforeEach(() => {
  asset = mkdtempSync(join(tmpdir(), 'cc-asset-'));
  home = mkdtempSync(join(tmpdir(), 'cc-home-'));
  mkdirSync(join(asset, 'global', 'hooks'), { recursive: true });
  mkdirSync(join(asset, 'global', 'memory'), { recursive: true });
  mkdirSync(join(asset, 'skills'), { recursive: true });
  mkdirSync(join(asset, 'project-template', '.claude', 'commands'), { recursive: true });
  mkdirSync(join(asset, 'scripts'), { recursive: true });
  writeFileSync(join(asset, 'scripts', 'conductor-db.mjs'), 'db-engine');
  writeFileSync(join(asset, 'global', 'CLAUDE.md'), TPL_GLOBAL);
  writeFileSync(join(asset, 'global', 'hooks', 'h.sh'), '#!/bin/sh\n');
  writeFileSync(join(asset, 'global', 'memory', 'personal.md'), 'BUNDLED');
  mkdirSync(join(asset, 'skills', 'critical-review'), { recursive: true });
  writeFileSync(join(asset, 'skills', 'critical-review', 'SKILL.md'), SKILL_MD);
  writeFileSync(join(asset, 'project-template', 'CLAUDE.md'), TPL_PROJECT);
  writeFileSync(join(asset, 'project-template', '.gitignore'), TPL_GITIGNORE);
  writeFileSync(join(asset, 'project-template', '.claude', 'commands', 'cc-spec.md'), 'spec');
});
afterEach(() => {
  rmSync(asset, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

describe('assertAssets', () => {
  it('throws MISSING_ASSET for an absent dir', () => {
    expect(() => assertAssets(asset, ['nope'])).toThrowError(/MISSING_ASSET|missing bundled/);
    try { assertAssets(asset, ['nope']); } catch (e) { expect(e.code).toBe('MISSING_ASSET'); }
  });
  it('passes when all dirs exist', () => {
    expect(() => assertAssets(asset, ['global', 'skills'])).not.toThrow();
  });
});

describe('deployGlobal', () => {
  it('copies managed assets and skills but not global/memory', () => {
    const dir = deployGlobal(asset, home);
    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8')).toBe(TPL_GLOBAL);
    expect(existsSync(join(dir, 'skills', 'critical-review', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(dir, 'hooks', 'h.sh'))).toBe(true);
    expect(existsSync(join(dir, 'memory', 'personal.md'))).toBe(false);
    expect(existsSync(join(dir, 'memory'))).toBe(true); // dir created despite the filter
  });
});

describe('deployProject', () => {
  it('places .claude contents under cwd/.claude and root files at cwd', () => {
    const dir = deployProject(asset, home);
    expect(dir).toBe(join(home, '.claude'));
    expect(existsSync(join(dir, '.claude'))).toBe(false);
    expect(readFileSync(join(dir, 'commands', 'cc-spec.md'), 'utf8')).toBe('spec');
    expect(readFileSync(join(home, 'CLAUDE.md'), 'utf8')).toBe(TPL_PROJECT);
    expect(readFileSync(join(home, '.gitignore'), 'utf8')).toBe(TPL_GITIGNORE);
  });
  it('copies scripts/ under cwd/.claude/scripts, not the project root', () => {
    deployProject(asset, home);
    expect(readFileSync(join(home, '.claude', 'scripts', 'conductor-db.mjs'), 'utf8')).toBe('db-engine');
    expect(existsSync(join(home, 'scripts'))).toBe(false);
  });
  it('sweeps a stale root-level scripts/ dir left by the 1.23.2 bug', () => {
    mkdirSync(join(home, 'scripts'), { recursive: true });
    writeFileSync(join(home, 'scripts', 'conductor-db.mjs'), 'stale-db-engine');
    deployProject(asset, home);
    expect(existsSync(join(home, 'scripts'))).toBe(false);
    expect(readFileSync(join(home, '.claude', 'scripts', 'conductor-db.mjs'), 'utf8')).toBe('db-engine');
  });
  it('leaves a host-owned scripts/ dir untouched when contents differ from the bundle', () => {
    mkdirSync(join(home, 'scripts'), { recursive: true });
    writeFileSync(join(home, 'scripts', 'build.sh'), '#!/bin/sh\necho host-script\n');
    deployProject(asset, home);
    expect(readFileSync(join(home, 'scripts', 'build.sh'), 'utf8')).toBe('#!/bin/sh\necho host-script\n');
    expect(readFileSync(join(home, '.claude', 'scripts', 'conductor-db.mjs'), 'utf8')).toBe('db-engine');
  });
});

describe('deployGlobal — CLAUDE.md merge', () => {
  it('writes the whole template into a fresh home', () => {
    const dir = deployGlobal(asset, home);
    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8')).toBe(TPL_GLOBAL);
  });
  it('refreshes the managed block on re-run while preserving host sections', () => {
    const dir = join(home, '.claude');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'CLAUDE.md'), '# Mine\n\n## My Rules\n\nkeep me\n');
    deployGlobal(asset, home);
    const after = readFileSync(join(dir, 'CLAUDE.md'), 'utf8');
    expect(after).toContain('## My Rules\n\nkeep me');
    expect(after).toContain('Spec, then plan, then implement.');
    writeFileSync(join(asset, 'global', 'CLAUDE.md'), TPL_GLOBAL.replace('Confirm before writes.', 'Confirm before every write.'));
    deployGlobal(asset, home);
    const upgraded = readFileSync(join(dir, 'CLAUDE.md'), 'utf8');
    expect(upgraded).toContain('Confirm before every write.');
    expect(upgraded).toContain('keep me');
  });
  it('is idempotent — a second deploy writes no second backup', () => {
    const dir = join(home, '.claude');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'CLAUDE.md'), '# Mine\n\n## My Rules\n\nkeep me\n');
    deployGlobal(asset, home);
    const first = readFileSync(join(dir, 'CLAUDE.md'), 'utf8');
    deployGlobal(asset, home);
    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8')).toBe(first);
    expect(readdirSync(dir).filter(n => n.includes('.installer-backup.'))).toHaveLength(1);
  });
});

describe('deployGlobal — skills', () => {
  it('installs each skill as <name>/SKILL.md with frontmatter (hermetic)', () => {
    const dir = deployGlobal(asset, home);
    const p = join(dir, 'skills', 'critical-review', 'SKILL.md');
    expect(existsSync(p)).toBe(true);
    const content = readFileSync(p, 'utf8');
    expect(content).toMatch(/^name: critical-review$/m);
    expect(content).toMatch(/^description: .+$/m);
  });
  it('replaces a FILE occupying skills/<name> with the directory', () => {
    const skills = join(home, '.claude', 'skills');
    mkdirSync(skills, { recursive: true });
    writeFileSync(join(skills, 'critical-review'), 'blocking file');
    deployGlobal(asset, home);
    expect(existsSync(join(skills, 'critical-review', 'SKILL.md'))).toBe(true);
  });
  it('sweeps a stale flat <name>.md that matches the bundled SKILL.md', () => {
    const skills = join(home, '.claude', 'skills');
    mkdirSync(skills, { recursive: true });
    writeFileSync(join(skills, 'critical-review.md'), SKILL_MD);
    deployGlobal(asset, home);
    expect(existsSync(join(skills, 'critical-review.md'))).toBe(false);
  });
  it('sweeps a stale flat <name>.md that matches SKILL.md minus its frontmatter', () => {
    const skills = join(home, '.claude', 'skills');
    mkdirSync(skills, { recursive: true });
    writeFileSync(join(skills, 'critical-review.md'), '# Critical Review\n');
    deployGlobal(asset, home);
    expect(existsSync(join(skills, 'critical-review.md'))).toBe(false);
  });
  it('keeps a user-modified flat <name>.md', () => {
    const skills = join(home, '.claude', 'skills');
    mkdirSync(skills, { recursive: true });
    writeFileSync(join(skills, 'critical-review.md'), '# Critical Review\n\nmy own edit\n');
    deployGlobal(asset, home);
    expect(readFileSync(join(skills, 'critical-review.md'), 'utf8')).toContain('my own edit');
  });
});

describe('deployProject — merges instead of clobbering', () => {
  it('preserves a host CLAUDE.md and appends the missing sections', () => {
    writeFileSync(join(home, 'CLAUDE.md'), '# Acme\n\n## Project Identity\n\n- Name: acme\n');
    deployProject(asset, home);
    const after = readFileSync(join(home, 'CLAUDE.md'), 'utf8');
    expect(after).toContain('- Name: acme');
    expect(after).not.toContain('- Name: TBD');
    expect(after).toContain('## Conventions');
    expect(after).toContain('## Agent Identity');
  });
  it('appends only absent .gitignore lines and keeps host lines', () => {
    writeFileSync(join(home, '.gitignore'), 'dist\n');
    deployProject(asset, home);
    const after = readFileSync(join(home, '.gitignore'), 'utf8');
    expect(after).toBe('dist\n.claude/memory/turn-count.txt\n*.installer-backup.*\n');
  });
  it('writes both files whole when the host has neither', () => {
    deployProject(asset, home);
    expect(readFileSync(join(home, 'CLAUDE.md'), 'utf8')).toBe(TPL_PROJECT);
    expect(readFileSync(join(home, '.gitignore'), 'utf8')).toContain('turn-count.txt');
  });
  it('skips a directory .gitignore without throwing', () => {
    mkdirSync(join(home, '.gitignore'));
    expect(() => deployProject(asset, home)).not.toThrow();
  });
  it('merges a symlinked CLAUDE.md through realpath and keeps the link', () => {
    const real = join(asset, 'dotfiles-CLAUDE.md');
    writeFileSync(real, '# Acme\n\n## Deployment\n\nkubectl\n');
    symlinkSync(real, join(home, 'CLAUDE.md'));
    deployProject(asset, home);
    expect(lstatSync(join(home, 'CLAUDE.md')).isSymbolicLink()).toBe(true);
    expect(readFileSync(real, 'utf8')).toContain('## Agent Identity');
  });
  it('merges a symlinked .gitignore through realpath and keeps the link', () => {
    const real = join(asset, 'dotfiles-gitignore');
    writeFileSync(real, 'dist\n');
    symlinkSync(real, join(home, '.gitignore'));
    deployProject(asset, home);
    expect(lstatSync(join(home, '.gitignore')).isSymbolicLink()).toBe(true);
    expect(readFileSync(real, 'utf8')).toBe('dist\n.claude/memory/turn-count.txt\n*.installer-backup.*\n');
  });
});

describe('assertMergeTargets', () => {
  it('throws CLAUDE_MD_NOT_FILE for a directory at the global target', () => {
    mkdirSync(join(home, '.claude', 'CLAUDE.md'), { recursive: true });
    try { assertMergeTargets(home, home, false); expect.unreachable(); }
    catch (e) { expect(e.code).toBe('CLAUDE_MD_NOT_FILE'); }
  });
  it('ignores the project target unless --project was passed', () => {
    mkdirSync(join(home, 'CLAUDE.md'), { recursive: true });
    expect(() => assertMergeTargets(home, home, false)).not.toThrow();
    try { assertMergeTargets(home, home, true); expect.unreachable(); }
    catch (e) { expect(e.code).toBe('CLAUDE_MD_NOT_FILE'); }
  });
  it('accepts an absent target and a regular file', () => {
    expect(() => assertMergeTargets(home, home, true)).not.toThrow();
    writeFileSync(join(home, 'CLAUDE.md'), '# ok\n');
    expect(() => assertMergeTargets(home, home, true)).not.toThrow();
  });
});

describe('chmodHooks', () => {
  it('marks *.sh executable without throwing', () => {
    const dir = deployGlobal(asset, home);
    expect(() => chmodHooks(dir)).not.toThrow();
    if (process.platform !== 'win32') {
      const { statSync } = require('node:fs');
      expect(statSync(join(dir, 'hooks', 'h.sh')).mode & 0o111).toBeGreaterThan(0);
    }
  });
});
