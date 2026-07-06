import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
let work, pkgDir;

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), 'cc-smoke-'));
  // Pack, then extract the tarball into work/package. `npm pack` can interleave
  // lifecycle/notice/deprecation lines with the filename, so select the single
  // line that actually ends in `.tgz` rather than blindly taking the last line.
  const packOut = execFileSync('npm', ['pack', '--silent', '--pack-destination', work], { cwd: root }).toString();
  const tarball = packOut.split('\n').map(l => l.trim()).filter(l => l.endsWith('.tgz')).pop();
  if (!tarball) throw new Error(`npm pack produced no .tgz filename:\n${packOut}`);
  execFileSync('tar', ['-xzf', join(work, tarball), '-C', work]);
  pkgDir = join(work, 'package');
}, 120000);
// Cleanup runs regardless of pass/fail: `work` holds BOTH the packed .tgz and the
// extracted package/ tree, so this single recursive removal deletes the tarball and
// every extracted temp file. The per-test HOME/CWD temp dirs are removed inline below.
afterAll(() => rmSync(work, { recursive: true, force: true }));

describe('packed tarball', () => {
  it('physically contains every mandatory asset path', () => {
    for (const p of ['bin/code-conductor.mjs', 'lib/installer/settings.mjs', 'global/settings.json', 'skills', 'project-template']) {
      expect(existsSync(join(pkgDir, p))).toBe(true);
    }
  });
  it('excludes dev-only trees', () => {
    expect(existsSync(join(pkgDir, 'tests'))).toBe(false);
    expect(existsSync(join(pkgDir, 'docs'))).toBe(false);
    expect(existsSync(join(pkgDir, 'install.sh'))).toBe(false);
  });
  it('deploys the global set from the extracted package', () => {
    const home = mkdtempSync(join(tmpdir(), 'cc-smoke-h-'));
    execFileSync('node', [join(pkgDir, 'bin', 'code-conductor.mjs')], { env: { ...process.env, HOME: home, USERPROFILE: home } });
    expect(existsSync(join(home, '.claude', 'CLAUDE.md'))).toBe(true);
    expect(existsSync(join(home, '.claude', 'settings.json'))).toBe(true);
    const s = JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf8'));
    expect(s.hooks.UserPromptSubmit.some(e => e.hooks.some(h => h.command.includes('verbosity-remind.sh')))).toBe(true);
    rmSync(home, { recursive: true, force: true });
  });
  it('deploys the project template with --project', () => {
    const home = mkdtempSync(join(tmpdir(), 'cc-smoke-h2-'));
    const cwd = mkdtempSync(join(tmpdir(), 'cc-smoke-c-'));
    execFileSync('node', [join(pkgDir, 'bin', 'code-conductor.mjs'), '--project'], { cwd, env: { ...process.env, HOME: home, USERPROFILE: home } });
    expect(existsSync(join(cwd, 'CLAUDE.md'))).toBe(true);
    expect(existsSync(join(cwd, '.claude', '.claude'))).toBe(false);
    expect(existsSync(join(cwd, '.claude', 'commands', 'cc-spec.md'))).toBe(true);
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  });
});

describe('committed entry mode', () => {
  it('is 100755 in git', () => {
    const mode = execFileSync('git', ['ls-files', '-s', 'bin/code-conductor.mjs'], { cwd: root }).toString().split(/\s+/)[0];
    expect(mode).toBe('100755');
  });
});
