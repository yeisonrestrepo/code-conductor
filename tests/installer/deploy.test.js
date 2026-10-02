import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, lstatSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertAssets, deployGlobal, deployProject, chmodHooks, assertMergeTargets } from '../../lib/installer/deploy.mjs';
import { SENTINEL_START, SENTINEL_END, GITIGNORE_HEADER } from '../../lib/installer/merge-md.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GLOBAL_BLOCK = [SENTINEL_START, '## Workflow', '', 'Spec, then plan, then implement.', '', '## Safety', '', 'Confirm before writes.', SENTINEL_END, ''].join('\n');
const TPL_GLOBAL = ['# Global Claude Configuration', '', GLOBAL_BLOCK].join('\n');
const PROJECT_BLOCK = [SENTINEL_START, '## Agent Identity', '', 'You are an orchestrator.', '', '## Hard Constraints', '', '- Never hardcode secrets.', SENTINEL_END, ''].join('\n');
const TPL_PROJECT = ['# Project Claude Configuration', '', '## Project Identity', '', '- Name: TBD', '', '## Conventions', '', '- TBD', '', PROJECT_BLOCK].join('\n');

const TPL_GITIGNORE = `${GITIGNORE_HEADER}\n.claude/memory/turn-count.txt\n*.installer-backup.*\n*.installer-tmp.*\n.claude/memory/band-envelope.json\n`;
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
  writeFileSync(join(asset, 'project-template', 'gitignore'), TPL_GITIGNORE);
  writeFileSync(join(asset, 'project-template', '.claude', 'commands', 'cc-spec.md'), 'spec');
});
afterEach(() => {
  rmSync(asset, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});
const capture = () => {
  const out = { warned: [], said: [] };
  out.opts = { warn: (m) => out.warned.push(m), report: (m) => out.said.push(m) };
  return out;
};

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
    // deployGlobal now seeds this itself (BUG-039): the copy is still
    // filtered, and the re-run case below is what proves it.
    expect(readFileSync(join(dir, 'memory', 'personal.md'), 'utf8')).toBe('BUNDLED');
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
  it('deploys the undotted template ignore file as .gitignore and leaves no stray copy', () => {
    deployProject(asset, home);
    expect(readFileSync(join(home, '.gitignore'), 'utf8')).toBe(TPL_GITIGNORE);
    expect(existsSync(join(home, 'gitignore'))).toBe(false);
  });
  it('[BUG-052] refuses to deploy into the package own source tree', () => {
    const pkgName = '@test/code-conductor';
    writeFileSync(join(asset, 'package.json'), JSON.stringify({ name: pkgName }));
    writeFileSync(join(home, 'package.json'), JSON.stringify({ name: pkgName }));
    expect(() => deployProject(asset, home)).toThrow(/SELF_INSTALL|own source tree/);
  });
  it('[BUG-052] allows deploy when package names differ', () => {
    writeFileSync(join(asset, 'package.json'), JSON.stringify({ name: '@test/code-conductor' }));
    writeFileSync(join(home, 'package.json'), JSON.stringify({ name: 'my-project' }));
    expect(() => deployProject(asset, home)).not.toThrow();
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
  it('[AC2] keeps all 12 host lines of a sentinel-less ~/.claude/CLAUDE.md and appends the block alone', () => {
    const tpl = readFileSync(join(ROOT, 'global', 'CLAUDE.md'), 'utf8').replace(/\r\n/g, '\n');
    writeFileSync(join(asset, 'global', 'CLAUDE.md'), tpl);
    const host = tpl.split('\n')
      .filter((l) => l !== SENTINEL_START && l !== SENTINEL_END)
      .flatMap((l) => (l.startsWith('## ') ? [l, `host line under ${l.slice(3)}`] : [l]))
      .join('\n');
    expect(host.match(/^host line under /gm)).toHaveLength(12);
    const dir = join(home, '.claude');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'CLAUDE.md'), host);
    deployGlobal(asset, home);
    const block = tpl.slice(tpl.indexOf(SENTINEL_START), tpl.indexOf(SENTINEL_END) + SENTINEL_END.length) + '\n';
    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8')).toBe(host + '\n' + block);
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
  it('[AC3] preserves a host CLAUDE.md byte for byte and appends the block alone', () => {
    const host = '# Acme\n\n## Project Identity\n\n- Name: acme\n';
    writeFileSync(join(home, 'CLAUDE.md'), host);
    deployProject(asset, home);
    expect(readFileSync(join(home, 'CLAUDE.md'), 'utf8')).toBe(host + '\n' + PROJECT_BLOCK);
  });
  it('[AC10b] keeps host .gitignore lines and appends the labelled block after a blank line', () => {
    writeFileSync(join(home, '.gitignore'), 'dist\n');
    deployProject(asset, home);
    expect(readFileSync(join(home, '.gitignore'), 'utf8')).toBe('dist\n\n' + TPL_GITIGNORE);
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
    expect(readFileSync(real, 'utf8')).toBe('dist\n\n' + TPL_GITIGNORE);
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

describe('deployGlobal: host-owned state', () => {
  const GLOBAL_SETTINGS = { permissions: { allow: ['Bash(grep:*)'], deny: [] } };
  const HOST_ENTRY = { matcher: '', hooks: [{ type: 'command', command: 'bash /home/me/my-own-hook.sh' }] };
  beforeEach(() => {
    writeFileSync(join(asset, 'global', 'memory', 'verbosity.md'), 'VERBOSITY: MIN\n');
    writeFileSync(join(asset, 'global', 'settings.json'), `${JSON.stringify(GLOBAL_SETTINGS, null, 2)}\n`);
  });

  it('seeds personal.md and verbosity.md on a fresh install', () => {
    const dir = deployGlobal(asset, home);
    expect(readFileSync(join(dir, 'memory', 'personal.md'), 'utf8')).toBe('BUNDLED');
    expect(readFileSync(join(dir, 'memory', 'verbosity.md'), 'utf8')).toBe('VERBOSITY: MIN\n');
  });

  it('leaves host-edited memory files byte-identical on a re-run', () => {
    deployGlobal(asset, home);
    const p = join(home, '.claude', 'memory', 'personal.md');
    writeFileSync(p, 'MY OWN NOTES');
    deployGlobal(asset, home);
    expect(readFileSync(p, 'utf8')).toBe('MY OWN NOTES');
  });

  it('writes settings.json whole on a fresh install, permissions included', () => {
    const dir = deployGlobal(asset, home);
    expect(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')).permissions)
      .toEqual({ allow: ['Bash(grep:*)'], deny: [] });
  });

  it('leaves a host-added UserPromptSubmit entry present and unmodified on a re-run', () => {
    const dir = deployGlobal(asset, home);
    const sp = join(dir, 'settings.json');
    writeFileSync(sp, `${JSON.stringify({ hooks: { UserPromptSubmit: [HOST_ENTRY] }, permissions: { allow: [], deny: [] } }, null, 2)}\n`);
    deployGlobal(asset, home);
    expect(JSON.parse(readFileSync(sp, 'utf8')).hooks.UserPromptSubmit).toEqual([HOST_ENTRY]);
  });

  it('leaves a host-owned settings.local.json untouched', () => {
    const dir = join(home, '.claude');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'settings.local.json'), '{"local":true}');
    writeFileSync(join(asset, 'global', 'settings.local.json'), '{"template":true}');
    deployGlobal(asset, home);
    expect(readFileSync(join(dir, 'settings.local.json'), 'utf8')).toBe('{"local":true}');
  });

  it('still force-copies managed assets alongside the host-owned exclusions', () => {
    const dir = deployGlobal(asset, home);
    writeFileSync(join(dir, 'hooks', 'h.sh'), 'TAMPERED');
    deployGlobal(asset, home);
    expect(readFileSync(join(dir, 'hooks', 'h.sh'), 'utf8')).toBe('#!/bin/sh\n');
  });
});

describe('deployProject: host-owned state', () => {
  const STUB = '# Project Memory\n\n## Decisions\n';
  const THRESHOLD = '75\n';
  const PROJECT_SETTINGS = {
    hooks: { PreToolUse: [{ matcher: 'Read|Bash', hooks: [{ type: 'command', command: 'node .claude/hooks/pre-tool-use.mjs' }] }] },
    permissions: { allow: [], deny: [] },
  };
  const HOST_ENTRY = { matcher: '', hooks: [{ type: 'command', command: 'bash ./my-own-hook.sh' }] };
  let claude;
  beforeEach(() => {
    mkdirSync(join(asset, 'project-template', '.claude', 'memory'), { recursive: true });
    writeFileSync(join(asset, 'project-template', '.claude', 'memory', 'project.md'), STUB);
    writeFileSync(join(asset, 'project-template', '.claude', 'memory', 'context-threshold.txt'), THRESHOLD);
    writeFileSync(join(asset, 'project-template', '.claude', 'settings.json'), `${JSON.stringify(PROJECT_SETTINGS, null, 2)}\n`);
    claude = join(home, '.claude');
  });

  it('seeds project.md, context-threshold.txt and settings.json on a fresh scaffold', () => {
    deployProject(asset, home);
    expect(readFileSync(join(claude, 'memory', 'project.md'), 'utf8')).toBe(STUB);
    expect(readFileSync(join(claude, 'memory', 'context-threshold.txt'), 'utf8')).toBe(THRESHOLD);
    expect(JSON.parse(readFileSync(join(claude, 'settings.json'), 'utf8')).permissions).toEqual({ allow: [], deny: [] });
  });

  it('leaves a host-modified project.md byte-identical on a re-run', () => {
    deployProject(asset, home);
    const p = join(claude, 'memory', 'project.md');
    writeFileSync(p, '# Project Memory\n\n## Decisions\n\n- We chose X over Y.\n');
    deployProject(asset, home);
    expect(readFileSync(p, 'utf8')).toBe('# Project Memory\n\n## Decisions\n\n- We chose X over Y.\n');
  });

  it('leaves a host-modified context-threshold.txt byte-identical on a re-run', () => {
    deployProject(asset, home);
    const p = join(claude, 'memory', 'context-threshold.txt');
    writeFileSync(p, '40\n');
    deployProject(asset, home);
    expect(readFileSync(p, 'utf8')).toBe('40\n');
  });

  // [BUG-044] The other half of the contract: the message names a path, so a fresh deploy
  // must make that path exist. The case below this one proves a re-run cannot overwrite it.
  // This case is the ONLY coverage that the allowlist actually seeds: host-owned.test.js's
  // seedHostOwned fixture never writes the template into its source tree, so the missing
  // source is skipped there and its asserted list never mentions the allowlist.
  it('creates the allowlist from the template when the host has none', () => {
    const p = join(claude, 'memory', 'bash-scan-allowlist.txt');
    writeFileSync(join(asset, 'project-template', '.claude', 'memory', 'bash-scan-allowlist.txt'), '# SEED HEADER\n');
    deployProject(asset, home);
    expect(readFileSync(p, 'utf8')).toBe('# SEED HEADER\n');
  });

  it('leaves a host-created bash-scan-allowlist.txt byte-identical even when the template ships one', () => {
    deployProject(asset, home);
    const p = join(claude, 'memory', 'bash-scan-allowlist.txt');
    writeFileSync(p, '# operator policy\ndocs/\n');
    writeFileSync(join(asset, 'project-template', '.claude', 'memory', 'bash-scan-allowlist.txt'), 'TEMPLATE POLICY\n');
    deployProject(asset, home);
    expect(readFileSync(p, 'utf8')).toBe('# operator policy\ndocs/\n');
  });

  it('leaves every latent runtime-written file byte-identical on a re-run', () => {
    deployProject(asset, home);
    const files = {
      [join(claude, 'memory', 'personal.md')]: 'MY PREFS\n',
      [join(claude, 'memory', 'session-snapshot.json')]: '{"v":1}\n',
      [join(claude, 'memory', 'session-snapshot.md')]: '# snapshot\n',
      [join(claude, 'memory', 'turn-count.txt')]: '17\n',
      [join(claude, 'settings.local.json')]: '{"local":true}\n',
    };
    for (const [p, body] of Object.entries(files)) writeFileSync(p, body);
    // Ship every one of them from the template, which is the future this table exists to survive.
    writeFileSync(join(asset, 'project-template', '.claude', 'memory', 'personal.md'), 'TEMPLATE\n');
    writeFileSync(join(asset, 'project-template', '.claude', 'memory', 'session-snapshot.json'), 'TEMPLATE\n');
    writeFileSync(join(asset, 'project-template', '.claude', 'memory', 'session-snapshot.md'), 'TEMPLATE\n');
    writeFileSync(join(asset, 'project-template', '.claude', 'memory', 'turn-count.txt'), 'TEMPLATE\n');
    writeFileSync(join(asset, 'project-template', '.claude', 'settings.local.json'), 'TEMPLATE\n');
    deployProject(asset, home);
    for (const [p, body] of Object.entries(files)) expect(readFileSync(p, 'utf8')).toBe(body);
  });

  it('leaves a host-added settings.json entry present and unmodified on a re-run', () => {
    deployProject(asset, home);
    const sp = join(claude, 'settings.json');
    const host = JSON.parse(readFileSync(sp, 'utf8'));
    host.hooks.UserPromptSubmit = [HOST_ENTRY];
    writeFileSync(sp, `${JSON.stringify(host, null, 2)}\n`);
    deployProject(asset, home);
    expect(JSON.parse(readFileSync(sp, 'utf8')).hooks.UserPromptSubmit).toEqual([HOST_ENTRY]);
  });

  it('leaves a host-modified permissions block byte-identical, including a removed grant', () => {
    deployProject(asset, home);
    const sp = join(claude, 'settings.json');
    const host = JSON.parse(readFileSync(sp, 'utf8'));
    host.permissions = { allow: ['Bash(ls:*)'], deny: ['Bash(curl:*)'] };
    writeFileSync(sp, `${JSON.stringify(host, null, 2)}\n`);
    deployProject(asset, home);
    expect(JSON.parse(readFileSync(sp, 'utf8')).permissions).toEqual({ allow: ['Bash(ls:*)'], deny: ['Bash(curl:*)'] });
  });

  it('updates a conductor-owned entry whose template command changed', () => {
    deployProject(asset, home);
    const sp = join(claude, 'settings.json');
    const changed = JSON.parse(JSON.stringify(PROJECT_SETTINGS));
    changed.hooks.PreToolUse[0].matcher = 'Read|Write|Bash';
    writeFileSync(join(asset, 'project-template', '.claude', 'settings.json'), `${JSON.stringify(changed, null, 2)}\n`);
    deployProject(asset, home);
    const arr = JSON.parse(readFileSync(sp, 'utf8')).hooks.PreToolUse;
    expect(arr).toHaveLength(1);
    expect(arr[0].matcher).toBe('Read|Write|Bash');
  });

  it('produces a byte-identical settings.json on a re-run of an unchanged release', () => {
    deployProject(asset, home);
    const sp = join(claude, 'settings.json');
    const first = readFileSync(sp, 'utf8');
    deployProject(asset, home);
    expect(readFileSync(sp, 'utf8')).toBe(first);
  });
});

describe('deployProject: overwritten project.md detection', () => {
  const STUB = '# Project Memory\n\n## Decisions\n';
  let warned;
  const warn = (m) => warned.push(m);
  beforeEach(() => {
    warned = [];
    mkdirSync(join(asset, 'project-template', '.claude', 'memory'), { recursive: true });
    writeFileSync(join(asset, 'project-template', '.claude', 'memory', 'project.md'), STUB);
  });

  it('says nothing on a fresh scaffold, whose stub it just wrote', () => {
    deployProject(asset, home, { warn, report: (m) => warned.push(m) });
    expect(warned).toEqual([]);
    expect(readFileSync(join(home, '.claude', 'memory', 'project.md'), 'utf8')).toBe(STUB);
  });

  it('prints the recovery line exactly once when the host copy equals the stub', () => {
    deployProject(asset, home, { warn });
    warned.length = 0;
    deployProject(asset, home, { warn });
    expect(warned).toHaveLength(1);
    expect(warned[0]).toContain('may have been overwritten');
    expect(warned[0]).toContain('git log --oneline -- .claude/memory/project.md');
    expect(warned[0]).toContain('git checkout <commit> -- .claude/memory/project.md');
  });

  it('writes nothing when it warns', () => {
    deployProject(asset, home, { warn });
    const p = join(home, '.claude', 'memory', 'project.md');
    const before = readFileSync(p, 'utf8');
    deployProject(asset, home, { warn });
    expect(readFileSync(p, 'utf8')).toBe(before);
  });

  it('stays silent once the host has written real prose', () => {
    deployProject(asset, home, { warn });
    writeFileSync(join(home, '.claude', 'memory', 'project.md'), `${STUB}\n- We chose X.\n`);
    warned.length = 0;
    deployProject(asset, home, { warn });
    expect(warned).toEqual([]);
  });
});

describe('backup report (BUG-049)', () => {
  it('[AC5] leaves files equal to the shipped templates untouched, with no backup and no report', () => {
    writeFileSync(join(home, 'CLAUDE.md'), TPL_PROJECT);
    writeFileSync(join(home, '.gitignore'), TPL_GITIGNORE);
    const c = capture();
    deployProject(asset, home, c.opts);
    expect(readFileSync(join(home, 'CLAUDE.md'), 'utf8')).toBe(TPL_PROJECT);
    expect(readFileSync(join(home, '.gitignore'), 'utf8')).toBe(TPL_GITIGNORE);
    expect(readdirSync(home).filter(n => n.includes('.installer-backup.'))).toEqual([]);
    expect(c.said).toEqual([]);
  });
  it('[AC8] reports each project backup with the exact line, and nothing on a re-run', () => {
    writeFileSync(join(home, 'CLAUDE.md'), '# Acme\n');
    writeFileSync(join(home, '.gitignore'), 'dist\n');
    const c = capture();
    deployProject(asset, home, c.opts);
    const claude = readdirSync(home).find(n => n.startsWith('CLAUDE.md.installer-backup.'));
    const ignore = readdirSync(home).find(n => n.startsWith('.gitignore.installer-backup.'));
    expect(c.said).toEqual([
      `code-conductor: backed up CLAUDE.md to ${claude} before merging (git-ignored by design)`,
      `code-conductor: backed up .gitignore to ${ignore} before merging (git-ignored by design)`,
    ]);
    c.said.length = 0;
    deployProject(asset, home, c.opts);
    expect(c.said).toEqual([]);
  });
  it('[AC8, R2] reports a global backup by its ~/.claude path, without the project ignore claim', () => {
    const dir = join(home, '.claude');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'CLAUDE.md'), '# Mine\n');
    const c = capture();
    deployGlobal(asset, home, c.opts);
    const backup = readdirSync(dir).find(n => n.includes('.installer-backup.'));
    expect(c.said).toEqual([`code-conductor: backed up ~/.claude/CLAUDE.md to ~/.claude/${backup} before merging`]);
  });
  it('[Review Focus 4, R2] reports a symlinked target\'s backup by its absolute path, without the ignore claim', () => {
    const real = join(asset, 'dotfiles-CLAUDE.md');
    writeFileSync(real, '# Acme\n');
    symlinkSync(real, join(home, 'CLAUDE.md'));
    const c = capture();
    deployProject(asset, home, c.opts);
    const backup = readdirSync(asset).find(n => n.startsWith('dotfiles-CLAUDE.md.installer-backup.'));
    expect(c.said).toEqual([`code-conductor: backed up CLAUDE.md to ${join(realpathSync(asset), backup)} before merging`]);
  });
  it('[AC9] keeps a backup byte-equal to the original across consecutive runs', () => {
    const original = '# Acme\n\n## Hard Constraints\n\n- our own rule\n';
    writeFileSync(join(home, 'CLAUDE.md'), original);
    for (let i = 0; i < 3; i++) deployProject(asset, home, capture().opts);
    const backups = readdirSync(home).filter(n => n.startsWith('CLAUDE.md.installer-backup.'));
    expect(backups.map(n => readFileSync(join(home, n), 'utf8'))).toContain(original);
    expect(readFileSync(join(home, 'CLAUDE.md'), 'utf8')).toBe(original + '\n' + PROJECT_BLOCK);
  });
  it('[AC10e] says once, on the warning channel, that existing entries stayed in place', () => {
    writeFileSync(join(home, '.gitignore'), '.claude/memory/turn-count.txt\n!keep.log\n');
    const c = capture();
    deployProject(asset, home, c.opts);
    deployProject(asset, home, c.opts);
    expect(c.warned.filter(m => m.includes('left the existing Code Conductor entries'))).toHaveLength(1);
  });
});
