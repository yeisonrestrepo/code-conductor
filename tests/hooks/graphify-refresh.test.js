import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, utimesSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const WRAPPER = join(REPO_ROOT, 'global', 'hooks', 'graphify-ast-refresh.mjs');

// The stub interpreter is a POSIX shell script: it records its argv and exits 1,
// so one file proves both that it ran and that a failing child never reaches the
// hook's own exit code. Shebangs do not execute on Windows, so the stub-based
// cases skip there. The two empty-PATH cases need no stub and always run.
const POSIX = process.platform !== 'win32';

let dir, pathDir, marker;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cc-graphify-'));
  pathDir = join(dir, 'bin');
  mkdirSync(pathDir);
  marker = join(dir, 'stub-ran.txt');
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

function writeStub(name = 'python3') {
  const p = join(pathDir, name);
  writeFileSync(p, `#!/bin/sh\necho "$@" >> "${marker}"\nexit 1\n`);
  chmodSync(p, 0o755);
  return p;
}

function writeSentinel(ageMinutes) {
  const outDir = join(dir, 'graphify-out');
  mkdirSync(outDir, { recursive: true });
  const sentinel = join(outDir, '.graphify_ast_done');
  writeFileSync(sentinel, '');
  const when = new Date(Date.now() - ageMinutes * 60000);
  utimesSync(sentinel, when, when);
}

// PATH is REPLACED, never appended to: the machine running this suite very
// likely has a real python3, and a test that asserts "no interpreter" has to
// mean it. node itself is reached through process.execPath, an absolute path.
function runHook(env = {}) {
  return spawnSync(process.execPath, [WRAPPER], {
    cwd: dir,
    encoding: 'utf8',
    env: { PATH: pathDir, ...env },
  });
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// The child is detached and unref'd, so the hook returns before it has run.
function waitForMarker(ms = 3000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (existsSync(marker)) return true;
    sleepSync(25);
  }
  return existsSync(marker);
}

describe('graphify-ast-refresh.mjs', () => {
  it('exits 0 and prints nothing when no interpreter is on PATH', () => {
    const r = runHook();
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('');
  });

  it('writes exactly one GRAPHIFY_HOOK line under CC_GRAPHIFY_DEBUG and still exits 0', () => {
    const r = runHook({ CC_GRAPHIFY_DEBUG: '1' });
    expect(r.status).toBe(0);
    expect(r.stderr.trimEnd().split('\n')).toHaveLength(1);
    expect(r.stderr.startsWith('GRAPHIFY_HOOK: ')).toBe(true);
  });

  it.skipIf(!POSIX)('short-circuits on a fresh sentinel without resolving an interpreter', () => {
    writeStub();
    writeSentinel(1);
    const r = runHook();
    expect(r.status).toBe(0);
    sleepSync(400);
    expect(existsSync(marker)).toBe(false);
  });

  it.skipIf(!POSIX)('spawns the interpreter once with the payload path when the sentinel is stale', () => {
    writeStub();
    writeSentinel(90);
    const r = runHook();
    expect(r.status).toBe(0);
    expect(waitForMarker()).toBe(true);
    sleepSync(200);
    const lines = readFileSync(marker, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(lines[0].trim()).toMatch(/graphify-ast-refresh\.py$/);
  });

  it.skipIf(!POSIX)('honors GRAPHIFY_STALE_MINUTES and falls back to 60 on a non-numeric value', () => {
    writeStub();
    writeSentinel(90);
    expect(runHook({ GRAPHIFY_STALE_MINUTES: '120' }).status).toBe(0);
    sleepSync(400);
    expect(existsSync(marker)).toBe(false);
    expect(runHook({ GRAPHIFY_STALE_MINUTES: 'later' }).status).toBe(0);
    expect(waitForMarker()).toBe(true);
  });

  it.skipIf(!POSIX)('falls through to the PATH scan when GRAPHIFY_PYTHON is not an executable file', () => {
    writeStub();
    const r = runHook({ GRAPHIFY_PYTHON: join(dir, 'nope', 'python3') });
    expect(r.status).toBe(0);
    expect(waitForMarker()).toBe(true);
    expect(readFileSync(marker, 'utf8')).toMatch(/graphify-ast-refresh\.py/);
  });
});
