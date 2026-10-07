import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { scanHeadings } from '../../tools/id-ceiling.mjs';
import { readLocations, compare } from '../../tools/version-gate.mjs';
import { checkParity } from '../../tools/record-parity.mjs';

// These assert about THIS repository, not about the instruments. They live in their
// own file for that reason, following tests/unit/gitignore-block-parity.test.js and
// tests/unit/host-owned-ignore-xor.test.js. CONTRIBUTING.md states the CI gate is
// unconditional, so a red here blocks the merge. That is where halt semantics come
// from; no checklist line enforces anything.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
// The text between one "## " heading and the next, so a claim is checked where it is made.
const section = (text, heading) => {
  const start = text.indexOf(`\n## ${heading}\n`);
  if (start === -1) throw new Error(`no "## ${heading}" section`);
  const end = text.indexOf('\n## ', start + 1);
  return text.slice(start, end === -1 ? undefined : end);
};
const COUNT_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];

describe('this repository, at every commit', () => {
  it('agrees with VERSION at all five version locations', () => {
    const r = compare(readLocations(ROOT));
    expect(r.disagreements).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('keeps its CHANGELOG, backlog and VERSION in record parity', () => {
    const r = checkParity({
      backlogText: read('AGENT-READABLE BACKLOG.md'),
      changelogText: read('CHANGELOG.md'),
      versionFile: read('VERSION').trim(),
    });
    expect(r.violations.map((v) => v.detail)).toEqual([]);
    expect(r.ok).toBe(true);
  });

  // BUG-050: the merge gate once passed while this command failed on the same records,
  // hidden by a filter inside the test. The command itself is asserted here, so the gate
  // and the closeout can never disagree again.
  it('runs the record-parity command green against this repository', () => {
    const r = spawnSync(process.execPath, ['tools/record-parity.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(r.stdout).toContain('RECORD_PARITY_OK');
    expect(r.status).toBe(0);
  });

  // The ceiling itself is a query and is not asserted here: its remote leg needs a ref
  // actions/checkout@v7 does not fetch at its default depth, and fetch-depth: 0 was
  // declined because the both-legs filing rule already protects it. Duplicate-id
  // freedom is the assertable half, single leg, and it is the harm the ceiling exists
  // to prevent.
  it('files no id twice', () => {
    expect(scanHeadings(read('AGENT-READABLE BACKLOG.md')).duplicates).toEqual([]);
  });

  // FEAT-021: the package's defining constraints are zero dependencies and npm-native
  // distribution, and the graph hook was the only Python in it.
  it('tracks no Python file', () => {
    expect(execFileSync('git', ['ls-files', '*.py'], { cwd: ROOT, encoding: 'utf8' }).trim()).toBe('');
  });

  // FEAT-021: the graph rung is gone from every surface an agent reads or an install
  // ships. The heal must still name the hook to remove it, and its call site names the
  // heal and prints the upgrade notice; those two files are the whole allowed set.
  it('ships no graph-rung surface: only the heal and its call site name graphify', () => {
    const surfaces = ['global', 'skills', 'project-template', 'bin', 'lib', 'scripts', '.claude/commands', '.claude/hooks', '.claude/settings.json', 'README.md', 'CLAUDE.md'];
    const allowed = ['lib/installer/heal.mjs', 'bin/code-conductor.mjs'];
    const files = execFileSync('git', ['ls-files', ...surfaces], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
    expect(files.filter((f) => !allowed.includes(f) && /graphify/i.test(read(f)))).toEqual([]);
  });

  // FEAT-021, owner ruling 2: an exact set, so a new mention anywhere else fails rather
  // than growing an allowlist silently. Records are excluded; they describe history.
  // The needle is assembled, and named nowhere literally, so this file cannot match itself.
  it('names the Python interpreter command only in the two files whose subject it is', () => {
    const needle = ['python', '3'].join('');
    const records = [':!docs/superpowers', ':!CHANGELOG.md', ':!AGENT-READABLE BACKLOG.md', ':!.claude/memory'];
    const r = spawnSync('git', ['grep', '-l', needle, '--', '.', ...records], { cwd: ROOT, encoding: 'utf8' });
    const hits = r.stdout.split('\n').filter(Boolean).sort();
    expect(hits).toEqual(['tests/fixtures/guard3-corpus.js', 'tests/installer/heal.test.js']);
  });

  // FEAT-038: npm's description and GitHub's About line are the same sentence, and the
  // owner pastes the About from the spec, so this is the half an edit could drift alone.
  // ASCII only, because a curly apostrophe or an em dash arrives through a paste unseen.
  // The keyword list doubles as the GitHub topic list; its order is the one npm stores.
  it('describes itself with the one sentence and keyword list both listings carry', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.description).toBe(
      "A governance layer for Claude Code sessions: hooks that check an agent's commands before they run, a spec-first workflow, and project memory the next session reads."
    );
    expect(pkg.description).toMatch(/^[\x20-\x7e]+$/);
    expect(pkg.description.match(/[.!?](\s|$)/g)).toEqual(['.']);
    expect(pkg.keywords).toEqual([
      'agentic-development', 'ai-agents', 'claude', 'claude-code', 'claude-code-hooks', 'claudecode',
      'cli', 'developer-tools', 'guardrails', 'skills', 'spec-driven-development',
    ]);
  });

  // FEAT-038: npm renders this file on the package page, and a leading byte-order mark
  // sits ahead of the "#" its renderer needs to see first. Read as bytes, because the
  // utf8 read above keeps a BOM as U+FEFF and a text match would have to know to look.
  it('starts README.md with its heading byte, not a byte-order mark', () => {
    expect(readFileSync(join(ROOT, 'README.md'))[0]).toBe(0x23);
  });

  // 1.34.3, pre-launch audit sweep items 4 and 7: Known limits named one open filed
  // defect while the backlog had two. Derived, not counted by hand: a defect is listed
  // when its bullet's first token is its id, so passing mentions do not count.
  it('lists every open filed defect in Known limits, and only those', () => {
    const open = [...read('AGENT-READABLE BACKLOG.md').matchAll(/^### \[ \] `\[(BUG-\d+)\]`/gm)].map((m) => m[1]).sort();
    const listed = [...section(read('README.md'), 'Known limits').matchAll(/^- \*\*`\[(BUG-\d+)\]`/gm)].map((m) => m[1]).sort();
    expect(listed).toEqual(open);
  });

  // 1.34.3, sweep item 8: a dossier opened in a closeout commit left the README's count
  // behind. A minted dossier loses its heading, so this follows the pipeline's own rule.
  it('counts the open dossiers in Known limits as the backlog holds them', () => {
    const n = read('AGENT-READABLE BACKLOG.md').match(/^### DOSSIER /gm).length;
    expect(section(read('README.md'), 'Known limits')).toContain(`**${COUNT_WORDS[n]} open dossier`);
  });

  // 1.34.3, sweep item 9: skip-baseline.mjs shipped in 1.34.1 and the section still said
  // three. Every tracked instrument is named, and the count leads the section.
  it('names every tools/ instrument in the Instruments section, with their count', () => {
    const tools = execFileSync('git', ['ls-files', 'tools/*.mjs'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
    const text = section(read('README.md'), 'Instruments: releases that verify their own record');
    expect(tools.filter((t) => !text.includes(`**\`${t.slice('tools/'.length)}\`**`))).toEqual([]);
    expect(text).toContain(`${COUNT_WORDS[tools.length]} checks live in \`tools/\``);
  });

  // 1.34.3, sweep item 10: the README said the installer downloads ui-ux-pro-max from
  // GitHub. No shipped code has done so since the curl download was replaced and later
  // dropped; FEAT-037 owns its replacement. The claim, not the name, is what is barred.
  it('claims no automatic install of ui-ux-pro-max, which no shipped code performs', () => {
    expect(read('README.md')).not.toMatch(/nextlevelbuilder|downloads it (directly )?from GitHub|activated automatically for frontend/i);
  });

  // 1.34.4, BUG-049 AC13: the README names the oldest release that neither overwrites nor
  // silently strips a host CLAUDE.md, where installs are described. The floor can only
  // name a release that exists, so it may never run ahead of VERSION.
  it('states one minimum safe version where installs are described, never above VERSION', () => {
    const FLOOR = /\*\*Minimum safe version: `(\d+\.\d+\.\d+)`\.\*\*/;
    const floors = ['Quickstart', 'Install'].map((h) => section(read('README.md'), h).match(FLOOR)?.[1]);
    expect(floors[0]).toBeDefined();
    expect(floors[1]).toBe(floors[0]);
    const [f, v] = [floors[0], read('VERSION').trim()].map((s) => s.split('.').map(Number));
    const firstDiff = f.findIndex((n, i) => n !== v[i]);
    expect(firstDiff === -1 || f[firstDiff] < v[firstDiff]).toBe(true);
    for (const h of ['Quickstart', 'Install']) expect(section(read('README.md'), h)).toContain('code-conductor@latest');
  });

  // BUG-032: a preference file the lookup chain never names is never read. The chain in
  // the global CLAUDE.md and the memory-first skill that enforces it must name the same
  // two memory files, so neither can drift back to project memory alone.
  it('names both memory files in the lookup chain, and memory-first step 1 agrees', () => {
    const PATHS = ['.claude/memory/project.md', '~/.claude/memory/personal.md'];
    const chainStep = section(read('global/CLAUDE.md'), 'Orchestrator Protocol').match(/^1\. \*\*Memory\*\*.*$/m)?.[0];
    const skill = read('skills/memory-first/SKILL.md');
    const skillStep = skill.slice(skill.indexOf('### 1. '), skill.indexOf('### 2. '));
    for (const p of PATHS) {
      expect(chainStep).toContain(`\`${p}\``);
      expect(skillStep).toContain(`\`${p}\``);
    }
  });
});
