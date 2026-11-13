import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cleanGitEnv } from '../helpers/git-env.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SCANNER = join(REPO_ROOT, 'scripts/security-scan.mjs');
const HOOK_SRC = join(REPO_ROOT, '.claude/hooks/pre-tool-use.mjs');
const ALLOWLIST = '.claude/memory/bash-scan-allowlist.txt';
// Samples are built at runtime so this file never matches the scanner's own table.
const AWS = 'AKIA' + 'Q'.repeat(16);
const AWS_LINE = '- [blocker] src/config.js:2 — critical secret: AWS access key id; value withheld';
const LOCK_NONE = 'LOCKFILE none';

let root, priv;
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'cc-secscan-')));
  priv = realpathSync(mkdtempSync(join(tmpdir(), 'cc-secscan-tmp-')));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(priv, { recursive: true, force: true });
});

function git(...args) {
  return spawnSync('git', ['-c', 'core.autocrlf=false', '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args],
    { cwd: root, env: cleanGitEnv(), encoding: 'utf8' });
}
function commit() {
  git('add', '-A');
  git('commit', '-qm', 'base');
  return git('rev-parse', 'HEAD').stdout.trim();
}
const put = (rel, text) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
};
const withHook = () => {
  mkdirSync(join(root, '.claude/hooks'), { recursive: true });
  cpSync(HOOK_SRC, join(root, '.claude/hooks/pre-tool-use.mjs'));
};
const pkg = (scripts) => JSON.stringify({ name: 'x', scripts }, null, 2) + '\n';
const initRepo = () => git('init', '-q');

function scan(base, env = {}) {
  const args = base === undefined ? [] : Array.isArray(base) ? base : [base, 'high'];
  const r = spawnSync(process.execPath, [SCANNER, ...args], {
    cwd: root, encoding: 'utf8',
    env: { ...cleanGitEnv(), TMPDIR: priv, TEMP: priv, TMP: priv, ...env },
  });
  return { status: r.status, out: r.stdout, err: r.stderr };
}
const lines = (out) => out.trimEnd().split('\n');

