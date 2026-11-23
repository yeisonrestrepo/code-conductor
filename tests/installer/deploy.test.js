import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CAN_SYMLINK } from '../helpers/can-symlink.js';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, lstatSync, chmodSync, symlinkSync, readlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertAssets, deployGlobal, deployProject, chmodHooks, assertMergeTargets } from '../../lib/installer/deploy.mjs';
import { SENTINEL_START, SENTINEL_END, GITIGNORE_HEADER } from '../../lib/installer/merge-md.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LEGACY_STUB = readFileSync(join(ROOT, 'tests', 'fixtures', 'legacy-project-memory-stub.md'), 'utf8');
const GLOBAL_BLOCK = [SENTINEL_START, '## Workflow', '', 'Spec, then plan, then implement.', '', '## Safety', '', 'Confirm before writes.', SENTINEL_END, ''].join('\n');
const TPL_GLOBAL = ['# Global Claude Configuration', '', GLOBAL_BLOCK].join('\n');
const PROJECT_BLOCK = [SENTINEL_START, '## Agent Identity', '', 'You are an orchestrator.', '', '## Hard Constraints', '', '- Never hardcode secrets.', SENTINEL_END, ''].join('\n');
const TPL_PROJECT = ['# Project Claude Configuration', '', '## Project Identity', '', '- Name: TBD', '', '## Conventions', '', '- TBD', '', PROJECT_BLOCK].join('\n');

const TPL_GITIGNORE = `${GITIGNORE_HEADER}\n.claude/memory/turn-count.txt\n*.installer-backup.*\n*.installer-tmp.*\n.claude/memory/band-envelope.json\n.claude/memory/orchestrator-run.json\n.conductor/\n`;
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
const POSIX_NON_ROOT = process.platform !== 'win32' && process.getuid?.() !== 0;

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
  it('ships the merge engine so the deployed adopt-claude-md.mjs runs [FEAT-040]', () => {
    deployProject(ROOT, home);
    const deployed = join(home, '.claude', 'lib', 'installer', 'merge-md.mjs');
    expect(readFileSync(deployed)).toEqual(readFileSync(join(ROOT, 'lib', 'installer', 'merge-md.mjs')));
    const host = join(home, 'HOST.md');
    writeFileSync(host, '## Team Rules\nbe kind\n');
    const run = spawnSync('node', [join(home, '.claude', 'scripts', 'adopt-claude-md.mjs'), 'sections', host], { encoding: 'utf8' });
    expect(run.status).toBe(0);
    expect(JSON.parse(run.stdout).trigger).toBe(true);
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
    // The source tree satisfies the legacy sweep by identity: same file list as the bundle.
    mkdirSync(join(home, 'scripts'));
    writeFileSync(join(home, 'scripts', 'conductor-db.mjs'), 'tracked source');
    expect(() => deployProject(asset, home)).toThrow(/SELF_INSTALL|own source tree/);
    expect(existsSync(join(home, '.claude'))).toBe(false);
    expect(readFileSync(join(home, 'scripts', 'conductor-db.mjs'), 'utf8')).toBe('tracked source');
  });
  // BUG-052 AC2: a host that owns a package.json still gets the 1.23.2 legacy sweep.
  it('[BUG-052] still sweeps the legacy root scripts/ in a host with its own package.json', () => {
    writeFileSync(join(asset, 'package.json'), JSON.stringify({ name: '@test/code-conductor' }));
    writeFileSync(join(home, 'package.json'), JSON.stringify({ name: 'my-project' }));
    mkdirSync(join(home, 'scripts'));
    writeFileSync(join(home, 'scripts', 'conductor-db.mjs'), 'legacy copy');
    deployProject(asset, home);
    expect(existsSync(join(home, 'scripts'))).toBe(false);
    expect(readFileSync(join(home, '.claude', 'scripts', 'conductor-db.mjs'), 'utf8')).toBe('db-engine');
  });
  // A tree whose package.json cannot be read is suspect state, never a green light to sweep.
  it('[BUG-052] refuses, naming the path, when the host package.json cannot be read', () => {
    writeFileSync(join(asset, 'package.json'), JSON.stringify({ name: '@test/code-conductor' }));
    mkdirSync(join(home, 'package.json'));
    expect(() => deployProject(asset, home)).toThrow(/cannot read .*package\.json/);
    expect(existsSync(join(home, '.claude'))).toBe(false);
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
  it.skipIf(!CAN_SYMLINK)('merges a symlinked CLAUDE.md through realpath and keeps the link', () => {
    const real = join(asset, 'dotfiles-CLAUDE.md');
    writeFileSync(real, '# Acme\n\n## Deployment\n\nkubectl\n');
    symlinkSync(real, join(home, 'CLAUDE.md'));
    deployProject(asset, home);
    expect(lstatSync(join(home, 'CLAUDE.md')).isSymbolicLink()).toBe(true);
    expect(readFileSync(real, 'utf8')).toContain('## Agent Identity');
  });
  it.skipIf(!CAN_SYMLINK)('merges a symlinked .gitignore through realpath and keeps the link', () => {
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

  // (#94) 1.28/1.29 re-runs wrote the old history-laden stub, not today's.
  it('warns once, and writes nothing, when the host copy is the stub 1.28/1.29 shipped', () => {
    const p = join(home, '.claude', 'memory', 'project.md');
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, LEGACY_STUB);
    deployProject(asset, home, { warn });
    expect(warned).toHaveLength(1);
    expect(warned[0]).toContain('may have been overwritten');
    expect(readFileSync(p, 'utf8')).toBe(LEGACY_STUB);
  });

  // An autocrlf=true clone on Windows wrote that stub with CRLF endings.
  it('warns once, and writes nothing, when the 1.28/1.29 stub was written with CRLF', () => {
    const p = join(home, '.claude', 'memory', 'project.md');
    const crlf = LEGACY_STUB.replace(/\r?\n/g, '\r\n');
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, crlf);
    deployProject(asset, home, { warn });
    expect(warned).toHaveLength(1);
    expect(warned[0]).toContain('may have been overwritten');
    expect(readFileSync(p, 'utf8')).toBe(crlf);
  });
});

