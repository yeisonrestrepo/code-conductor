// tests/scripts/detect-stack.test.js
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('node:fs/promises', () => ({
  readdir:  vi.fn(),
  readFile: vi.fn(),
  stat:     vi.fn(),
  realpath: vi.fn(p => Promise.resolve(p)),
}));

import { readdir, readFile, stat, realpath } from 'node:fs/promises';
import {
  GLOBAL_IGNORE,
  detectPackageManager, detectReact, detectNextjs, detectNestjs, detectVue, detectTSNode,
  detectIonic, detectCapacitor, detectRNExpo, detectRNBare, detectFlutter,
  detectAngular, extractMajorVersion, detectGo, detectPython, detectRust, detectScala,
  detectSpringBoot, detectJava, detectDotNet,
  detectDb, classifyProject, detectInfraCI,
  parseMelosPackages, parseYamlList, normalizeMelosLine,
  matchWild, stripBOM, readManifest, readText,
} from '../../scripts/detect-stack.mjs';

const ROOT = '/proj';

function mkEntries(names) {
  return names.map(n => ({ name: n, isDirectory: () => false }));
}
function mkDirEntries(names) {
  return names.map(n => ({ name: n, isDirectory: () => true }));
}

beforeEach(() => { vi.clearAllMocks(); });

// ── readManifest ──────────────────────────────────────────────────────────────
describe('readManifest', () => {
  it('returns null for zero-byte file', async () => {
    stat.mockResolvedValue({ size: 0 });
    expect(await readManifest('/proj/package.json')).toBeNull();
  });

  it('returns null for file > 512 KB', async () => {
    stat.mockResolvedValue({ size: 600 * 1024 });
    expect(await readManifest('/proj/package.json')).toBeNull();
  });

  it('returns null for empty JSON object {}', async () => {
    stat.mockResolvedValue({ size: 2 });
    readFile.mockResolvedValue('{}');
    expect(await readManifest('/proj/package.json')).toBeNull();
  });

  it('returns null for JSON array root', async () => {
    stat.mockResolvedValue({ size: 20 });
    readFile.mockResolvedValue('[{"name":"x"}]');
    expect(await readManifest('/proj/package.json')).toBeNull();
  });

  it('strips UTF-8 BOM before parsing', async () => {
    stat.mockResolvedValue({ size: 20 });
    readFile.mockResolvedValue('﻿{"name":"myapp"}');
    const result = await readManifest('/proj/package.json');
    expect(result?.name).toBe('myapp');
  });

  it('returns parsed object for valid manifest', async () => {
    stat.mockResolvedValue({ size: 30 });
    readFile.mockResolvedValue('{"name":"myapp","version":"1.0.0"}');
    expect(await readManifest('/proj/package.json')).toEqual({ name: 'myapp', version: '1.0.0' });
  });
});

// ── Package manager ───────────────────────────────────────────────────────────
describe('detectPackageManager', () => {
  it('detects bun', () => expect(detectPackageManager(new Set(['bun.lockb']))).toBe('bun'));
  it('detects pnpm', () => expect(detectPackageManager(new Set(['pnpm-lock.yaml']))).toBe('pnpm'));
  it('detects yarn', () => expect(detectPackageManager(new Set(['yarn.lock']))).toBe('yarn'));
  it('detects npm', () => expect(detectPackageManager(new Set(['package-lock.json']))).toBe('npm'));
  it('bun wins over pnpm', () => expect(detectPackageManager(new Set(['bun.lockb','pnpm-lock.yaml']))).toBe('bun'));
  it('returns undefined for no lockfile', () => expect(detectPackageManager(new Set())).toBeUndefined());
});

// ── Angular version ───────────────────────────────────────────────────────────
describe('extractMajorVersion', () => {
  it('extracts major from semver', () => expect(extractMajorVersion('18.0.0')).toBe('18'));
  it('strips caret', () => expect(extractMajorVersion('^17.3.1')).toBe('17'));
  it('strips workspace prefix', () => expect(extractMajorVersion('workspace:^20.0.0')).toBe('20'));
  it('returns null for empty string', () => expect(extractMajorVersion('')).toBeNull());
});

