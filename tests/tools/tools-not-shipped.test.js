import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deployProject } from '../../lib/installer/deploy.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// Gate 1 chose tools/ over scripts/ precisely because scripts/ SHIPS: package.json
// `files` lists it, deploy.mjs copies it to <cwd>/.claude/scripts/, and
// templates.test.js walks it as a shipped asset dir. That choice is worth nothing
// unless something stops tools/ drifting into the same state.
//
// The assertion is extracted so the discriminator can drive it with a deliberately
// defective manifest. A check that cannot be made to fail is not a check.
export function shipsTools(manifest) {
  return (manifest.files ?? []).some((entry) => entry.replace(/\/$/, '') === 'tools');
}

describe('tools/ is repo-only', () => {
  it('is absent from package.json files', () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    expect(shipsTools(manifest)).toBe(false);
  });

  it('DISCRIMINATOR: the same assertion goes red on a manifest that does ship it', () => {
    expect(shipsTools({ files: ['bin/', 'lib/', 'scripts/', 'tools/'] })).toBe(true);
  });
});

let asset, home;
beforeEach(() => {
  asset = mkdtempSync(join(tmpdir(), 'cc-asset-'));
  home = mkdtempSync(join(tmpdir(), 'cc-home-'));
  mkdirSync(join(asset, 'project-template', '.claude', 'commands'), { recursive: true });
  mkdirSync(join(asset, 'scripts'), { recursive: true });
  mkdirSync(join(asset, 'tools'), { recursive: true });
  writeFileSync(join(asset, 'scripts', 'conductor-db.mjs'), 'db-engine');
  writeFileSync(join(asset, 'tools', 'id-ceiling.mjs'), 'repo-only');
  writeFileSync(join(asset, 'project-template', 'CLAUDE.md'), '# Project Claude Configuration\n');
  writeFileSync(join(asset, 'project-template', 'gitignore'), '.claude/memory/turn-count.txt\n');
  writeFileSync(join(asset, 'project-template', '.claude', 'commands', 'cc-spec.md'), 'spec');
});
afterEach(() => {
  rmSync(asset, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

describe('deployProject', () => {
  it('copies scripts/ but never tools/, at either destination', () => {
    deployProject(asset, home);
    expect(existsSync(join(home, '.claude', 'scripts', 'conductor-db.mjs'))).toBe(true);
    expect(existsSync(join(home, '.claude', 'tools'))).toBe(false);
    expect(existsSync(join(home, 'tools'))).toBe(false);
  });
});
