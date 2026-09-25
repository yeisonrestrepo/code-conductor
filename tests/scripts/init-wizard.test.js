import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FIELDS, FIELD_KEYS, fieldByKey, canonicalLine, unresolvedReason, isResolved,
} from '../../scripts/claude-md-fields.mjs';
import { buildReport, stripOneTerminator, scriptNameOf, checkValue } from '../../scripts/init-wizard.mjs';

const SCRIPT = fileURLToPath(new URL('../../scripts/init-wizard.mjs', import.meta.url));

// Every child runs in its own temp cwd: `apply` writes, and no test may touch the
// live project's CLAUDE.md.
const sandboxes = [];
function sandbox(claudeMd) {
  const d = mkdtempSync(join(tmpdir(), 'cc-wiz-'));
  sandboxes.push(d);
  if (claudeMd !== undefined) writeFileSync(join(d, 'CLAUDE.md'), claudeMd);
  return d;
}
afterEach(() => { while (sandboxes.length) { try { rmSync(sandboxes.pop(), { recursive: true }); } catch {} } });

function run(args, { cwd, input } = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd, input: input ?? '', encoding: 'utf8' });
}

// One literal line per field. Keyed on FIELD_KEYS by the drift test below, so adding a
// field to claude-md-fields.mjs without adding a line here fails the suite.
const LINES = {
  name:        '- Name: code-conductor',
  description: '- Description: a spec-first config',
  stack:       '- Stack: markdown/shell',
  build:       '- Build: <command>',
  test:        '- Test: N/A',
  lint:        '- Lint:',
  format:      '- Format: <COMMAND>',
  setup:       '- Setup: bash install.sh',
};

const fixture = (omit = []) =>
  ['# Project Claude Configuration', '', '## Project Identity']
    .concat(FIELD_KEYS.filter(k => !omit.includes(k)).map(k => LINES[k]))
    .concat(['', '<!-- cc:managed:start -->', 'managed', '<!-- cc:managed:end -->', ''])
    .join('\n');

describe('claude-md-fields', () => {
  it('pins the eight CLAUDE.md fields in file order', () => {
    expect(FIELD_KEYS).toEqual([
      'name', 'description', 'stack', 'build', 'test', 'lint', 'format', 'setup',
    ]);
    expect(FIELDS).toHaveLength(FIELD_KEYS.length);
  });

  it('maps each field to its CLAUDE.md line label', () => {
    expect(canonicalLine(fieldByKey('build'))).toBe('- Build:');
    expect(canonicalLine(fieldByKey('description'))).toBe('- Description:');
    expect(fieldByKey('nope')).toBeUndefined();
  });

  // The spec's truth table, verbatim.
  it.each([
    ['npm run build', null],
    ['N/A',           null],
    ['<COMMAND>',     null],
    ['<Command>',     null],
    ['',              'empty'],
    ['   ',           'empty'],
    ['<command>',     'placeholder'],
    ['  <command>  ', 'placeholder'],
  ])('unresolvedReason(%j) === %j', (value, reason) => {
    expect(unresolvedReason(value)).toBe(reason);
    expect(isResolved(value)).toBe(reason === null);
  });

  it('treats a missing value as empty rather than throwing', () => {
    expect(unresolvedReason(undefined)).toBe('empty');
    expect(unresolvedReason(null)).toBe('empty');
  });
});

describe('the fixture tracks the field list', () => {
  it('has one line per canonical field', () => {
    expect(Object.keys(LINES).sort()).toEqual([...FIELD_KEYS].sort());
  });
});

describe('report', () => {
  it('sorts every field into exactly one bucket', () => {
    const r = buildReport(fixture());
    expect(r.unresolved).toEqual([
      { field: 'build', raw: '- Build: <command>', reason: 'placeholder' },
      { field: 'lint',  raw: '- Lint:',            reason: 'empty' },
    ]);
    expect(r.resolved).toEqual(['name', 'description', 'stack', 'test', 'format', 'setup']);
    expect(r.absent).toEqual([]);
  });

  it('reports a deleted line as absent, carrying the line to restore', () => {
    const r = buildReport(fixture(['setup']));
    expect(r.absent).toEqual([{ field: 'setup', expected: '- Setup:' }]);
    expect(r.resolved).not.toContain('setup');
  });

  it('matches the first occurrence only', () => {
    const r = buildReport('- Build: <command>\n- Build: npm run build\n');
    expect(r.unresolved.map(u => u.field)).toEqual(['build']);
  });

  it('keeps a CRLF line terminator out of raw', () => {
    const r = buildReport('- Build: <command>\r\n');
    expect(r.unresolved[0].raw).toBe('- Build: <command>');
  });

  it('prints only JSON on stdout and exits 0', () => {
    const res = run(['report'], { cwd: sandbox(fixture()) });
    expect(res.status).toBe(0);
    expect(() => JSON.parse(res.stdout)).not.toThrow();
    expect(JSON.parse(res.stdout).unresolved.map(u => u.field)).toEqual(['build', 'lint']);
    expect(res.stderr).toContain('build, lint');   // advisory, never parsed
  });

  it('exits non-zero when CLAUDE.md is absent', () => {
    const res = run(['report'], { cwd: sandbox() });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain('CLAUDE.md');
  });

  it('exits non-zero on an unknown subcommand', () => {
    const res = run(['wat'], { cwd: sandbox(fixture()) });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain('usage');
  });
});

describe('mode blindness', () => {
  it('the script never probes interactivity', () => {
    const src = readFileSync(SCRIPT, 'utf8');
    expect(src).not.toMatch(/isTTY/);
    expect(src).not.toMatch(/\bprocess\.env\.CI\b/);
    expect(src).not.toMatch(/\benv\.CI\b/);
  });
});