describe('scripts/security-scan.mjs [FEAT-034]', () => {
  it('[E1] imports only node: builtins', () => {
    const src = readFileSync(SCANNER, 'utf8');
    const specs = [...src.matchAll(/^import\s[^;]*?from\s+'([^']+)'/gm)].map((m) => m[1]);
    expect(specs.length).toBeGreaterThan(0);
    for (const s of specs) expect(s.startsWith('node:')).toBe(true);
  });

  it('is import-safe: importing it prints nothing and exports scanChanges and SECRET_PATTERNS', async () => {
    const r = spawnSync(process.execPath, ['-e', `import(${JSON.stringify(pathToFileURL(SCANNER).href)}).then(m => process.stdout.write(typeof m.scanChanges + ' ' + Array.isArray(m.SECRET_PATTERNS)))`], { encoding: 'utf8' });
    expect(r.stdout).toBe('function true');
    expect(r.stderr).toBe('');
  });

  it('[D2] a known-format key added to a tracked file yields a critical secret line naming path:line, and the key reaches neither stdout nor stderr', () => {
    initRepo(); put('src/config.js', 'const a = 1;\n');
    const base = commit();
    put('src/config.js', `const a = 1;\nconst k = '${AWS}';\n`);
    const r = scan(base);
    expect(r.status).toBe(0);
    expect(lines(r.out)).toEqual([AWS_LINE, LOCK_NONE, 'SCAN-RESULT secrets=ran scripts=ran']);
    expect(r.out + r.err).not.toContain(AWS);
  });

  it('[D2] a key already present at the base yields no finding', () => {
    initRepo(); put('src/config.js', `const a = 1;\nconst k = '${AWS}';\n`);
    const base = commit();
    put('src/config.js', `const a = 2;\nconst k = '${AWS}';\n`);
    expect(lines(scan(base).out)).toEqual([LOCK_NONE, 'SCAN-RESULT secrets=ran scripts=ran']);
  });

  it('[D2] an untracked new file is scanned', () => {
    initRepo(); put('a.txt', 'x\n');
    const base = commit();
    put('src/config.js', `const a = 1;\nconst k = '${AWS}';\n`);
    expect(lines(scan(base).out)[0]).toBe(AWS_LINE);
  });

  it('[D2] the generic assignment is moderate', () => {
    initRepo(); put('a.txt', 'x\n');
    const base = commit();
    put('src/settings.js', `const password = '${'p'.repeat(14)}';\n`);
    expect(lines(scan(base).out)[0]).toBe('- [minor] src/settings.js:1 — moderate secret: generic secret assignment; value withheld');
  });

  it('every pattern in the exported table matches its runtime-built sample and names itself', async () => {
    const { SECRET_PATTERNS } = await import('../../scripts/security-scan.mjs');
    const samples = {
      'private key block': '-----BEGIN ' + 'RSA ' + 'PRIVATE KEY-----',
      'AWS access key id': AWS,
      'GitHub token': 'gh' + 'p_' + 'a'.repeat(36),
      'Slack token': 'xo' + 'xb-' + '1'.repeat(12),
      'Stripe live key': 'sk' + '_live_' + 'a'.repeat(20),
      'Google API key': 'AI' + 'za' + 'a'.repeat(35),
      'Anthropic API key': 'sk-' + 'ant-' + 'a'.repeat(24),
      'generic secret assignment': 'token = "' + 'z'.repeat(14) + '"',
    };
    expect(SECRET_PATTERNS.map((p) => p.name).sort()).toEqual(Object.keys(samples).sort());
    initRepo(); put('a.txt', 'x\n');
    const base = commit();
    for (const p of SECRET_PATTERNS) {
      put('s.txt', samples[p.name] + '\n');
      const first = lines(scan(base).out)[0];
      expect(first).toBe(`- [${p.level === 'critical' ? 'blocker' : 'minor'}] s.txt:1 — ${p.level} secret: ${p.name}; value withheld`);
    }
  });

  it('an untracked file with a NUL byte in its first 8000 bytes is skipped', () => {
    initRepo(); put('a.txt', 'x\n');
    const base = commit();
    writeFileSync(join(root, 'bin.dat'), Buffer.concat([Buffer.from([0]), Buffer.from(`${AWS}\n`)]));
    expect(lines(scan(base).out)).toEqual([LOCK_NONE, 'SCAN-RESULT secrets=ran scripts=ran']);
  });

  it('[D3] a changed script whose text Guard 3 denies yields a high script finding with the hook\'s code', () => {
    initRepo(); withHook(); put('package.json', pkg({ build: 'tsc' }));
    const base = commit();
    put('package.json', pkg({ build: 'cat src/*.js' }));
    expect(lines(scan(base).out)).toEqual([
      '- [blocker] package.json:4 — high script: scripts.build; Guard 3 denies this text as a direct command (P4); base allowlist applied',
      LOCK_NONE,
      'SCAN-RESULT secrets=ran scripts=ran',
    ]);
  });

  it('[D3] an unchanged denied script yields none', () => {
    initRepo(); withHook(); put('package.json', pkg({ build: 'cat src/*.js' }));
    const base = commit();
    put('README.md', 'x\n');
    expect(lines(scan(base).out)).toEqual([LOCK_NONE, 'SCAN-RESULT secrets=ran scripts=ran']);
  });

  it.each(['pretest', 'test', 'posttest'])('[D3] a changed root scripts.%s yields the moderate line', (name) => {
    initRepo(); withHook(); put('package.json', pkg({ [name]: 'vitest run' }));
    const base = commit();
    put('package.json', pkg({ [name]: 'vitest run --coverage' }));
    expect(lines(scan(base).out)).toEqual([
      `- [minor] package.json:4 — moderate script: scripts.${name}; npm test runs this changed script`,
      LOCK_NONE,
      'SCAN-RESULT secrets=ran scripts=ran',
    ]);
  });

  it('[D3] CC_GUARD3_WARN=1 in the parent environment does not change the result', () => {
    initRepo(); withHook(); put('package.json', pkg({ build: 'tsc' }));
    const base = commit();
    put('package.json', pkg({ build: 'cat src/*.js' }));
    const r = scan(base, { CC_GUARD3_WARN: '1', CC_HOOK_ALLOW: '1' });
    expect(lines(r.out)[0]).toBe('- [blocker] package.json:4 — high script: scripts.build; Guard 3 denies this text as a direct command (P4); base allowlist applied');
  });

  it.each(['untracked and ignored', 'tracked and changed'])('[D3] a work-tree allowlist entry covering the script (%s) leaves the high finding and the allowlist byte-identical', (mode) => {
    initRepo(); withHook(); put('package.json', pkg({ build: 'tsc' }));
    if (mode === 'untracked and ignored') put('.gitignore', '.claude/memory/\n');
    else put(ALLOWLIST, '# none\n');
    const base = commit();
    put('package.json', pkg({ build: 'cat src/*.js' }));
    put(ALLOWLIST, mode === 'tracked and changed' ? '# none\nsrc/*.js\n' : 'src/*.js\n');
    const before = readFileSync(join(root, ALLOWLIST), 'utf8');
    const r = scan(base);
    expect(lines(r.out)[0]).toMatch(/^- \[blocker\] package\.json:4 — high script: scripts\.build; /);
    expect(readFileSync(join(root, ALLOWLIST), 'utf8')).toBe(before);
  });

  it('[D3] the same script covered by an entry committed at the base yields none', () => {
    initRepo(); withHook(); put('package.json', pkg({ build: 'tsc' })); put(ALLOWLIST, 'src/*.js\n');
    const base = commit();
    put('package.json', pkg({ build: 'cat src/*.js' }));
    expect(lines(scan(base).out)).toEqual([LOCK_NONE, 'SCAN-RESULT secrets=ran scripts=ran']);
  });

  it('[D3] a work-tree hook edited so Guard 3 allows the script still yields the high finding', () => {
    initRepo(); withHook(); put('package.json', pkg({ build: 'tsc' }));
    const base = commit();
    const hookPath = join(root, '.claude/hooks/pre-tool-use.mjs');
    const text = readFileSync(hookPath, 'utf8');
    expect(text).toContain('function guard3BashScan(input) {');
    writeFileSync(hookPath, text.replace('function guard3BashScan(input) {', 'function guard3BashScan(input) { return null;'));
    put('package.json', pkg({ build: 'cat src/*.js' }));
    expect(lines(scan(base).out)[0]).toMatch(/^- \[blocker\] package\.json:4 — high script: scripts\.build; /);
  });

  it('[D3] a base that does not track the hook yields scripts=failed and no script line', () => {
    initRepo(); put('package.json', pkg({ build: 'tsc' }));
    const base = commit();
    put('package.json', pkg({ build: 'cat src/*.js' }));
    const r = scan(base);
    expect(r.status).toBe(0);
    expect(lines(r.out)).toEqual([LOCK_NONE, 'SCAN-RESULT secrets=ran scripts=failed']);
    expect(r.err).not.toBe('');
  });

  it.each([['the base none', ['none', 'high']], ['a base git cannot resolve', ['f'.repeat(40), 'high']]])('[C12] %s fails both scans', (_, args) => {
    initRepo(); put('a.txt', 'x\n'); commit();
    const r = scan(args);
    expect(r.status).toBe(0);
    expect(lines(r.out).at(-1)).toBe('SCAN-RESULT secrets=failed scripts=failed');
    expect(r.err).not.toBe('');
  });

  it('a work-tree package.json that does not parse fails the scripts scan only', () => {
    initRepo(); withHook(); put('package.json', pkg({ build: 'tsc' }));
    const base = commit();
    put('package.json', '{ not json');
    expect(lines(scan(base).out)).toEqual([LOCK_NONE, 'SCAN-RESULT secrets=ran scripts=failed']);
  });

  it('[E3] a scan changes nothing: the work tree, the index, .claude/.flow-events.jsonl and the work-tree allowlist are byte-identical, and no temporary directory remains', () => {
    initRepo(); withHook(); put('package.json', pkg({ build: 'tsc' })); put('.gitignore', '.claude/memory/\n');
    const base = commit();
    put('package.json', pkg({ build: 'cat src/*.js' }));
    put(ALLOWLIST, 'src/*.js\n');
    put('.claude/.flow-events.jsonl', '{"e":1}\n');
    const snapshot = () => [
      git('status', '--porcelain').stdout, git('ls-files', '-s').stdout,
      readFileSync(join(root, '.claude/.flow-events.jsonl'), 'utf8'), readFileSync(join(root, ALLOWLIST), 'utf8'),
      readFileSync(join(root, 'package.json'), 'utf8'),
    ];
    const before = snapshot();
    const tmpBefore = readdirSync(priv);
    scan(base);
    expect(snapshot()).toEqual(before);
    expect(readdirSync(priv)).toEqual(tmpBefore);
    expect(existsSync(join(root, '.claude/memory/.flow-events.jsonl'))).toBe(false);
  });
});