describe('deployProject: real template memory stub (#94)', () => {
  it('a fresh scaffold warns nothing beyond the one FEAT-044 flow report and seeds a stub with no code-conductor history', () => {
    const warned = [];
    deployProject(ROOT, home, { warn: (m) => warned.push(m), report: (m) => warned.push(m) });
    // Baseline moved by FEAT-044 landing beside #94: a fresh scaffold now legitimately
    // reports the flow status line it adds, exactly once. Anything else (the legacy
    // overwrite warning this test exists to rule out included) still fails.
    expect(warned).toEqual(['code-conductor: added the flow status line to .claude/settings.json (node .claude/flow-status.mjs)']);
    const seeded = readFileSync(join(home, '.claude', 'memory', 'project.md'), 'utf8');
    expect(seeded).not.toMatch(/\b(BUG|FEAT)-\d+/);
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
  it.skipIf(!CAN_SYMLINK)('[Review Focus 4, R2] reports a symlinked target\'s backup by its absolute path, without the ignore claim', () => {
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

// FEAT-044 T-009. The rule itself is covered end to end in flow-status.test.js; these pin
// the deploy wiring: the merge runs only when the template ships the script it points at.
describe('deployProject: flow status line (FEAT-044)', () => {
  const settings = () => JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf8'));
  beforeEach(() => {
    writeFileSync(join(asset, 'project-template', '.claude', 'settings.json'), '{\n  "hooks": {}\n}\n');
  });

  it('adds nothing and says nothing when the template ships no flow-status.mjs', () => {
    const c = capture();
    deployProject(asset, home, c.opts);
    expect(settings().statusLine).toBeUndefined();
    expect(c.said).toEqual([]);
  });

  it('adds the entry and reports it once when the template ships the script', () => {
    writeFileSync(join(asset, 'project-template', '.claude', 'flow-status.mjs'), '// status\n');
    const c = capture();
    deployProject(asset, home, c.opts);
    expect(settings().statusLine).toEqual({ type: 'command', command: 'node .claude/flow-status.mjs' });
    expect(c.said).toEqual(['code-conductor: added the flow status line to .claude/settings.json (node .claude/flow-status.mjs)']);
  });

  it('consults the user settings only through the home option', () => {
    writeFileSync(join(asset, 'project-template', '.claude', 'flow-status.mjs'), '// status\n');
    const user = mkdtempSync(join(tmpdir(), 'cc-user-'));
    mkdirSync(join(user, '.claude'));
    writeFileSync(join(user, '.claude', 'settings.json'), '{"statusLine":{"type":"command","command":"mine"}}\n');
    deployProject(asset, home, { ...capture().opts, home: user });
    expect(settings().statusLine).toBeUndefined();
    rmSync(user, { recursive: true, force: true });
  });
});

// FEAT-048 slice 1 (#97): the OpenCode plugin ships inside project-template/.opencode/
// but lands only on request, so a Claude Code install stays byte for byte as it was.
describe('deployProject: OpenCode plugin (FEAT-048)', () => {
  const PLUGIN_REL = join('.opencode', 'plugin', 'conductor-guard.js');
  const PLUGIN_DIR = join('.opencode', 'plugin');
  const SHIPPED = 'export const ConductorGuard = 1;\n';
  const INSTALLED = 'code-conductor: installed the OpenCode guard plugin at .opencode/plugin/conductor-guard.js';
  const OUTSIDE_TEXT = '// a file outside the project\n';
  // Link targets with control bytes are a POSIX fact; win32 rejects them in paths (BUG-088).
  const POSIX_SYMLINK = process.platform !== 'win32' && CAN_SYMLINK;
  const replacedLine = (shown) => `code-conductor: replaced the symlink at .opencode/plugin/conductor-guard.js (it pointed to ${shown}) with the shipped plugin; the file it pointed to was not touched`;
  const backupsIn = (dir) => readdirSync(dir).filter((n) => n.startsWith('conductor-guard.js.installer-backup.'));
  beforeEach(() => {
    mkdirSync(join(asset, 'project-template', '.opencode', 'plugin'), { recursive: true });
    writeFileSync(join(asset, 'project-template', PLUGIN_REL), 'export const ConductorGuard = 1;\n');
  });
  it('writes no .opencode/ without the opencode option', () => {
    const out = capture();
    deployProject(asset, home, out.opts);
    expect(existsSync(join(home, '.opencode'))).toBe(false);
    expect(out.said.some((m) => /OpenCode/.test(m))).toBe(false);
  });
  it('installs the plugin byte for byte and reports it with the opencode option', () => {
    const out = capture();
    deployProject(asset, home, { ...out.opts, opencode: true });
    expect(readFileSync(join(home, PLUGIN_REL), 'utf8')).toBe('export const ConductorGuard = 1;\n');
    expect(out.said).toContain('code-conductor: installed the OpenCode guard plugin at .opencode/plugin/conductor-guard.js');
  });
  it('keeps the host project\'s own .opencode/ files', () => {
    mkdirSync(join(home, '.opencode', 'command'), { recursive: true });
    writeFileSync(join(home, '.opencode', 'command', 'mine.md'), 'host');
    deployProject(asset, home, { ...capture().opts, opencode: true });
    expect(readFileSync(join(home, '.opencode', 'command', 'mine.md'), 'utf8')).toBe('host');
  });
  it('[BUG-069] backs up a host-edited plugin, installs the shipped one and reports the backup first', () => {
    mkdirSync(join(home, PLUGIN_DIR), { recursive: true });
    writeFileSync(join(home, PLUGIN_REL), '// my edits\n');
    const out = capture();
    deployProject(asset, home, { ...out.opts, opencode: true });
    const backups = backupsIn(join(home, PLUGIN_DIR));
    expect(backups).toHaveLength(1);
    expect(readFileSync(join(home, PLUGIN_DIR, backups[0]), 'utf8')).toBe('// my edits\n');
    expect(readFileSync(join(home, PLUGIN_REL), 'utf8')).toBe(SHIPPED);
    expect(out.said).toEqual([
      `code-conductor: backed up .opencode/plugin/conductor-guard.js to .opencode/plugin/${backups[0]} before replacing it (git-ignored by design)`,
      'code-conductor: installed the OpenCode guard plugin at .opencode/plugin/conductor-guard.js',
    ]);
  });
  it('[BUG-069] leaves a byte-identical plugin alone, with no backup and no backup line', () => {
    mkdirSync(join(home, PLUGIN_DIR), { recursive: true });
    writeFileSync(join(home, PLUGIN_REL), SHIPPED);
    const out = capture();
    deployProject(asset, home, { ...out.opts, opencode: true });
    expect(backupsIn(join(home, PLUGIN_DIR))).toEqual([]);
    expect(out.said).toEqual(['code-conductor: installed the OpenCode guard plugin at .opencode/plugin/conductor-guard.js']);
  });
  it.skipIf(!POSIX_NON_ROOT)('[BUG-069] leaves the host plugin untouched and says nothing installed when the backup fails', () => {
    mkdirSync(join(home, PLUGIN_DIR), { recursive: true });
    writeFileSync(join(home, PLUGIN_REL), '// my edits\n');
    const out = capture();
    chmodSync(join(home, PLUGIN_DIR), 0o555);
    try {
      deployProject(asset, home, { ...out.opts, opencode: true });
    } finally {
      chmodSync(join(home, PLUGIN_DIR), 0o755);
    }
    expect(readFileSync(join(home, PLUGIN_REL), 'utf8')).toBe('// my edits\n');
    expect(backupsIn(join(home, PLUGIN_DIR))).toEqual([]);
    expect(out.warned.some((m) => /could not back it up/.test(m))).toBe(true);
    expect(out.said.some((m) => /OpenCode/.test(m))).toBe(false);
  });
  it.skipIf(!CAN_SYMLINK)('[BUG-087] replaces a symlinked plugin with a regular file and leaves the file it pointed to outside the project untouched', () => {
    const outside = mkdtempSync(join(tmpdir(), 'cc-outside-'));
    try {
      writeFileSync(join(outside, 'victim.js'), OUTSIDE_TEXT);
      mkdirSync(join(home, PLUGIN_DIR), { recursive: true });
      symlinkSync(join(outside, 'victim.js'), join(home, PLUGIN_REL));
      const linkText = readlinkSync(join(home, PLUGIN_REL));
      const out = capture();
      deployProject(asset, home, { ...out.opts, opencode: true });
      expect(readFileSync(join(outside, 'victim.js'), 'utf8')).toBe(OUTSIDE_TEXT);
      expect(readdirSync(outside)).toEqual(['victim.js']);
      expect(lstatSync(join(home, PLUGIN_REL)).isSymbolicLink()).toBe(false);
      expect(lstatSync(join(home, PLUGIN_REL)).isFile()).toBe(true);
      expect(readFileSync(join(home, PLUGIN_REL), 'utf8')).toBe(SHIPPED);
      expect(out.warned).toEqual([`code-conductor: replaced the symlink at .opencode/plugin/conductor-guard.js (it pointed to ${linkText}) with the shipped plugin; the file it pointed to was not touched`]);
      expect(out.said).toEqual([INSTALLED]);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
  it.skipIf(!CAN_SYMLINK)('[BUG-087] replaces a dangling symlink at the plugin path and installs the plugin', () => {
    mkdirSync(join(home, PLUGIN_DIR), { recursive: true });
    symlinkSync(join(home, 'missing-target.js'), join(home, PLUGIN_REL));
    const linkText = readlinkSync(join(home, PLUGIN_REL));
    const out = capture();
    deployProject(asset, home, { ...out.opts, opencode: true });
    expect(lstatSync(join(home, PLUGIN_REL)).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(home, PLUGIN_REL), 'utf8')).toBe(SHIPPED);
    expect(existsSync(join(home, 'missing-target.js'))).toBe(false);
    expect(out.warned).toEqual([`code-conductor: replaced the symlink at .opencode/plugin/conductor-guard.js (it pointed to ${linkText}) with the shipped plugin; the file it pointed to was not touched`]);
    expect(out.said).toEqual([INSTALLED]);
  });
  it.skipIf(!POSIX_NON_ROOT || !CAN_SYMLINK)('[BUG-087] leaves the symlink and its target alone and says nothing installed when the link cannot be removed', () => {
    const outside = mkdtempSync(join(tmpdir(), 'cc-outside-'));
    try {
      writeFileSync(join(outside, 'victim.js'), OUTSIDE_TEXT);
      mkdirSync(join(home, PLUGIN_DIR), { recursive: true });
      symlinkSync(join(outside, 'victim.js'), join(home, PLUGIN_REL));
      const linkText = readlinkSync(join(home, PLUGIN_REL));
      const out = capture();
      chmodSync(join(home, PLUGIN_DIR), 0o555);
      try {
        deployProject(asset, home, { ...out.opts, opencode: true });
      } finally {
        chmodSync(join(home, PLUGIN_DIR), 0o755);
      }
      expect(lstatSync(join(home, PLUGIN_REL)).isSymbolicLink()).toBe(true);
      expect(readlinkSync(join(home, PLUGIN_REL))).toBe(linkText);
      expect(readFileSync(join(outside, 'victim.js'), 'utf8')).toBe(OUTSIDE_TEXT);
      expect(readdirSync(outside)).toEqual(['victim.js']);
      expect(out.warned).toEqual(['code-conductor: skipping .opencode/plugin/conductor-guard.js — it is a symlink and could not be removed (EACCES); nothing was written']);
      expect(out.said.some((m) => /OpenCode/.test(m))).toBe(false);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
  it.skipIf(!POSIX_SYMLINK)('[BUG-088] escapes control characters in the link text of the replaced-symlink warning', () => {
    const target = 'evil\x1b[2K\rcode-conductor: all good\n.js';
    mkdirSync(join(home, PLUGIN_DIR), { recursive: true });
    symlinkSync(target, join(home, PLUGIN_REL));
    expect(readlinkSync(join(home, PLUGIN_REL))).toBe(target);
    const out = capture();
    deployProject(asset, home, { ...out.opts, opencode: true });
    expect(out.warned).toHaveLength(1);
    expect(out.warned[0]).not.toMatch(/[\x00-\x1f\x7f-\x9f]/);
    expect(out.warned[0]).toContain('\\x1b');
    expect(out.warned[0]).toContain('\\x0d');
    expect(out.warned[0]).toContain('\\x0a');
    expect(out.warned[0]).toBe(replacedLine('evil\\x1b[2K\\x0dcode-conductor: all good\\x0a.js'));
    expect(lstatSync(join(home, PLUGIN_REL)).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(home, PLUGIN_REL), 'utf8')).toBe(SHIPPED);
    expect(out.said).toEqual([INSTALLED]);
  });
  it.skipIf(!POSIX_SYMLINK)('[BUG-088] escapes C1 control characters and keeps printable non-ASCII in the replaced-symlink warning', () => {
    const target = 'código\u009b2Kfin.js';
    mkdirSync(join(home, PLUGIN_DIR), { recursive: true });
    symlinkSync(target, join(home, PLUGIN_REL));
    expect(readlinkSync(join(home, PLUGIN_REL))).toBe(target);
    const out = capture();
    deployProject(asset, home, { ...out.opts, opencode: true });
    expect(out.warned).toEqual([replacedLine('código\\x9b2Kfin.js')]);
    expect(out.warned[0]).not.toMatch(/[\x00-\x1f\x7f-\x9f]/);
    expect(out.said).toEqual([INSTALLED]);
  });
  it('ships the real plugin in the template', () => {
    expect(existsSync(join(ROOT, 'project-template', PLUGIN_REL))).toBe(true);
  });
});

// FEAT-048 slice 2 (#97): the Antigravity guard ships inside project-template/.agents/
// but lands only with the antigravity option; its hooks.json is merged, never replaced.
describe('deployProject: Antigravity guard (FEAT-048)', () => {
  const GUARD_REL = join('.agents', 'hooks', 'conductor-guard.mjs');
  const HOOKS_REL = join('.agents', 'hooks.json');
  const SHIPPED = '// shipped agy guard\n';
  const OURS = { matcher: '.*', hooks: [{ type: 'command', command: 'node hooks/conductor-guard.mjs' }] };
  const SHIPPED_HOOKS = `${JSON.stringify({ hooks: { PreToolUse: [OURS] } }, null, 2)}\n`;
  const INSTALLED = 'code-conductor: installed the Antigravity guard at .agents/hooks/conductor-guard.mjs';
  const hooksOf = (dir) => JSON.parse(readFileSync(join(dir, HOOKS_REL), 'utf8'));
  beforeEach(() => {
    mkdirSync(join(asset, 'project-template', '.agents', 'hooks'), { recursive: true });
    writeFileSync(join(asset, 'project-template', GUARD_REL), SHIPPED);
    writeFileSync(join(asset, 'project-template', HOOKS_REL), SHIPPED_HOOKS);
  });
  it('writes no .agents/ without the antigravity option', () => {
    const out = capture();
    deployProject(asset, home, out.opts);
    expect(existsSync(join(home, '.agents'))).toBe(false);
    expect(out.said.some((m) => /Antigravity/.test(m))).toBe(false);
  });
  it('installs the guard byte for byte and creates hooks.json with the antigravity option', () => {
    const out = capture();
    deployProject(asset, home, { ...out.opts, antigravity: true });
    expect(readFileSync(join(home, GUARD_REL), 'utf8')).toBe(SHIPPED);
    expect(readFileSync(join(home, HOOKS_REL), 'utf8')).toBe(SHIPPED_HOOKS);
    expect(out.said).toContain(INSTALLED);
  });
  it('keeps a host PreToolUse entry, adds ours once and leaves a re-run unchanged', () => {
    const host = { matcher: 'run_command', hooks: [{ type: 'command', command: 'node mine.mjs' }] };
    mkdirSync(join(home, '.agents'), { recursive: true });
    writeFileSync(join(home, HOOKS_REL), JSON.stringify({ hooks: { PreToolUse: [host] } }));
    deployProject(asset, home, { ...capture().opts, antigravity: true });
    const first = readFileSync(join(home, HOOKS_REL), 'utf8');
    expect(hooksOf(home).hooks.PreToolUse).toEqual([host, OURS]);
    deployProject(asset, home, { ...capture().opts, antigravity: true });
    expect(readFileSync(join(home, HOOKS_REL), 'utf8')).toBe(first);
  });
  it('backs up a malformed host hooks.json and writes the shipped one', () => {
    mkdirSync(join(home, '.agents'), { recursive: true });
    writeFileSync(join(home, HOOKS_REL), '{ not json');
    const out = capture();
    deployProject(asset, home, { ...out.opts, antigravity: true });
    expect(readFileSync(join(home, HOOKS_REL), 'utf8')).toBe(SHIPPED_HOOKS);
    expect(readdirSync(join(home, '.agents')).some((n) => n.startsWith('hooks.json.') && n !== 'hooks.json')).toBe(true);
    expect(out.warned.some((m) => /hooks\.json was not valid JSON/.test(m))).toBe(true);
  });
  it('keeps the host project\'s own .agents/ files', () => {
    mkdirSync(join(home, '.agents'), { recursive: true });
    writeFileSync(join(home, '.agents', 'other.md'), 'host');
    deployProject(asset, home, { ...capture().opts, antigravity: true });
    expect(readFileSync(join(home, '.agents', 'other.md'), 'utf8')).toBe('host');
  });
  it.skipIf(!CAN_SYMLINK)('replaces a symlinked guard path and leaves the link target untouched', () => {
    const outside = join(home, 'outside.mjs');
    writeFileSync(outside, '// outside\n');
    mkdirSync(join(home, '.agents', 'hooks'), { recursive: true });
    symlinkSync(outside, join(home, GUARD_REL));
    const out = capture();
    deployProject(asset, home, { ...out.opts, antigravity: true });
    expect(lstatSync(join(home, GUARD_REL)).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(home, GUARD_REL), 'utf8')).toBe(SHIPPED);
    expect(readFileSync(outside, 'utf8')).toBe('// outside\n');
  });
  it('ships the real guard and hooks.json in the template', () => {
    expect(existsSync(join(ROOT, 'project-template', GUARD_REL))).toBe(true);
    expect(existsSync(join(ROOT, 'project-template', HOOKS_REL))).toBe(true);
  });
});
