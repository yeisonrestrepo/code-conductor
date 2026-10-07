import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deployGlobal, deployProject } from '../../lib/installer/deploy.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REL = 'project-template/.claude/review-loop.settings.json';
// The owner-approved exception of 2026-10-06, byte for byte (FEAT-041 (f)). Changing it is an owner decision.
const EXCEPTION = "Orchestrator revision rounds (code-conductor FEAT-041): during a live /cc-orchestrate run, the main session may use SendMessage to a spec or plan band agent that has already handed back, asking it to revise its own document under docs/superpowers/specs/ or docs/superpowers/plans/ and to report the revision as prose without a SNAP_HANDBACK line. This is the project's reviewer-in-loop protocol, not an evasion of oversight: the agent's edits remain subject to the project's PreToolUse guards, and the owner's boundary approval still follows.";
const SHA256 = '05ce114dfb80f28eedc7e3537092356b6bea1c7ba68afe9ae2316212b75e6d4c';
const LAUNCH = 'claude --permission-mode auto --settings .claude/review-loop.settings.json';
const read = (path) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const quiet = { warn: () => {}, report: () => {} };

let home, cwd;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'cc-rl-home-'));
  cwd = mkdtempSync(join(tmpdir(), 'cc-rl-proj-'));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

describe('review loop configuration [FEAT-041 AC7-AC9]', () => {
  it('[AC7] holds exactly $defaults and the approved exception', () => {
    expect(JSON.parse(read(join(ROOT, REL)))).toEqual({ autoMode: { allow: ['$defaults', EXCEPTION] } });
  });

  it('[AC7] is pinned by its sha256', () => {
    expect(createHash('sha256').update(read(join(ROOT, REL))).digest('hex')).toBe(SHA256);
  });

  it('deploys to .claude/review-loop.settings.json unchanged', () => {
    deployProject(ROOT, cwd, quiet);
    expect(read(join(cwd, '.claude', 'review-loop.settings.json'))).toBe(read(join(ROOT, REL)));
  });

  it('[AC9] the installer writes no autoMode to the global or project settings', () => {
    deployGlobal(ROOT, home, quiet);
    deployProject(ROOT, cwd, quiet);
    for (const path of [join(home, '.claude', 'settings.json'), join(cwd, '.claude', 'settings.json')]) {
      expect(existsSync(path)).toBe(true);
      expect(read(path)).not.toContain('autoMode');
    }
  });

  it('[AC8] README declares the three configurations and the launch line', () => {
    const text = read(join(ROOT, 'README.md'));
    for (const phrase of ['### Review loop configurations', LAUNCH, '| Default (ask) permission mode |', '| Plain auto mode |', 'skipped:denied']) {
      expect(text).toContain(phrase);
    }
  });
});
