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
// The third rule covers an invocation whose path follows a flags placeholder
// (`node <chosen-flags> .claude/scripts/…`, `node <probe-flags> .claude/scripts/…`),
// which the first rule cannot see because `node` and the path are not adjacent.
// Still a script path, still the exact inverse of the regeneration step.
const unnest = (text) =>
  text
    .split('node .claude/scripts/').join('node scripts/')
    .split('-flags> .claude/scripts/').join('-flags> scripts/')
    .split('running `.claude/scripts/').join('running `scripts/');

const PLAN_MIRRORS = ['.claude/commands/cc-plan.md', 'project-template/.claude/commands/cc-plan.md'];

describe('cc-plan mirrors', () => {
  it('differ only in the script path nesting', () => {
    expect(unnest(read(PLAN_MIRRORS[1]))).toBe(read(PLAN_MIRRORS[0]));
  });

  it.each(PLAN_MIRRORS)('%s carries the branch gate before its exit line', (rel) => {
    const text = read(rel);
    const gate = text.indexOf('### Branch gate (runs before Task 0)');
    const exit = text.indexOf('Plan complete. Run `/cc-compact`');
    expect(gate).toBeGreaterThan(-1);
    expect(exit).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(exit);
  });

  it.each(PLAN_MIRRORS)('%s states the Task 0 ordering precondition', (rel) => {
    expect(read(rel)).toContain(
      "before any step of the approved plan's Task 0 executes",
    );
  });

  it.each(PLAN_MIRRORS)('%s pins the exact git invocations the gate depends on', (rel) => {
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

  // Whitespace-normalized so a rewrap of the hard-wrapped rule cannot break the anchor, and
  // counted with a literal `split` because the clause contains `[X]`, which `new RegExp` would
  // read as a character class and silently miscount. The constant is single-quoted, never a
  // template literal: it contains backticks.
  const NORM = (s) => s.replace(/\s+/g, ' ').trim();
  const ORDERING_CLAUSE =
    'a staging step placed above its edit commits the file\'s previous content ' +
    'while every checkbox still reports `[X]`';

  // Asserted on BOTH mirrors, not just the source. The `differ only in the script path nesting`
  // test already implies the mirror, but transform-equivalence is a relative property: if that
  // assertion is ever relaxed, or the transform gains an expression touching this text, the
  // two-sided anchor is what keeps the mirror honest. Do not remove either side as dead.
  it.each(PLAN_MIRRORS)('%s carries the step-ordering rule exactly once', (rel) => {
    const count = NORM(read(rel)).split(NORM(ORDERING_CLAUSE)).length - 1;
    expect(count).toBe(1);
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

const IMPL_MIRRORS = ['.claude/commands/cc-implement.md', 'project-template/.claude/commands/cc-implement.md'];

describe('cc-implement mirrors', () => {
  it('differ only in the script path nesting', () => {
    expect(unnest(read(IMPL_MIRRORS[1]))).toBe(read(IMPL_MIRRORS[0]));
  });
});

// One canonical fail-open session-row tail, instantiated three times. The block is
// delimited by markers so the comparison is mechanical rather than a prose diff.
const TAIL_BEGIN = '<!-- SESSION-ROW-TAIL:BEGIN -->';
const TAIL_END = '<!-- SESSION-ROW-TAIL:END -->';
const TAIL_SOURCES = [
  ['global/commands/cc-compact.md', '$ph'],
  ['.claude/commands/cc-plan.md', 'plan'],
  ['.claude/commands/cc-implement.md', 'impl'],
];

function tailOf(rel) {
  const text = unnest(read(rel));
  const a = text.indexOf(TAIL_BEGIN);
  const b = text.indexOf(TAIL_END);
  expect(a, `${rel} carries the tail begin marker`).toBeGreaterThan(-1);
  expect(b, `${rel} carries the tail end marker`).toBeGreaterThan(a);
  return text.slice(a + TAIL_BEGIN.length, b);
}

describe('the fail-open session-row tail', () => {
  it.each(TAIL_SOURCES)('%s writes the session row with phase %s', (rel, phase) => {
    expect(tailOf(rel)).toContain(`conductor-db.mjs session "$id" "${phase}" "$s" "$c"`);
  });

  it.each(TAIL_SOURCES)('%s degrades loudly when the row is not written', (rel) => {
    const tail = tailOf(rel);
    expect(tail).toContain('CC_DB_TAIL: session row not written');
    expect(tail).toContain('non-fatal');
  });

  it('the three tails agree in everything but the phase literal', () => {
    const normalized = TAIL_SOURCES.map(([rel]) =>
      tailOf(rel).replace(/session "\$id" "[^"]+"/, 'session "$id" "<PHASE>"'));
    expect(normalized[1]).toBe(normalized[0]);
    expect(normalized[2]).toBe(normalized[0]);
  });

  it.each([...PLAN_MIRRORS, ...IMPL_MIRRORS])('%s carries the tail in both mirrors', (rel) => {
    expect(read(rel)).toContain(TAIL_BEGIN);
  });

  it('leaves cc-checkpoint deriving its phase by carry-forward', () => {
    // The carry-forward was never wrong; it was reading a record nobody wrote.
    const text = read('global/commands/cc-checkpoint.md');
    expect(text).toContain('Derive `ph` by carry-forward');
    expect(text).not.toContain(TAIL_BEGIN);
  });
});
