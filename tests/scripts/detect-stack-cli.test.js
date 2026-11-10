// BUG-055: non-string package.json fields, exercised through the real CLI and the real detectors.
// Kept apart from detect-stack.test.js, which mocks node:fs and must stay byte-identical (AC12).
import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  detectAngular, detectNextjs, detectNestjs, detectReact, detectVue, detectTSNode,
} from '../../scripts/detect-stack.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dirs = [];

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
});

function run(pkgText) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'cc-ds-cli-')));
  dirs.push(dir);
  writeFileSync(join(dir, 'package.json'), pkgText);
  const r = spawnSync(process.execPath, [join(REPO_ROOT, 'scripts/detect-stack.mjs'), dir], { encoding: 'utf8' });
  // AC9: every fixture exits 0 with parseable stdout.
  expect(r.status).toBe(0);
  return { status: r.status, out: JSON.parse(r.stdout), stderr: r.stderr, dir };
}

function fieldWarns(stderr, field) {
  const prefix = `WARN: non-string package.json field ignored - ${field}: `;
  return stderr.split(/\r?\n/).filter(line => line.startsWith(prefix));
}

const BAD_VALUES = [42, 0, false, null, { cmd: 'x' }, ['eslint'], true];
const COMMAND_KEYS = ['build', 'test', 'lint', 'format'];

function expectStringOrAbsent(result) {
  for (const key of COMMAND_KEYS) {
    const value = result[key];
    expect(value === undefined || typeof value === 'string').toBe(true);
  }
}

describe('[AC10] detectors never return a non-string command', () => {
  const scriptsOf = v => ({ build: v, test: v, lint: v, format: v });

  it.each(BAD_VALUES)('detectAngular with %j', async v => {
    const r = await detectAngular({ dependencies: { '@angular/core': '^17.0.0' }, scripts: scriptsOf(v) });
    expectStringOrAbsent(r);
    expect(r.build).toBe('ng build');
  });

  it.each(BAD_VALUES)('detectNextjs with %j', v => {
    const r = detectNextjs({ dependencies: { next: '14' }, scripts: scriptsOf(v) });
    expectStringOrAbsent(r);
    expect(r.test).toBe('jest');
  });

  it.each(BAD_VALUES)('detectNestjs with %j', v => {
    expectStringOrAbsent(detectNestjs({ dependencies: { '@nestjs/core': '10' }, scripts: scriptsOf(v) }));
  });

  it.each(BAD_VALUES)('detectReact with %j', v => {
    const r = detectReact({ dependencies: { react: '18' }, scripts: scriptsOf(v) });
    expectStringOrAbsent(r);
    expect(r.build).toBeUndefined();
  });

  it.each(BAD_VALUES)('detectVue with %j', v => {
    const r = detectVue({ dependencies: { vue: '3' }, scripts: scriptsOf(v) });
    expectStringOrAbsent(r);
    expect(r.test).toBe('vitest');
    expect(r.build).toBeUndefined();
  });

  it.each(BAD_VALUES)('detectTSNode with %j', v => {
    const r = detectTSNode({ name: 'x', scripts: scriptsOf(v) });
    expectStringOrAbsent(r);
    expect(r.build).toBeUndefined();
  });
});

describe('[AC6] detectTSNode gate', () => {
  it('a non-string name does not open the TS/Node gate', () => {
    expect(detectTSNode({ name: 42, scripts: { test: 'vitest' } })).toEqual({});
  });
});

describe('[AC2] detector half', () => {
  it('detectTSNode drops a non-string build and keeps a string test', () => {
    const r = detectTSNode({ name: 'x', scripts: { build: 42, test: 'vitest' } });
    expect(r.build).toBeUndefined();
    expect(r.test).toBe('vitest');
  });
});

describe('CLI: Next.js test fallback', () => {
  it('[AC3] test: 42 falls back to jest', () => {
    expect(run('{"name":"x","dependencies":{"next":"14"},"scripts":{"test":42}}').out.test).toBe('jest');
  });

  it('[AC4] test: 0 falls back to jest', () => {
    expect(run('{"name":"x","dependencies":{"next":"14"},"scripts":{"test":0}}').out.test).toBe('jest');
  });

  it('[AC7] a blank test string stays as today: no test key', () => {
    expect(run('{"name":"x","dependencies":{"next":"14"},"scripts":{"test":""}}').out).not.toHaveProperty('test');
  });
});

