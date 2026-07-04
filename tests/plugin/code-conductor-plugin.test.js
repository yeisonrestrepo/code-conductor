import { describe, test, expect } from 'vitest';
import { existsSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const SKILLS_DIR = join(homedir(), '.claude', 'skills');
const SKILLS = ['critical-review', 'memory-first', 'agent-delegation'];
const SKILLS_INSTALLED = SKILLS.every((s) => existsSync(join(SKILLS_DIR, s, 'SKILL.md')));

const describeIf = SKILLS_INSTALLED ? describe : describe.skip;

describeIf('code-conductor personal skills', () => {
  test.each(SKILLS)('SKILL.md for %s exists and is non-empty', (skill) => {
    const skillPath = join(SKILLS_DIR, skill, 'SKILL.md');
    expect(existsSync(skillPath)).toBe(true);
    expect(statSync(skillPath).size).toBeGreaterThan(0);
  });

  test.each(SKILLS)('SKILL.md for %s has name and description frontmatter', (skill) => {
    const content = readFileSync(join(SKILLS_DIR, skill, 'SKILL.md'), 'utf8');
    expect(content.startsWith('---')).toBe(true);
    expect(content).toMatch(new RegExp(`^name: ${skill}$`, 'm'));
    expect(content).toMatch(/^description: .+$/m);
  });

  test('old plugin cache dir is cleaned up', () => {
    const oldCache = join(homedir(), '.claude', 'plugins', 'cache', 'code-conductor');
    expect(existsSync(oldCache)).toBe(false);
  });

  test('dead enabledPlugins key is removed from settings.json', () => {
    const settingsPath = join(homedir(), '.claude', 'settings.json');
    if (!existsSync(settingsPath)) return;
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
    expect(settings.enabledPlugins?.['code-conductor@code-conductor']).toBeUndefined();
  });
});