describe('scripts/security-scan.mjs verdict contract [FEAT-059]', () => {
  const npmLock = (pkgs) => JSON.stringify({ name: 'x', lockfileVersion: 3, packages: { '': { name: 'x' }, ...pkgs } }, null, 2) + '\n';
  const pnpmLock = (keys) => ['lockfileVersion: \'9.0\'', '', 'packages:', '', ...keys.flatMap((k) => [`  ${k}:`, '    resolution: {integrity: sha512-x}', '']), ''].join('\n');
  // An in-process call would inherit any GIT_* variable of the parent (BUG-053), so the export runs in a child.
  function callExport(expr) {
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', `import * as m from ${JSON.stringify(pathToFileURL(SCANNER).href)}; process.stdout.write(JSON.stringify(${expr}));`],
      { cwd: root, env: cleanGitEnv(), encoding: 'utf8' });
    return JSON.parse(r.stdout);
  }
  const changed = (base, lockfile) => callExport(`m.changedPackages(process.cwd(), ${JSON.stringify(base)}, '${lockfile}')`);
  const lockFixture = () => {
    initRepo();
    put('package-lock.json', npmLock({ 'node_modules/a': { version: '1.0.0' }, 'node_modules/b': { version: '1.0.0' }, 'node_modules/x/node_modules/b': { version: '2.0.0' }, 'node_modules/@s/c': { version: '1.0.0' } }));
    const base = commit();
    put('package-lock.json', npmLock({ 'node_modules/a': { version: '1.0.0' }, 'node_modules/b': { version: '1.0.0' }, 'node_modules/x/node_modules/b': { version: '2.1.0' }, 'node_modules/@s/c': { version: '1.0.0' } }));
    return base;
  };
  const absentFixture = () => {
    initRepo(); put('a.txt', 'x\n');
    const base = commit();
    put('package-lock.json', npmLock({ 'node_modules/a': { version: '1.0.0' } }));
    return base;
  };
  const brokenFixture = () => {
    initRepo(); put('package-lock.json', '{ not json');
    return commit();
  };
  const movedFixture = () => {
    initRepo(); put('old/config.js', `const k = '${AWS}';\n`); put('a.txt', 'x\n');
    const base = commit();
    mkdirSync(join(root, 'src'), { recursive: true });
    renameSync(join(root, 'old/config.js'), join(root, 'src/config.js'));
    return base;
  };

  it('[C15] exports SCAN_CONTRACT 2 and changedPackages', () => {
    const r = spawnSync(process.execPath, ['-e', `import(${JSON.stringify(pathToFileURL(SCANNER).href)}).then(m => process.stdout.write(\`\${m.SCAN_CONTRACT} \${typeof m.changedPackages}\`))`], { encoding: 'utf8' });
    expect(r.stdout).toBe('2 function');
    expect(r.stderr).toBe('');
  });

  it.each([[['a']], [['a', 'high', 'x']], [['a', 'urgent']]])('[S2] exits 1 with the usage line on %j', (args) => {
    initRepo();
    const r = scan(args);
    expect(r.status).toBe(1);
    expect(r.err.trim()).toBe('security-scan: usage: security-scan.mjs <base> <low|moderate|high|critical>');
  });

  it('[S2] the same fixture at high and at moderate changes the brackets and keeps the levels', () => {
    initRepo(); withHook(); put('package.json', pkg({ test: 'vitest run' }));
    const base = commit();
    put('package.json', pkg({ test: 'vitest run --coverage' }));
    put('src/settings.js', `const password = '${'p'.repeat(14)}';\n`);
    const levelLines = (bracket) => [
      `- [${bracket}] src/settings.js:1 — moderate secret: generic secret assignment; value withheld`,
      `- [${bracket}] package.json:4 — moderate script: scripts.test; npm test runs this changed script`,
      LOCK_NONE, 'SCAN-RESULT secrets=ran scripts=ran',
    ];
    expect(lines(scan(base).out)).toEqual(levelLines('minor'));
    expect(lines(scan([base, 'moderate']).out)).toEqual(levelLines('blocker'));
  });

  it('[C2] a script finding names package.json and the line of its key', () => {
    initRepo(); withHook(); put('package.json', pkg({ build: 'tsc', lint: 'eslint .', test: 'vitest run' }));
    const base = commit();
    put('package.json', pkg({ build: 'tsc', lint: 'eslint .', test: 'vitest run --coverage' }));
    expect(lines(scan(base).out)[0]).toBe('- [minor] package.json:6 — moderate script: scripts.test; npm test runs this changed script');
  });

  it('[S3] a key moved from another path is pre-existing: it prints inside the owner-only block, and the key reaches neither stdout nor stderr', () => {
    const base = movedFixture();
    const r = scan(base);
    expect(r.status).toBe(0);
    expect(lines(r.out)).toEqual([
      'PRE-EXISTING (owner only):',
      '- [blocker] src/config.js:1 — critical secret: AWS access key id; value withheld',
      'END PRE-EXISTING', LOCK_NONE, 'SCAN-RESULT secrets=ran scripts=ran',
    ]);
    expect(r.out + r.err).not.toContain(AWS);
  });

  it('[S3] changedPackages on an npm lockfile lists a package whose versions changed and omits one whose versions did not', () => {
    expect(changed(lockFixture(), 'package-lock.json')).toEqual(['b']);
  });

  it('[S3] changedPackages on a pnpm lockfile lists a package whose versions changed and omits one whose versions did not', () => {
    initRepo(); put('pnpm-lock.yaml', pnpmLock(['/a@1.0.0', 'b@1.0.0', "'@s/c@1.0.0'", 'd@2.0.0(react@18.0.0)']));
    const base = commit();
    put('pnpm-lock.yaml', pnpmLock(['/a@1.0.0', 'b@1.1.0', "'@s/c@1.0.0'", 'd@2.0.0(react@18.0.0)']));
    expect(changed(base, 'pnpm-lock.yaml')).toEqual(['b']);
  });

  it('[S3] changedPackages returns all for a lockfile absent at the base', () => {
    expect(changed(absentFixture(), 'package-lock.json')).toBe('all');
  });

  it.each([['does not parse', '{ not json'], ['has no packages map', '{}\n']])('[S3] changedPackages returns failed for an npm lockfile that %s', (_, text) => {
    initRepo(); put('package-lock.json', text);
    expect(changed(commit(), 'package-lock.json')).toBe('failed');
  });

  it.each([
    ['a changed package', lockFixture, 'LOCKFILE package-lock.json changed=b'],
    ['no change', () => { initRepo(); put('package-lock.json', npmLock({ 'node_modules/a': { version: '1.0.0' } })); return commit(); }, 'LOCKFILE package-lock.json changed=none'],
    ['absent at the base', absentFixture, 'LOCKFILE package-lock.json changed=all'],
    ['a lockfile that does not parse', brokenFixture, 'LOCKFILE package-lock.json changed=all'],
    ['no lockfile', () => { initRepo(); put('a.txt', 'x\n'); const b = commit(); put('a.txt', 'y\n'); return b; }, 'LOCKFILE none'],
    ['pnpm before npm', () => { initRepo(); put('pnpm-lock.yaml', pnpmLock(['a@1.0.0'])); put('package-lock.json', npmLock({})); return commit(); }, 'LOCKFILE pnpm-lock.yaml changed=none'],
  ])('[S3] the LOCKFILE line prints changedPackages\' result: %s', (_, setup, expected) => {
    expect(lines(scan(setup()).out).at(-2)).toBe(expected);
  });

  it('[S3] a new key is introduced: it prints outside any owner-only block', () => {
    initRepo(); put('a.txt', 'x\n');
    const base = commit();
    put('src/config.js', `const k = '${AWS}';\n`);
    expect(lines(scan(base).out)).toEqual([
      '- [blocker] src/config.js:1 — critical secret: AWS access key id; value withheld', LOCK_NONE, 'SCAN-RESULT secrets=ran scripts=ran',
    ]);
  });

  it('scanChanges returns the FEAT-059 shape', () => {
    const base = movedFixture();
    const got = callExport(`m.scanChanges(process.cwd(), ${JSON.stringify(base)}, 'high')`);
    expect(Object.keys(got).sort()).toEqual(['changed', 'introduced', 'lockfile', 'preExisting', 'scripts', 'secrets']);
    expect(got.preExisting).toEqual(['- [blocker] src/config.js:1 — critical secret: AWS access key id; value withheld']);
    expect(got.introduced).toEqual([]);
    expect(got.lockfile).toBeNull();
  });
});