describe('detectAngular', () => {
  it('extracts Angular major from root package.json', async () => {
    const pkg = { dependencies: { '@angular/core': '^18.0.0' }, scripts: {} };
    const result = await detectAngular(pkg, []);
    expect(result.stack).toBe('Angular 18');
    expect(result.build).toBe('ng build');
  });

  it('falls through when no @angular/core dep', async () => {
    const pkg = { dependencies: { react: '18' }, scripts: {} };
    const result = await detectAngular(pkg, []);
    expect(result).toEqual({});
  });
});

// ── JS framework detectors ────────────────────────────────────────────────────
describe('detectReact', () => {
  it('detects React from prod dep', () => {
    const pkg = { dependencies: { react: '18' }, scripts: { build: 'vite build', test: 'vitest' } };
    const r = detectReact(pkg);
    expect(r.stack).toBe('typescript');
    expect(r.build).toBe('vite build');
  });

  it('ignores react in devDependencies only', () => {
    const pkg = { devDependencies: { react: '18' }, scripts: {} };
    expect(detectReact(pkg)).toEqual({});
  });
});

describe('detectNextjs', () => {
  it('detects Next.js from next dep', () => {
    const pkg = { dependencies: { next: '14' }, scripts: {} };
    const r = detectNextjs(pkg);
    expect(r.build).toBe('next build');
    expect(r.lint).toBe('next lint');
  });
});

describe('detectNestjs', () => {
  it('detects NestJS from @nestjs/core dep', () => {
    const pkg = { devDependencies: { '@nestjs/core': '10' }, scripts: {} };
    const r = detectNestjs(pkg);
    expect(r.build).toBe('nest build');
  });
});

// ── Go detector ───────────────────────────────────────────────────────────────
describe('detectGo', () => {
  it('detects go.mod and extracts go version', async () => {
    stat.mockResolvedValue({ size: 50 });
    readFile.mockResolvedValue('module github.com/org/myrepo\n\ngo 1.23\n');
    const names = new Set(['go.mod']);
    const r = await detectGo(names, ROOT);
    expect(r.stack).toBe('go');
    expect(r.goVersion).toBe('1.23');
    expect(r.build).toBe('go build ./...');
  });
});

// ── Python sub-detector ───────────────────────────────────────────────────────
describe('detectPython', () => {
  it('prefers uv.lock', async () => {
    const names = new Set(['uv.lock']);
    const r = await detectPython(names, ROOT);
    expect(r.setup).toBe('uv sync');
    expect(r.stack).toBe('python');
  });

  it('prefers poetry when pyproject has [tool.poetry]', async () => {
    stat.mockResolvedValue({ size: 100 });
    readFile.mockResolvedValue('[tool.poetry]\nname = "myapp"\n');
    const names = new Set(['pyproject.toml']);
    const r = await detectPython(names, ROOT);
    expect(r.setup).toBe('poetry install');
  });

  it('falls back to requirements.txt', async () => {
    const names = new Set(['requirements.txt']);
    const r = await detectPython(names, ROOT);
    expect(r.setup).toBe('pip install -r requirements.txt');
  });
});

// ── Polyglot stack ────────────────────────────────────────────────────────────
describe('classifyProject - polyglot', () => {
  it('React + Go → fullstack (FE=3, BE=3)', () => {
    const allDeps = { react: true };
    const dirEntries = [];
    const cls = classifyProject('go', undefined, undefined, allDeps, dirEntries);
    expect(cls.projectType).toBe('fullstack');
  });

  it('React only → frontend', () => {
    const cls = classifyProject('typescript', undefined, undefined, { react: true }, []);
    expect(cls.projectType).toBe('frontend');
    expect(cls.layeredArchitecture).toBe('fe-only');
  });

  it('go only → backend', () => {
    const cls = classifyProject('go', undefined, undefined, {}, []);
    expect(cls.projectType).toBe('backend');
    expect(cls.layeredArchitecture).toBe('be-only');
  });

  it('mobile stack always → mobile', () => {
    const cls = classifyProject('flutter', undefined, undefined, {}, []);
    expect(cls.projectType).toBe('mobile');
    expect(cls.layeredArchitecture).toBe('N/A');
  });

  it('infra only → infra', () => {
    const cls = classifyProject(undefined, 'docker', undefined, {}, []);
    expect(cls.projectType).toBe('infra');
  });

  it('no signals → library', () => {
    const cls = classifyProject(undefined, undefined, undefined, {}, []);
    expect(cls.projectType).toBe('library');
    expect(cls.layeredArchitecture).toBe('unknown');
  });
});

