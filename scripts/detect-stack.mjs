// scripts/detect-stack.mjs
import { readdir, readFile, stat, realpath } from 'node:fs/promises';
import { join, resolve, basename, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Constants ────────────────────────────────────────────────────────────────
export const GLOBAL_IGNORE = new Set([
  'node_modules', '.git', '.svn', '.hg', '.expo', '.dart_tool', '.pub-cache',
  '__pycache__', '.gradle', '.m2', 'vendor', 'dist', 'build', 'out',
  '.next', '.nuxt', '.cache', '.parcel-cache', '.venv', '.turbo',
]);
const MAX_FILE_SIZE   = 512 * 1024;
const MAX_DIRS        = 200;
const READDIR_TIMEOUT = 10_000;
const DEFAULT_DEPTH   = 5;
const MAX_DEPTH       = 20;

export const globDepth = (() => {
  const v = parseInt(process.env.CC_GLOB_DEPTH ?? '', 10);
  if (!Number.isFinite(v)) return DEFAULT_DEPTH;
  return Math.max(1, Math.min(MAX_DEPTH, v));
})();

// ── Low-level helpers ─────────────────────────────────────────────────────────
export function stripBOM(s) { return s.replace(/^﻿/, ''); }

export function warn(msg) { process.stderr.write(`WARN: ${msg}\n`); }

export async function readdirSafe(dir) {
  return Promise.race([
    readdir(dir, { withFileTypes: true }),
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), READDIR_TIMEOUT)),
  ]).catch(err => {
    warn(`readdir ${err.message === 'timeout' ? 'timeout' : 'error'} — skipped: ${dir}`);
    return [];
  });
}

export async function readManifest(filepath) {
  try {
    const s = await stat(filepath);
    if (s.size === 0) { warn(`zero-byte manifest skipped: ${filepath}`); return null; }
    if (s.size > MAX_FILE_SIZE) { warn(`manifest too large (>512KB), skipped: ${filepath}`); return null; }
    const raw = JSON.parse(stripBOM(await readFile(filepath, 'utf8')));
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
    if (Object.keys(raw).length === 0) return null;
    return raw;
  } catch { return null; }
}

export async function readText(filepath, maxLines = Infinity) {
  try {
    const s = await stat(filepath);
    if (s.size === 0 || s.size > MAX_FILE_SIZE) return null;
    const raw = stripBOM(await readFile(filepath, 'utf8'));
    return maxLines === Infinity ? raw : raw.split('\n').slice(0, maxLines).join('\n');
  } catch { return null; }
}

export function pkgDep(pkg, name) {
  return !!(pkg?.dependencies?.[name] || pkg?.devDependencies?.[name]);
}
export function pkgProdDep(pkg, name) { return !!(pkg?.dependencies?.[name]); }

// ── Glob expansion ─────────────────────────────────────────────────────────────
export function matchWild(name, pattern) {
  const re = '^' + pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '*')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]') + '$';
  return new RegExp(re).test(name);
}

export async function safeAddDir(abs, rootReal, visited) {
  try {
    const real = await realpath(abs);
    if (!real.startsWith(rootReal + sep) && real !== rootReal) {
      warn(`symlink target outside project root — skipped: ${abs}`);
      return false;
    }
    if (visited.has(real)) return false;
    visited.add(real);
    return true;
  } catch { return false; }
}

export async function expandGlob(pattern, rootReal, visited, depth = 0) {
  if (depth >= globDepth) return [];
  if (pattern.startsWith('/') || /^[A-Za-z]:[\\/]/.test(pattern)) {
    warn(`absolute path in workspace entry rejected: ${pattern}`);
    return [];
  }
  const segs    = pattern.split('/').filter(Boolean);
  const wildIdx = segs.findIndex(s => s.includes('*') || s.includes('?'));
  if (wildIdx === -1) {
    const abs = resolve(rootReal, pattern);
    return (await safeAddDir(abs, rootReal, visited)) ? [abs] : [];
  }
  const base    = resolve(rootReal, ...segs.slice(0, wildIdx));
  const wcSeg   = segs[wildIdx];
  const rest    = segs.slice(wildIdx + 1).join('/');
  const entries = await readdirSafe(base);
  const results = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (GLOBAL_IGNORE.has(e.name) || e.name.startsWith('.')) continue;
    if (!matchWild(e.name, wcSeg)) continue;
    if (rest) {
      results.push(...await expandGlob(rest, join(base, e.name), visited, depth + 1));
    } else {
      const abs = join(base, e.name);
      if (await safeAddDir(abs, rootReal, visited)) results.push(abs);
    }
  }
  return results;
}

