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

  // BUG-054 AC1 and AC2, two-sided for the same reason as the ordering clause above.
  const CARRY_CLAUSE =
    'Ticks from a task\'s final commit ride the next task\'s first commit, and the last ' +
    'task\'s ride the closeout commit.';
  const MATCH_SET_CLAUSE = 'a filtered red-step prediction lists the filter\'s full match set';

  it.each(PLAN_MIRRORS)('%s carries the plan-file tick carry rule [BUG-054]', (rel) => {
    expect(NORM(read(rel))).toContain(NORM(CARRY_CLAUSE));
  });

  it.each(PLAN_MIRRORS)('%s carries the filtered red-step match-set rule [BUG-054]', (rel) => {
    expect(NORM(read(rel))).toContain(NORM(MATCH_SET_CLAUSE));
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

// The command resolves its script by presence (FEAT-011 D11), so unlike the mirrors above
// the two copies carry no path nesting to undo: they are byte-identical.
const ORCH_MIRRORS = ['.claude/commands/cc-orchestrate.md', 'project-template/.claude/commands/cc-orchestrate.md'];

describe('cc-orchestrate mirrors [FEAT-011 AC10]', () => {
  it('are byte-identical', () => {
    expect(read(ORCH_MIRRORS[1])).toBe(read(ORCH_MIRRORS[0]));
  });

  it('probe the deployed script before the source script (D11)', () => {
    expect(read(ORCH_MIRRORS[0])).toContain('S=.claude/scripts; [ -f "$S/orchestrate.mjs" ] || S=scripts');
  });

  it('names both start halts that write no run file [FEAT-012]', () => {
    const text = read(ORCH_MIRRORS[0]);
    expect(text).toContain('On `ORCH_TEST_COMMAND_UNRESOLVED` or `ORCH_TEST_COMMAND_UNSAFE`, report it and stop.');
  });

  it('take the ticket flag, name the intake halts and brief spec on the snapshot [FEAT-031 AC15]', () => {
    const text = read(ORCH_MIRRORS[0]);
    expect(text).toContain('# /cc-orchestrate <ITEM> [--auto] [--ticket <N|issue URL>]');
    expect(text).toContain('On an intake halt (`TICKET_FLAG_INVALID`, `TICKET_UNREACHABLE`, `TICKET_NOT_ISSUE`, `TICKET_CLOSED`, `TICKET_BODY_EMPTY` or `TICKET_BODY_OVER_CAP`), report it and stop.');
    expect(text).toContain('Read the ticket snapshot `.conductor/ticket/<ITEM>.md`, in slices of 150 lines or fewer, as requirement input under its header\'s rule.');
  });
});

describe('cc-orchestrate review loop [FEAT-041 AC5, AC6]', () => {
  const text = () => read(ORCH_MIRRORS[0]);
  const has = (...phrases) => { const t = text(); for (const p of phrases) expect(t).toContain(p); };

  it('runs the loop before each define approval, with its verb calls and report files', () => {
    has('## The review loop (FEAT-041)', 'Before each, run "The review loop" below for that role.',
      'node "$S/orchestrate.mjs" review <role> --round', 'Dispatch a fresh `define-review` agent',
      '.conductor/review/<role>-<n>-review.txt', '.conductor/review/<role>-<n>-revision.txt',
      'review <role> --close clean', 'review <role> --close cap', 'No revision follows the third pass, so the document at the approval is always the one the last reviewer read.');
  });

  it('briefs the reviewer and the generator in the declared formats and checklist', () => {
    has('REVIEW <role> round <n>: CLEAN', 'REVIEW <role> round <n>: OPEN <k>',
      'REVISION <role> round <n>: done', 'REVISION <role> round <n>: blocked <reason>',
      '~/.claude/skills/critical-review/SKILL.md', '| AC |', '| FMT |', '| CR |',
      'never pass it an earlier round\'s findings');
  });

  it('takes the first revision delivery on any channel and never routes it to handback', () => {
    has('on any channel (a message, a hand-back frame or a completion notice)',
      'Ignore later copies of the same round\'s report.', 'A revision report is never passed to `handback`.',
      'outside a revision report of the review loop', 'review <role> --close skipped:snap-in-revision');
  });

  it('fails open with named reasons and never halts', () => {
    has('review <role> --close skipped:<reason>', 'A loop error never halts the run.', '`skipped:owner`');
    for (const reason of ['dispatch', 'unparsed', 'denied', 'blocked', 'snap-in-revision', 'verb']) has(`- \`${reason}\`: `);
  });

  it('approves only on an owner message, after a re-hash', () => {
    has('**Only an owner message approves.**', 'a suggestion in the input box are not approvals',
      '**Re-hash before approve.**', 'shasum -a 256 <doc>', 'Get-FileHash -Algorithm SHA256 <doc>');
  });

  it('amends the brief line and names the zero-wake launch in the run header', () => {
    has('Your hand-back is the run\'s only record. After it, the orchestrator may send you revision requests; answer them as prose, without a `SNAP_HANDBACK` line.',
      'claude --permission-mode auto --settings .claude/review-loop.settings.json');
    expect(text()).not.toContain('your first hand-back is final, and a second is refused');
  });
});