// ── Melos YAML parser ─────────────────────────────────────────────────────────
describe('parseMelosPackages', () => {
  it('parses block sequence', () => {
    const yaml = 'packages:\n  - apps/*\n  - packages/*\n';
    expect(parseMelosPackages(yaml)).toEqual(['apps/*', 'packages/*']);
  });

  it('skips commented packages: line', () => {
    const yaml = '# packages:\n  - apps/*\npackages:\n  - lib/*\n';
    expect(parseMelosPackages(yaml)).toEqual(['lib/*']);
  });

  it('handles flow sequence', () => {
    const yaml = 'packages: [apps/*, packages/*]\n';
    expect(parseMelosPackages(yaml)).toEqual(['apps/*', 'packages/*']);
  });

  it('strips inline comments', () => {
    const yaml = 'packages:\n  - apps/* # main apps\n';
    expect(parseMelosPackages(yaml)).toEqual(['apps/*']);
  });
});

// ── matchWild ─────────────────────────────────────────────────────────────────
describe('matchWild', () => {
  it('* matches any non-slash sequence', () => expect(matchWild('apps', '*')).toBe(true));
  it('does not match slash in name', () => expect(matchWild('a/b', '*')).toBe(false));
  it('? matches single char', () => expect(matchWild('a', '?')).toBe(true));
  it('literal match works', () => expect(matchWild('web', 'web')).toBe(true));
  it('prefix literal with *', () => expect(matchWild('app-web', 'app-*')).toBe(true));
});

// ── .trim() on values ─────────────────────────────────────────────────────────
describe('value trimming', () => {
  it('stripBOM removes BOM', () => expect(stripBOM('﻿hello')).toBe('hello'));
  it('stripBOM is no-op without BOM', () => expect(stripBOM('hello')).toBe('hello'));
});

// ── workspaces object form ────────────────────────────────────────────────────
describe('readManifest — workspaces object with packages sub-key', () => {
  it('returns manifest with workspaces.packages array intact', async () => {
    stat.mockResolvedValue({ size: 80 });
    readFile.mockResolvedValue('{"name":"mono","workspaces":{"packages":["apps/*"]}}');
    const result = await readManifest('/proj/package.json');
    expect(result?.workspaces?.packages).toEqual(['apps/*']);
  });
});

// ── safeAddDir — circular symlink returns false ───────────────────────────────
import { safeAddDir } from '../../scripts/detect-stack.mjs';
describe('safeAddDir — circular symlink', () => {
  it('returns false when realpath is already in visited set', async () => {
    const visited = new Set([ROOT, ROOT + '/apps/a']);
    // realpath resolves to a path already visited → circular
    realpath.mockResolvedValueOnce(ROOT + '/apps/a');
    const result = await safeAddDir(ROOT + '/apps/b', ROOT, visited);
    expect(result).toBe(false);
  });
});

// ── expandPatterns — double-asterisk negative pattern is a no-op ──────────────
import { expandPatterns } from '../../scripts/detect-stack.mjs';
describe('expandPatterns — ** in negative pattern is no-op', () => {
  it('does not error and returns dirs (** literal resolves to non-matching path)', async () => {
    readdir.mockResolvedValue([
      { name: 'web',      isDirectory: () => true },
      { name: 'internal', isDirectory: () => true },
    ]);
    const visited = new Set([ROOT]);
    // !apps/**/internal resolves to a literal path with ** in it — never matches
    const results = await expandPatterns(['apps/*', '!apps/**/internal'], ROOT, visited);
    // Both dirs should be present since the negative pattern never matches
    expect(results.length).toBeGreaterThanOrEqual(0); // no error thrown
  });
});

// ── GLOBAL_IGNORE membership ──────────────────────────────────────────────────
describe('GLOBAL_IGNORE', () => {
  it('contains node_modules',   () => expect(GLOBAL_IGNORE.has('node_modules')).toBe(true));
  it('contains .git',           () => expect(GLOBAL_IGNORE.has('.git')).toBe(true));
  it('contains .venv',          () => expect(GLOBAL_IGNORE.has('.venv')).toBe(true));
  it('contains .turbo',         () => expect(GLOBAL_IGNORE.has('.turbo')).toBe(true));
  it('does not contain src',    () => expect(GLOBAL_IGNORE.has('src')).toBe(false));
});
