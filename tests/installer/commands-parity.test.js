import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8').replace(/\r\n/g, '\n');

// `deployProject` nests scripts under `.claude/scripts/` in a scaffolded project, so the
// template mirror rewrites the script paths. These two targeted substitutions are the exact
// inverse of the regeneration step, and the only sanctioned divergence between the files.
// A blanket `.claude/scripts/` rewrite would also hit prose that legitimately mentions the
// deployed layout in BOTH mirrors, and false-fail this test.
const unnest = (text) =>
  text
    .split('node .claude/scripts/').join('node scripts/')
    .split('running `.claude/scripts/').join('running `scripts/');

const MIRRORS = ['.claude/commands/cc-plan.md', 'project-template/.claude/commands/cc-plan.md'];

describe('cc-plan mirrors', () => {
  it('differ only in the script path nesting', () => {
    expect(unnest(read(MIRRORS[1]))).toBe(read(MIRRORS[0]));
  });

  it.each(MIRRORS)('%s carries the branch gate before its exit line', (rel) => {
    const text = read(rel);
    const gate = text.indexOf('### Branch gate (runs before Task 0)');
    const exit = text.indexOf('Plan complete. Run `/cc-compact`');
    expect(gate).toBeGreaterThan(-1);
    expect(exit).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(exit);
  });

  it.each(MIRRORS)('%s states the Task 0 ordering precondition', (rel) => {
    expect(read(rel)).toContain(
      "before any step of the approved plan's Task 0 executes",
    );
  });

  it.each(MIRRORS)('%s pins the exact git invocations the gate depends on', (rel) => {
    const text = read(rel);
    for (const cmd of [
      'git branch --show-current',
      'git symbolic-ref --short refs/remotes/origin/HEAD',
      'git check-ref-format --branch',
      'git rev-parse --verify --quiet',
      'git switch -c',
    ]) {
      expect(text).toContain(cmd);
    }
  });
});

const INIT_MIRRORS = ['.claude/commands/cc-init.md', 'project-template/.claude/commands/cc-init.md'];

describe('cc-init mirrors', () => {
  it('differ only in the script path nesting', () => {
    expect(unnest(read(INIT_MIRRORS[1]))).toBe(read(INIT_MIRRORS[0]));
  });

  it('the template resolves the scripts to their deployed location', () => {
    expect(read(INIT_MIRRORS[1])).toContain('node .claude/scripts/init-wizard.mjs report');
    expect(read(INIT_MIRRORS[1])).toContain('node .claude/scripts/detect-stack.mjs');
  });

  it.each(INIT_MIRRORS)('%s sequences report before check before apply', (rel) => {
    const text = read(rel);
    const report = text.indexOf('init-wizard.mjs report');
    const check  = text.indexOf('init-wizard.mjs check build --value-stdin');
    const apply  = text.indexOf('init-wizard.mjs apply build --value-stdin');
    expect(report).toBeGreaterThan(-1);
    expect(report).toBeLessThan(check);
    expect(check).toBeLessThan(apply);
  });

  it.each(INIT_MIRRORS)('%s pins the quoted heredoc as the value channel', (rel) => {
    const text = read(rel);
    expect(text).toContain("<<'CC_VALUE'");
    expect(text).toContain('--value-stdin');
  });

  it.each(INIT_MIRRORS)('%s no longer carries the superseded wording', (rel) => {
    const text = read(rel);
    expect(text).not.toContain('(any case)');          // the predicate is case-sensitive
    expect(text).not.toContain('stdin is not a TTY');  // agent Bash never has one
    expect(text).not.toContain('If **Name** is still empty');
  });
});