export async function expandPatterns(patterns, rootReal, visited) {
  const positive = patterns.filter(p => !p.startsWith('!'));
  const negative = patterns.filter(p => p.startsWith('!')).map(p => resolve(rootReal, p.slice(1)));
  const dirs = [];
  for (const p of positive) dirs.push(...await expandGlob(p, rootReal, visited));
  return [...new Set(dirs)].filter(d => !negative.some(n => d === n || d.startsWith(n + sep)));
}

// ── YAML line-scanners ─────────────────────────────────────────────────────────
export function normalizeMelosLine(raw) {
  let s = raw.trim();
  if (!s || s.startsWith('#')) return null;
  s = s.replace(/^-\s+/, '');
  s = s.replace(/^(["'])(.*)\1$/, '$2');
  s = s.replace(/#.*$/, '').trim();
  s = s.replace(/&\w+/g, '').replace(/\*\w+/g, '').trim();
  if (!s || s.startsWith('#')) return null;
  return s;
}

export function parseMelosPackages(content) {
  const lines = content.split('\n');
  const results = [];
  let inPkgs = false;
  for (const line of lines) {
    const col0NotComment = line.length > 0 && line[0] !== '#' && line[0] !== ' ' && line[0] !== '\t';
    if (col0NotComment && /^packages\s*:/.test(line)) {
      const flow = line.match(/:\s*\[([^\]]*)\]/);
      if (flow) {
        flow[1].split(',').map(normalizeMelosLine).filter(Boolean).forEach(p => results.push(p));
        inPkgs = false;
      } else { inPkgs = true; }
      continue;
    }
    if (inPkgs) {
      if (col0NotComment && !/^[-\s]/.test(line)) break;
      const n = normalizeMelosLine(line);
      if (n) results.push(n);
    }
  }
  return results;
}

export function parseYamlList(content, key) {
  const lines = content.split('\n');
  const results = [];
  let inSection = false;
  for (const line of lines) {
    const col0NC = line.length > 0 && line[0] !== '#' && line[0] !== ' ' && line[0] !== '\t';
    if (col0NC && new RegExp('^' + key + '\\s*:').test(line)) {
      const flow = line.match(/:\s*\[([^\]]*)\]/);
      if (flow) {
        flow[1].split(',').map(normalizeMelosLine).filter(Boolean).forEach(p => results.push(p));
        inSection = false;
      } else { inSection = true; }
      continue;
    }
    if (inSection) {
      if (col0NC && !/^[-\s]/.test(line)) break;
      const n = normalizeMelosLine(line);
      if (n) results.push(n);
    }
  }
  return results;
}

// ── Package manager ───────────────────────────────────────────────────────────
export function detectPackageManager(names) {
  if (names.has('bun.lockb'))         return 'bun';
  if (names.has('pnpm-lock.yaml'))    return 'pnpm';
  if (names.has('yarn.lock'))         return 'yarn';
  if (names.has('package-lock.json')) return 'npm';
  return undefined;
}

// ── Angular version extraction ────────────────────────────────────────────────
export function extractMajorVersion(v) {
  if (!v) return null;
  let s = v.trim();
  if (s.startsWith('workspace:')) s = s.slice('workspace:'.length).trim();
  s = s.replace(/^[~^>=<]+/, '');
  const major = s.split('.')[0];
  return (major && /^\d+$/.test(major)) ? major : null;
}

// ── Detectors (return partial result objects) ──────────────────────────────────
export function detectIonic(names) {
  if (!names.has('ionic.config.json')) return {};
  return { stack: 'ionic', build: 'ionic build', test: 'npm test', setup: 'npm install' };
}

export function detectCapacitor(names) {
  if (names.has('ionic.config.json')) return {};
  if (!names.has('capacitor.config.json') && !names.has('capacitor.config.ts')) return {};
  return { stack: 'capacitor', build: 'npx cap build', setup: 'npm install && npx cap sync' };
}

export function detectRNExpo(pkg) {
  if (!pkg || !pkgDep(pkg, 'react-native') || !pkgDep(pkg, 'expo')) return {};
  return { stack: 'react-native-expo', build: 'expo build', test: 'jest', setup: 'npm install' };
}

export function detectRNBare(pkg, names) {
  if (!pkg || !pkgDep(pkg, 'react-native')) return {};
  if (names.has('ionic.config.json') || names.has('capacitor.config.json') || names.has('capacitor.config.ts')) return {};
  return { stack: 'react-native', build: 'react-native bundle', test: 'jest', setup: 'npm install' };
}

export async function detectFlutter(names, root) {
  if (!names.has('pubspec.yaml')) return {};
  const c = await readText(join(root, 'pubspec.yaml'));
  if (!c || !/^flutter\s*:/m.test(c)) return {};
  return { stack: 'flutter', build: 'flutter build', test: 'flutter test', lint: 'flutter analyze', format: 'dart format .', setup: 'flutter pub get' };
}

export async function detectAngular(pkg, workspacePkgs) {
  for (const p of [pkg, ...(workspacePkgs ?? [])].filter(Boolean)) {
    const v = p?.dependencies?.['@angular/core'] || p?.devDependencies?.['@angular/core'];
    const major = extractMajorVersion(v);
    if (!major) continue;
    const s = p.scripts ?? {};
    return { stack: `Angular ${major}`, build: s.build ?? 'ng build', test: s.test ?? 'ng test', lint: s.lint ?? 'ng lint', format: 'prettier --write .', setup: 'npm install' };
  }
  return {};
}

export function detectNextjs(pkg) {
  if (!pkg || !pkgDep(pkg, 'next')) return {};
  const s = pkg.scripts ?? {};
  return { stack: 'typescript', build: s.build ?? 'next build', test: s.test ?? 'jest', lint: s.lint ?? 'next lint', format: 'prettier --write .', setup: 'npm install' };
}

export function detectNestjs(pkg) {
  if (!pkg || !pkgDep(pkg, '@nestjs/core')) return {};
  const s = pkg.scripts ?? {};
  return { stack: 'typescript', build: s.build ?? 'nest build', test: s.test ?? 'jest', lint: s.lint ?? 'eslint .', format: 'prettier --write .', setup: 'npm install' };
}

export function detectReact(pkg) {
  if (!pkg || !pkgProdDep(pkg, 'react')) return {};
  const s = pkg.scripts ?? {};
  return { stack: 'typescript', build: s.build, test: s.test ?? 'jest', lint: s.lint, format: 'prettier --write .', setup: 'npm install' };
}

export function detectVue(pkg) {
  if (!pkg || !pkgProdDep(pkg, 'vue')) return {};
  const s = pkg.scripts ?? {};
  return { stack: 'typescript', build: s.build, test: s.test ?? 'vitest', lint: s.lint, format: 'prettier --write .', setup: 'npm install' };
}

export function detectTSNode(pkg) {
  if (!pkg) return {};
  const s = pkg.scripts ?? {};
  const hasDep = pkgDep(pkg, 'typescript') || pkgDep(pkg, 'ts-node');
  if (!hasDep && !pkg.name) return {};
  return { stack: 'typescript', build: s.build, test: s.test, lint: s.lint, format: s.format, setup: 'npm install' };
}

export async function detectGo(names, root) {
  if (!names.has('go.mod')) return {};
  const c = await readText(join(root, 'go.mod'), 20);
  const m = c?.match(/^go\s+(\d+\.\d+)/m);
  const result = { stack: 'go', build: 'go build ./...', test: 'go test ./...', format: 'gofmt -w .', setup: 'go mod download' };
  if (m) result.goVersion = m[1];
  return result;
}

export async function detectPython(names, root) {
  if (!names.has('pyproject.toml') && !names.has('requirements.txt') &&
      !names.has('Pipfile') && !names.has('uv.lock') && !names.has('poetry.lock') && !names.has('hatch.toml')) return {};
  if (names.has('uv.lock')) return { stack: 'python', test: 'uv run pytest', lint: 'uv run ruff check .', format: 'uv run ruff format .', setup: 'uv sync' };
  const py = names.has('pyproject.toml') ? await readText(join(root, 'pyproject.toml')) : null;
  if (py && /^\[tool\.uv\]/m.test(py)) return { stack: 'python', test: 'uv run pytest', lint: 'uv run ruff check .', format: 'uv run ruff format .', setup: 'uv sync' };
  if ((py && /^\[tool\.poetry\]/m.test(py)) || names.has('poetry.lock')) return { stack: 'python', test: 'poetry run pytest', lint: 'poetry run ruff check .', format: 'poetry run ruff format .', setup: 'poetry install' };
  if (names.has('Pipfile')) return { stack: 'python', test: 'pipenv run pytest', setup: 'pipenv install' };
  if ((py && /^\[tool\.hatch\]/m.test(py)) || names.has('hatch.toml')) return { stack: 'python', test: 'hatch run test', setup: 'hatch env create' };
  if (names.has('requirements.txt')) return { stack: 'python', test: 'pytest', setup: 'pip install -r requirements.txt' };
  if (py) return { stack: 'python', test: 'pytest', setup: 'pip install -e .' };
  return {};
}

export async function detectRust(names, root) {
  if (!names.has('Cargo.toml')) return {};
  const c = await readText(join(root, 'Cargo.toml'));
  let name;
  if (c) {
    const blocks = c.split(/\n(?=\[)/);
    for (const b of blocks) {
      if (!/^\[package\]/.test(b)) continue;
      const m = b.match(/^name\s*=\s*"([^"]+)"/m);
      if (m) { name = m[1]; break; }
    }
  }
  return { stack: 'rust', name, build: 'cargo build', test: 'cargo test', lint: 'cargo clippy -- -D warnings', format: 'cargo fmt', setup: 'cargo fetch' };
}

export function detectScala(names) {
  if (!names.has('build.sbt')) return {};
  return { stack: 'scala', build: 'sbt compile', test: 'sbt test', lint: 'sbt scalafmt --check', format: 'sbt scalafmt', setup: 'sbt update' };
}

export async function detectSpringBoot(names, root) {
  const hasPom = names.has('pom.xml');
  const hasBuild = names.has('build.gradle') || names.has('build.gradle.kts');
  if (!hasPom && !hasBuild) return {};
  if (hasPom) {
    const c = await readText(join(root, 'pom.xml'));
    if (c?.includes('spring-boot-starter')) {
      const w = names.has('mvnw') ? './mvnw' : 'mvn';
      return { stack: 'spring-boot', build: `${w} package -DskipTests`, test: `${w} test`, setup: `${w} dependency:resolve` };
    }
  }
  if (hasBuild) {
    const fname = names.has('build.gradle.kts') ? 'build.gradle.kts' : 'build.gradle';
    const c = await readText(join(root, fname));
    if (c?.includes('spring-boot-starter')) {
      const w = names.has('gradlew') ? './gradlew' : 'gradle';
      return { stack: 'spring-boot', build: `${w} build`, test: `${w} test`, setup: `${w} dependencies` };
    }
  }
  return {};
}

export async function detectQuarkus(names, root) {
  const hasPom = names.has('pom.xml');
  const hasBuild = names.has('build.gradle') || names.has('build.gradle.kts');
  if (!hasPom && !hasBuild) return {};
  const fname = hasPom ? 'pom.xml' : (names.has('build.gradle.kts') ? 'build.gradle.kts' : 'build.gradle');
  const c = await readText(join(root, fname));
  if (!c?.includes('quarkus')) return {};
  const w = hasBuild ? (names.has('gradlew') ? './gradlew' : 'gradle') : (names.has('mvnw') ? './mvnw' : 'mvn');
  return { stack: 'java', build: `${w} package`, test: `${w} test`, setup: hasBuild ? `${w} quarkusDev` : `${w} quarkus:dev` };
}

export async function detectJava(names, root) {
  const hasPom = names.has('pom.xml');
  const hasBuild = names.has('build.gradle') || names.has('build.gradle.kts');
  if (!hasPom && !hasBuild) return {};
  if (hasPom) {
    const w = names.has('mvnw') ? './mvnw' : 'mvn';
    return { stack: 'java', build: `${w} package`, test: `${w} test`, setup: `${w} dependency:resolve` };
  }
  const w = names.has('gradlew') ? './gradlew' : 'gradle';
  return { stack: 'java', build: `${w} build`, test: `${w} test`, setup: `${w} dependencies` };
}

export function detectDotNet(names) {
  const csproj = [...names].find(n => n.endsWith('.csproj'));
  const sln    = [...names].find(n => n.endsWith('.sln'));
  if (!csproj && !sln) return {};
  return { stack: 'csharp', build: 'dotnet build', test: 'dotnet test', lint: 'dotnet format --verify-no-changes', format: 'dotnet format', setup: sln ? `dotnet restore ${sln}` : 'dotnet restore' };
}

export async function detectIOS(names, root) {
  const xcw = [...names].find(n => n.endsWith('.xcworkspace'));
  const xcp = [...names].find(n => n.endsWith('.xcodeproj'));
  if (!xcw && !xcp) return {};
  const target = xcw ?? xcp;
  const scheme = target.replace(/\.(xcworkspace|xcodeproj)$/, '');
  return { stack: 'swift', build: `xcodebuild -workspace ${target} -scheme ${scheme} -sdk iphonesimulator build`, test: 'xcodebuild test', setup: names.has('Podfile') ? 'pod install' : 'swift package resolve' };
}

export async function detectAndroid(names, root) {
  const aEntries = await readdirSafe(join(root, 'android'));
  if (!aEntries.length) return {};
  const aNames = new Set(aEntries.map(e => e.name));
  if (!aNames.has('build.gradle') && !aNames.has('build.gradle.kts')) return {};
  const w = names.has('gradlew') ? './gradlew' : 'gradle';
  let isKotlin = false;
  try {
    const srcE = await readdirSafe(join(root, 'android', 'app', 'src'));
    isKotlin = srcE.some(e => e.name.endsWith('.kt'));
  } catch {}
  return { stack: isKotlin ? 'kotlin' : 'java', build: `${w} assembleDebug`, test: `${w} test`, lint: `${w} lint`, setup: `${w} dependencies` };
}

// ── DB signals ────────────────────────────────────────────────────────────────
export async function detectDb(names, root, pkg, stack) {
  if (names.has('schema.prisma')) return 'prisma';
  try {
    const pD = await readdirSafe(join(root, 'prisma'));
    if (pD.some(e => e.name === 'schema.prisma')) return 'prisma';
  } catch {}
  if (names.has('migrations') || names.has('db')) return 'migrations';
  if (pkg) {
    const d = { ...pkg.dependencies, ...pkg.devDependencies };
    if (d['@prisma/client'] || d['prisma']) return 'prisma';
    if (d['pg']) return 'postgres';
    if (d['mysql2'] || d['mysql']) return 'mysql';
    if (d['mongodb'] || d['mongoose']) return 'mongodb';
    if (d['sqlite3'] || d['better-sqlite3']) return 'sqlite';
  }
  if (stack === 'go') {
    const c = await readText(join(root, 'go.mod'));
    if (c && (c.includes('gorm.io/gorm') || c.includes('entgo.io/ent') || c.includes('database/sql'))) return 'go-orm';
  }
  if (stack === 'rust') {
    const c = await readText(join(root, 'Cargo.toml'));
    if (c && (c.includes('diesel') || c.includes('sqlx'))) return 'rust-db';
  }
  if (stack === 'java' || stack === 'spring-boot') {
    const fname = names.has('pom.xml') ? 'pom.xml' : (names.has('build.gradle.kts') ? 'build.gradle.kts' : 'build.gradle');
    const c = await readText(join(root, fname));
    if (c && (c.includes('spring-data') || c.includes('hibernate'))) return 'jpa';
  }
  return undefined;
}

// ── Infra / CI ────────────────────────────────────────────────────────────────
export async function detectInfraCI(names, root) {
  let infra, ci;
  try {
    const gw = await readdirSafe(join(root, '.github', 'workflows'));
    if (gw.length > 0) ci = 'github-actions';
  } catch {}
  const hasK8s = names.has('k8s') || names.has('kubernetes') || [...names].some(n => /^(deployment|service|ingress).*\.ya?ml$/.test(n));
  if (hasK8s) infra = 'kubernetes';
  else if ([...names].some(n => n.endsWith('.tf'))) infra = 'terraform';
  else if (names.has('Dockerfile') || [...names].some(n => n.startsWith('Dockerfile.')) || names.has('docker-compose.yml') || names.has('docker-compose.yaml') || names.has('compose.yml')) infra = 'docker';
  return { infra, ci };
}

// ── Architecture ──────────────────────────────────────────────────────────────
export async function detectArchitecture(names, root) {
  const check = async (targets) => {
    if (targets.some(d => names.has(d))) return true;
    if (!names.has('src')) return false;
    const srcE = await readdirSafe(join(root, 'src'));
    return targets.some(d => srcE.some(e => e.name === d && e.isDirectory()));
  };
  if (await check(['domain', 'ports', 'adapters', 'application', 'infrastructure'])) return 'clean';
  if (await check(['controllers', 'models', 'views'])) return 'mvc';
  if (await check(['service', 'repository', 'dao'])) return 'layered';
  return undefined;
}

// ── Project classification ─────────────────────────────────────────────────────
const MOBILE_STACKS = new Set(['react-native', 'react-native-expo', 'flutter', 'swift', 'kotlin', 'ionic', 'capacitor']);

export function classifyProject(stack, infra, db, allDeps, dirEntries) {
  if (stack && MOBILE_STACKS.has(stack)) return { projectType: 'mobile', layeredArchitecture: 'N/A' };
  let FE = 0, BE = 0;
  ['react','vue','svelte'].forEach(d => { if (allDeps[d]) FE += 3; });
  ['express','fastify','hono','koa'].forEach(d => { if (allDeps[d]) BE += 3; });
  if (allDeps['@nestjs/core']) BE += 3;
  if (['go','java','spring-boot','scala','rust','csharp','python'].includes(stack)) BE += 3;
  const dirNames = new Set(dirEntries.filter(e => e.isDirectory()).map(e => e.name));
  if (['src','public','static','assets'].some(d => dirNames.has(d))) FE += 1;
  if (['api','server','cmd','internal'].some(d => dirNames.has(d))) BE += 2;
  if (db) BE += 1;
  if (infra && FE < 2 && BE < 2) return { projectType: 'infra', layeredArchitecture: 'N/A' };
  if (FE >= 2 && BE >= 2) return { projectType: 'fullstack', layeredArchitecture: 'fullstack' };
  if (FE >= 2) return { projectType: 'frontend', layeredArchitecture: 'fe-only' };
  if (BE >= 2) return { projectType: 'backend', layeredArchitecture: 'be-only' };
  return { projectType: 'library', layeredArchitecture: 'unknown' };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const root = process.argv[2] ?? process.cwd();
  let rootReal;
  try { rootReal = await realpath(root); } catch (err) {
    process.stderr.write(JSON.stringify({ error: err.message, code: err.code ?? 'UNKNOWN' }) + '\n');
    process.stdout.write('{}\n');
    return;
  }

  let rootEntries;
  try { rootEntries = await readdir(rootReal, { withFileTypes: true }); }
  catch (err) {
    process.stderr.write(JSON.stringify({ error: err.message, code: err.code ?? 'UNKNOWN' }) + '\n');
    process.stdout.write('{}\n');
    return;
  }
  const rootNames = new Set(rootEntries.map(e => e.name));
  const visited   = new Set([rootReal]);

  const packageManager = detectPackageManager(rootNames);

  const rootPkg = rootNames.has('package.json') ? await readManifest(join(rootReal, 'package.json')) : null;

  let workspaceDirs = [];
  let monorepo = false;
  let melosMonorepo = false;

  if (rootNames.has('pnpm-workspace.yaml')) {
    monorepo = true;
    const c = await readText(join(rootReal, 'pnpm-workspace.yaml'));
    const patterns = c ? parseYamlList(c, 'packages') : ['apps/*', 'packages/*'];
    workspaceDirs = await expandPatterns(patterns.length ? patterns : ['apps/*', 'packages/*'], rootReal, visited);
  } else if (rootNames.has('melos.yaml')) {
    monorepo = true; melosMonorepo = true;
    const c = await readText(join(rootReal, 'melos.yaml'));
    const patterns = c ? parseMelosPackages(c) : [];
    workspaceDirs = await expandPatterns(patterns.length ? patterns : ['apps/*', 'packages/*'], rootReal, visited);
  } else if (rootPkg) {
    const ws = rootPkg.workspaces;
    let patterns = [];
    if (Array.isArray(ws) && ws.length > 0) { patterns = ws; monorepo = true; }
    else if (ws && !Array.isArray(ws) && Array.isArray(ws.packages)) { patterns = ws.packages; monorepo = true; }
    if (monorepo) workspaceDirs = await expandPatterns(patterns, rootReal, visited);
  }

  if (rootNames.has('go.work')) {
    const c = await readText(join(rootReal, 'go.work'));
    if (c) {
      for (const m of c.matchAll(/^\s*use\s+(\S+)/gm)) {
        const rel = m[1];
        if (rel.startsWith('../')) { warn(`go.work use directive points outside project root — skipped: ${rel}`); continue; }
        const abs = resolve(rootReal, rel);
        if (await safeAddDir(abs, rootReal, visited)) workspaceDirs.push(abs);
      }
    }
  }

  workspaceDirs = [...new Set(workspaceDirs)].sort();
  if (workspaceDirs.length > MAX_DIRS) {
    warn(`workspace dir count exceeds ${MAX_DIRS} — truncating`);
    workspaceDirs = workspaceDirs.slice(0, MAX_DIRS);
  }

  const workspacePkgs = [];
  for (const dir of workspaceDirs) {
    const entries = await readdirSafe(dir);
    const names   = new Set(entries.map(e => e.name));
    if (names.has('package.json')) workspacePkgs.push(await readManifest(join(dir, 'package.json')));
    else workspacePkgs.push(null);
  }

  const allDeps = {};
  [rootPkg, ...workspacePkgs].filter(Boolean).forEach(p => {
    Object.keys(p.dependencies ?? {}).forEach(k => { allDeps[k] = true; });
  });

  const detectorResults = [
    detectIonic(rootNames),
    detectCapacitor(rootNames),
    detectRNExpo(rootPkg),
    detectRNBare(rootPkg, rootNames),
    await detectFlutter(rootNames, rootReal),
    await detectAngular(rootPkg, workspacePkgs),
    detectNextjs(rootPkg),
    detectNestjs(rootPkg),
    detectReact(rootPkg),
    detectVue(rootPkg),
    detectTSNode(rootPkg),
    await detectGo(rootNames, rootReal),
    await detectPython(rootNames, rootReal),
    await detectRust(rootNames, rootReal),
    detectScala(rootNames),
    await detectSpringBoot(rootNames, rootReal),
    await detectQuarkus(rootNames, rootReal),
    await detectJava(rootNames, rootReal),
    detectDotNet(rootNames),
    await detectIOS(rootNames, rootReal),
    await detectAndroid(rootNames, rootReal),
  ];

  const merged = {};
  const MERGE_FIELDS = ['stack','build','test','lint','format','setup','name','goVersion'];
  for (const d of detectorResults) {
    for (const f of MERGE_FIELDS) {
      if (merged[f] === undefined && d[f] !== undefined) merged[f] = d[f];
    }
  }

  const langSignals = [];
  if (rootNames.has('package.json') && rootPkg) langSignals.push('typescript');
  if (rootNames.has('go.mod'))   langSignals.push('go');
  if (rootNames.has('Cargo.toml')) langSignals.push('rust');
  if (rootNames.has('pom.xml') || rootNames.has('build.gradle')) langSignals.push('java');
  if (langSignals.length > 1) merged.stack = langSignals.join('/');

  if (rootPkg?.scripts) {
    const s = rootPkg.scripts;
    if (!merged.build && s.build) merged.build = s.build.trim();
    if (!merged.test  && s.test)  merged.test  = s.test.trim();
    if (!merged.lint  && s.lint)  merged.lint  = s.lint.trim();
    if (!merged.format && s.format) merged.format = s.format.trim();
  }

  if (monorepo) {
    if (packageManager === 'pnpm') {
      if (!merged.build || merged.build === 'npm run build') merged.build = 'pnpm -r build';
      if (!merged.test  || merged.test  === 'npm test')     merged.test  = 'pnpm -r test';
    } else if (melosMonorepo) {
      merged.setup = 'melos bootstrap';
    }
  }

  if (!merged.name) {
    if (rootPkg?.name) merged.name = rootPkg.name;
    else if (rootNames.has('go.mod')) {
      const c = await readText(join(rootReal, 'go.mod'), 5);
      const m = c?.match(/^module\s+(\S+)/m);
      if (m) merged.name = m[1].split('/').pop();
    }
    if (!merged.name) merged.name = basename(rootReal);
  }

  if (rootPkg?.description) merged.description = rootPkg.description.trim().replace(/\r?\n/g, ' ');

  const db = await detectDb(rootNames, rootReal, rootPkg, merged.stack);
  const { infra, ci } = await detectInfraCI(rootNames, rootReal);
  const arch = await detectArchitecture(rootNames, rootReal);
  const cls  = classifyProject(merged.stack, infra, db, allDeps, rootEntries);

  const raw = {
    name:               merged.name,
    description:        merged.description,
    stack:              merged.stack,
    build:              merged.build,
    test:               merged.test,
    lint:               merged.lint,
    format:             merged.format,
    setup:              merged.setup,
    packageManager:     packageManager,
    monorepo:           monorepo || undefined,
    workspaceDirs:      workspaceDirs.length ? workspaceDirs : undefined,
    goVersion:          merged.goVersion,
    db:                 db,
    projectType:        cls.projectType,
    layeredArchitecture: cls.layeredArchitecture,
    architecture:       arch,
    infra:              infra,
    ci:                 ci,
  };

  const output = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    if (Array.isArray(v) && v.length === 0) continue;
    output[k] = typeof v === 'string' ? v.trim() : v;
  }

  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
  process.exit(0); // Required: pending readdirSafe timeouts keep the event loop alive without this
}

process.on('unhandledRejection', err => {
  process.stderr.write(JSON.stringify({ error: String(err), code: 'UNHANDLED_REJECTION' }) + '\n');
  process.stdout.write('{}\n');
  process.exit(0);
});

process.on('uncaughtException', err => {
  process.stderr.write(JSON.stringify({ error: err.message ?? String(err), code: err.code ?? 'UNCAUGHT_EXCEPTION' }) + '\n');
  process.stdout.write('{}\n');
  process.exit(0);
});

// Guard: run main() only when this file is the entry point
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
  main().catch(err => {
    process.stderr.write(JSON.stringify({ error: err.message, code: err.code ?? 'UNKNOWN' }) + '\n');
    process.stdout.write('{}\n');
    process.exit(0);
  });
}
