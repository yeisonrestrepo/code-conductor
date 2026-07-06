import { cpSync, mkdirSync, chmodSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

// Verified at plan time: `find global skills project-template -type l` returns
// nothing — the bundled asset tree contains ZERO symlinks. `dereference: false`
// therefore never has a link to copy-as-link, so there is no Windows symlink-EPERM
// path here; the option is set only to guarantee that a symlink accidentally added
// later is copied as a link (never followed into user content), not resolved.
const CP_OPTS = { recursive: true, force: true, dereference: false };

// Pure guard: throws ONLY, emits nothing. It does not write a stderr diagnostic
// before throwing — run() surfaces the error's message exactly once
// (`code-conductor: missing bundled asset dir: <path>`), so warning here too would
// double-log. Keeping it side-effect-free also keeps it trivially unit-testable.
export function assertAssets(assetRoot, dirs) {
  for (const d of dirs) {
    const p = join(assetRoot, d);
    if (!existsSync(p)) {
      const err = new Error(`missing bundled asset dir: ${p}`);
      err.code = 'MISSING_ASSET';
      throw err;
    }
  }
}

// User data under global/memory (personal.md, verbosity.md) is preserved, so it
// is excluded from the forced overwrite and seeded write-if-absent by config.mjs.
// The filter matches on the path RELATIVE to the copy source, so a parent
// directory named e.g. "/memory/checkout/..." can never exclude every file.
function skipMemory(sourceRoot) {
  return (src) => {
    const rel = relative(sourceRoot, src);
    return rel !== 'memory' && !rel.startsWith(`memory${sep}`);
  };
}

export function deployGlobal(assetRoot, home) {
  const target = join(home, '.claude');
  const globalDir = join(assetRoot, 'global');
  mkdirSync(target, { recursive: true });
  cpSync(globalDir, target, { ...CP_OPTS, filter: skipMemory(globalDir) });
  cpSync(join(assetRoot, 'skills'), join(target, 'skills'), CP_OPTS);
  // skipMemory excludes global/memory from the copy, so cpSync never creates
  // <target>/memory. Create it explicitly here so the write-if-absent seeding in
  // config.mjs (and the version/verbosity writes) always has its parent dir.
  mkdirSync(join(target, 'memory'), { recursive: true });
  return target;
}

export function deployProject(assetRoot, cwd) {
  const target = join(cwd, '.claude');
  const templateRoot = join(assetRoot, 'project-template');
  // If something already occupies ./.claude and it is NOT a directory, this is a
  // precondition conflict (not a partial write): fail fast with a tagged error so
  // run() can report exit 1 with a clear message instead of a confusing cpSync abort.
  if (existsSync(target) && !statSync(target).isDirectory()) {
    const err = new Error(`cannot scaffold project: ${target} exists and is not a directory`);
    err.code = 'PROJECT_TARGET_NOT_DIR';
    throw err;
  }
  mkdirSync(target, { recursive: true });
  // project-template mirrors the project root layout (a .claude/ subdir plus
  // root files like CLAUDE.md/.gitignore) — copy each half to its matching
  // destination instead of nesting the whole tree under target.
  cpSync(join(templateRoot, '.claude'), target, CP_OPTS);
  for (const name of readdirSync(templateRoot)) {
    if (name === '.claude') continue;
    cpSync(join(templateRoot, name), join(cwd, name), CP_OPTS);
  }
  return target;
}

// Deliberately SILENT on a suppressed chmod error. On Windows chmod is a genuine
// no-op (POSIX perm bits do not apply) and the hook still runs via `bash <path>`,
// so a warning would be pure noise. The failure is always non-fatal; the deployed
// scripts remain functional. No diagnostic is emitted.
export function chmodHooks(claudeDir) {
  const hooksDir = join(claudeDir, 'hooks');
  if (!existsSync(hooksDir)) return;
  for (const name of readdirSync(hooksDir)) {
    if (!name.endsWith('.sh')) continue;
    try { chmodSync(join(hooksDir, name), 0o755); } catch { /* intentionally quiet — see above */ }
  }
}