describe('CLI: main() reads scripts, name and description as strings only', () => {
  // No name and no TS dependency, so the only path to these scripts is main()'s root read.
  it.each([
    ['build', '{"scripts":{"build":42,"test":"vitest"}}', 'test', 'vitest'],
    ['test', '{"scripts":{"test":{"cmd":"x"},"build":"tsc"}}', 'build', 'tsc'],
    ['lint', '{"scripts":{"lint":["eslint"],"test":"vitest"}}', 'test', 'vitest'],
    ['format', '{"scripts":{"format":true,"test":"vitest"}}', 'test', 'vitest'],
  ])('[AC1][AC13] a non-string %s is dropped and the run survives', (bad, pkgText, keptKey, keptValue) => {
    const { out, stderr } = run(pkgText);
    expect(Object.keys(out).length).toBeGreaterThan(0);
    expect(stderr).not.toContain('"code":"UNKNOWN"');
    expect(out).not.toHaveProperty(bad);
    expect(out[keptKey]).toBe(keptValue);
  });

  it('[AC13] the string scripts beside a bad one survive, and name falls back to the dir', () => {
    const { out, dir } = run('{"scripts":{"build":42,"test":" vitest ","lint":"eslint .","format":"prettier ."}}');
    expect(out.test).toBe('vitest');
    expect(out.lint).toBe('eslint .');
    expect(out.format).toBe('prettier .');
    expect(out.name).toBe(basename(dir));
    expect(out).not.toHaveProperty('build');
  });

  it('[AC2] end to end: build: 42 is dropped and test is kept', () => {
    const { out } = run('{"name":"x","scripts":{"build":42,"test":"vitest"}}');
    expect(out).not.toHaveProperty('build');
    expect(out.test).toBe('vitest');
  });

  it('[AC5] description: 42 is dropped', () => {
    const { out } = run('{"name":"x","description":42,"scripts":{"test":"vitest"}}');
    expect(out).not.toHaveProperty('description');
    expect(out.name).toBe('x');
    expect(out.test).toBe('vitest');
  });

  it('[AC6] name: 42 falls back to the dir basename', () => {
    const { out, dir } = run('{"name":42,"scripts":{"test":"vitest"}}');
    expect(out.name).not.toBe(42);
    expect(out.name).toBe(basename(dir));
    expect(out).not.toHaveProperty('stack');
    expect(out).not.toHaveProperty('setup');
  });

  it.each(['0', 'false'])('[AC4] build: %s gives no build key', value => {
    expect(run(`{"scripts":{"build":${value}}}`).out).not.toHaveProperty('build');
  });
});

const WARN_FIELDS = ['name', 'description', 'scripts.build', 'scripts.test', 'scripts.lint', 'scripts.format'];
const ANY_FIELD_WARN = 'WARN: non-string package.json field ignored';

describe('CLI: one field WARN per ignored field per manifest', () => {
  it('[AC8] a single bad field writes one line naming the manifest', () => {
    const { stderr, dir } = run('{"scripts":{"build":42,"test":"vitest"}}');
    const lines = fieldWarns(stderr, 'scripts.build');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(basename(dir));
    expect(lines[0].endsWith('package.json')).toBe(true);
    for (const field of WARN_FIELDS.filter(f => f !== 'scripts.build')) {
      expect(fieldWarns(stderr, field)).toHaveLength(0);
    }
  });

  it('[AC8] a field read by two detectors still writes one line', () => {
    const { stderr } = run('{"name":"x","dependencies":{"next":"14"},"devDependencies":{"typescript":"5"},"scripts":{"test":42}}');
    expect(fieldWarns(stderr, 'scripts.test')).toHaveLength(1);
  });

  it('[AC8] each bad field writes exactly one line', () => {
    const { stderr } = run('{"name":42,"description":false,"scripts":{"build":null,"test":"vitest","lint":[],"format":{}}}');
    for (const field of ['name', 'description', 'scripts.build', 'scripts.lint', 'scripts.format']) {
      expect(fieldWarns(stderr, field)).toHaveLength(1);
    }
    expect(fieldWarns(stderr, 'scripts.test')).toHaveLength(0);
  });

  it('[AC8] an all-string manifest writes no field WARN', () => {
    const { stderr } = run('{"name":"x","description":"d","scripts":{"build":"tsc","test":"vitest","lint":"eslint .","format":"prettier ."}}');
    expect(stderr).not.toContain(ANY_FIELD_WARN);
  });

  it('[AC7] a blank test string writes no field WARN', () => {
    const { stderr } = run('{"name":"x","dependencies":{"next":"14"},"scripts":{"test":""}}');
    expect(stderr).not.toContain(ANY_FIELD_WARN);
  });

  it.each([
    '{"name":"x","scripts":null}',
    '{"name":"x","scripts":"x"}',
    '{"name":"x","scripts":true}',
  ])('scripts that is not an object writes no field WARN: %s', pkgText => {
    const { status, stderr } = run(pkgText);
    expect(status).toBe(0);
    expect(stderr).not.toContain(ANY_FIELD_WARN);
  });

  // Decision 4: readManifest returns null for these, so they read as no manifest at all.
  it.each(['42', '[]', '"x"', '{}'])('a manifest that parses to %s writes no field WARN', pkgText => {
    const { status, out, stderr, dir } = run(pkgText);
    expect(status).toBe(0);
    expect(stderr).not.toContain(ANY_FIELD_WARN);
    expect(out.name).toBe(basename(dir));
  });
});
