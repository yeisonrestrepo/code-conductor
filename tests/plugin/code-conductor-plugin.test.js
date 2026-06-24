import { describe, test, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync, statSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PKG_VERSION = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')).version;
const PLUGIN_BASE = join(homedir(), '.claude', 'plugins', 'cache', 'code-conductor', 'code-conductor');
const PLUGIN_INSTALLED = existsSync(join(PLUGIN_BASE, PKG_VERSION));

const describeIf = PLUGIN_INSTALLED ? describe : describe.skip;

describeIf('code-conductor plugin', () => {
  let pluginDir;

  beforeAll(() => {
    pluginDir = join(PLUGIN_BASE, PKG_VERSION);
  });

  test('versioned plugin directory exists', () => {
    expect(existsSync(pluginDir)).toBe(true);
  });

  test('plugin.json has all 4 required fields', () => {
    const jsonPath = join(pluginDir, '.claude-plugin', 'plugin.json');
    expect(existsSync(jsonPath)).toBe(true);
    const pj = JSON.parse(readFileSync(jsonPath, 'utf8'));
    expect(pj.name).toBe('code-conductor');
    expect(typeof pj.version).toBe('string');
    expect(pj.version.length).toBeGreaterThan(0);
    expect(typeof pj.description).toBe('string');
    expect(pj.description.length).toBeGreaterThan(0);
    expect(pj.author && pj.author.name).toBe('code-conductor');
  });

  test.each(['critical-review', 'memory-first', 'agent-delegation'])(
    'SKILL.md for %s exists and is non-empty',
    (skill) => {
      const skillPath = join(pluginDir, 'skills', skill, 'SKILL.md');
      expect(existsSync(skillPath)).toBe(true);
      expect(statSync(skillPath).size).toBeGreaterThan(0);
    }
  );
});