describe('apply', () => {
  it('replaces the first canonical line and leaves every other byte alone', () => {
    const before = fixture();
    const cwd = sandbox(before);
    const res = run(['apply', 'build', '--value-stdin'], { cwd, input: 'npm run build\n' });
    expect(res.status).toBe(0);
    const after = readFileSync(join(cwd, 'CLAUDE.md'), 'utf8');
    expect(after).toBe(before.replace('- Build: <command>', '- Build: npm run build'));
  });

  it('round-trips a value full of shell metacharacters byte-exact', () => {
    const nasty = `echo \`id\` $(whoami) "q" 'q' && rm -rf /`;
    const cwd = sandbox(fixture());
    const res = run(['apply', 'build', '--value-stdin'], { cwd, input: `${nasty}\n` });
    expect(res.status).toBe(0);
    expect(readFileSync(join(cwd, 'CLAUDE.md'), 'utf8')).toContain(`- Build: ${nasty}`);
  });

  it('does not expand $& or $1 in the value', () => {
    const cwd = sandbox(fixture());
    run(['apply', 'build', '--value-stdin'], { cwd, input: 'make $& $1 $`\n' });
    expect(readFileSync(join(cwd, 'CLAUDE.md'), 'utf8')).toContain('- Build: make $& $1 $`');
  });

  it('strips exactly one trailing terminator and no other whitespace', () => {
    expect(stripOneTerminator('x\n')).toBe('x');
    expect(stripOneTerminator('x\r\n')).toBe('x');
    expect(stripOneTerminator('x\n\n')).toBe('x\n');
    expect(stripOneTerminator('  x  \n')).toBe('  x  ');
    expect(stripOneTerminator('x')).toBe('x');
  });

  it('refuses an empty value without touching the file', () => {
    const before = fixture();
    const cwd = sandbox(before);
    const res = run(['apply', 'build', '--value-stdin'], { cwd, input: '\n' });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain('N/A');
    expect(readFileSync(join(cwd, 'CLAUDE.md'), 'utf8')).toBe(before);
  });

  it('refuses an embedded newline without touching the file', () => {
    const before = fixture();
    const cwd = sandbox(before);
    const res = run(['apply', 'build', '--value-stdin'], { cwd, input: 'make a\nmake b\n' });
    expect(res.status).not.toBe(0);
    expect(readFileSync(join(cwd, 'CLAUDE.md'), 'utf8')).toBe(before);
  });

  it('refuses an absent line, naming it, and never inserts', () => {
    const before = fixture(['setup']);
    const cwd = sandbox(before);
    const res = run(['apply', 'setup', '--value-stdin'], { cwd, input: 'make setup\n' });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain('- Setup:');
    expect(readFileSync(join(cwd, 'CLAUDE.md'), 'utf8')).toBe(before);
  });

  it('refuses a value passed as an argv word', () => {
    const cwd = sandbox(fixture());
    const res = run(['apply', 'build', 'npm run build'], { cwd });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain('--value-stdin');
  });

  it('refuses an unknown field', () => {
    const res = run(['apply', 'nope', '--value-stdin'], { cwd: sandbox(fixture()), input: 'x\n' });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain('unknown field');
  });
});

describe('check', () => {
  const pkg = JSON.stringify({ scripts: { build: 'tsc', test: 'vitest run' } });

  it.each([
    ['npm run build',  'build'],
    ['pnpm run build', 'build'],
    ['yarn build',     'build'],
    ['  npm run build  ', 'build'],
    ['make build',     null],
    ['cargo build',    null],
    ['go test ./...',  null],
    ['npm run',        null],
    ['npm run a b',    null],
  ])('scriptNameOf(%j) === %j', (value, expected) => {
    expect(scriptNameOf(value)).toBe(expected);
  });

  it('warns once for a script package.json does not have', () => {
    expect(checkValue('npm run dist', pkg)).toContain('dist');
  });

  it('stays silent for a script it does have', () => {
    expect(checkValue('npm run build', pkg)).toBeNull();
  });

  it('stays silent with no manifest, an unparseable one, or a non-object one', () => {
    expect(checkValue('npm run dist', null)).toBeNull();
    expect(checkValue('npm run dist', '{ not json')).toBeNull();
    expect(checkValue('npm run dist', '[]')).toBeNull();
  });

  it('warns when a parseable manifest simply has no scripts block', () => {
    expect(checkValue('npm run dist', '{"name":"x"}')).toContain('dist');
  });

  it('skips N/A entirely', () => {
    expect(checkValue('N/A', pkg)).toBeNull();
  });

  it('exits 0 and warns on stderr, writing nothing', () => {
    const before = fixture();
    const cwd = sandbox(before);
    writeFileSync(join(cwd, 'package.json'), pkg);
    const res = run(['check', 'build', '--value-stdin'], { cwd, input: 'npm run dist\n' });
    expect(res.status).toBe(0);
    expect(res.stderr).toContain('dist');
    expect(res.stdout).toBe('');
    expect(readFileSync(join(cwd, 'CLAUDE.md'), 'utf8')).toBe(before);
  });

  it('exits non-zero on an invalid argument', () => {
    const res = run(['check', 'nope', '--value-stdin'], { cwd: sandbox(fixture()), input: 'x\n' });
    expect(res.status).not.toBe(0);
  });
});

import { MERGE_FIELDS } from '../../scripts/detect-stack.mjs';

describe('detect-stack shares the field list', () => {
  it('merges every canonical field, plus its own extras', () => {
    for (const key of FIELD_KEYS) expect(MERGE_FIELDS).toContain(key);
    expect(MERGE_FIELDS).toContain('goVersion');
  });
});
