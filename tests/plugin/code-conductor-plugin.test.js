import { describe, test, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync, statSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const PLUGIN_BASE = join(homedir(), '.claude', 'plugins', 'cache', 'code-conductor', 'code-conductor');
const PLUGIN_INSTALLED = existsSync(PLUGIN_BASE);

const describeIf = PLUGIN_INSTALLED ? describe : describe.skip;

describeIf('code-conductor plugin', () => {
  let pluginDir;

  beforeAll(() => {
    const versions = readdirSync(PLUGIN_BASE);
    expect(versions).toHaveLength(1);
    pluginDir = join(PLUGIN_BASE, versions[0]);
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
