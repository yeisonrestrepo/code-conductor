import { cpSync, mkdirSync, chmodSync, existsSync, lstatSync, readdirSync, readFileSync, statSync, rmSync, unlinkSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { mergeFileInto, resolveRealTarget } from './file-merge.mjs';
import { mergeClaudeMdText, appendMissingLinesText } from './merge-md.mjs';

// Host-authored data, not managed assets: these are merged, never force-copied —
// everything else in the template keeps its overwrite. Keyed by the name the file
// carries INSIDE project-template/ and valued by the name the host project uses:
// npm strips any file literally called `.gitignore` from every published tarball,
// so the template ships it undotted and this map restores the dot on deploy.
// Keying on the source name is load-bearing — skipping the copy loop on the
// target name instead would let cpSync drop a stray `gitignore` at the project root.
const MERGED_ROOT_FILES = new Map([
  ['CLAUDE.md', { target: 'CLAUDE.md', merge: mergeClaudeMdText }],
  ['gitignore', { target: '.gitignore', merge: appendMissingLinesText }],
]);

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
// CLAUDE.md is excluded for a different reason: deployGlobal merges it instead.
// The filter matches on the path RELATIVE to the copy source, so a parent
// directory named e.g. "/memory/checkout/..." can never exclude every file.
function skipHostOwned(sourceRoot) {
  return (src) => {
    const rel = relative(sourceRoot, src);
    if (rel === 'CLAUDE.md') return false;
    return rel !== 'memory' && !rel.startsWith(`memory${sep}`);
  };
}

// Derived from the shipped tree rather than a constant list: a hardcoded list
// silently drifts the day a skill is added or renamed.
function bundledSkillNames(assetRoot) {
  return readdirSync(join(assetRoot, 'skills'), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
}

// MUST run before the skills cpSync: a plain file sitting at skills/<name> makes
// the directory copy throw mid-deploy. Deliberately NOT suppressed — if the
// unlink fails, the cpSync error that follows carries the real diagnosis.
function unblockSkillPaths(assetRoot, skillsDir) {
  for (const name of bundledSkillNames(assetRoot)) {
    const p = join(skillsDir, name);
    let st;
    try { st = lstatSync(p); } catch { continue; }
    if (!st.isDirectory()) unlinkSync(p);
  }
}

// Pre-1.24 installs left skills/<name>.md flat files that Claude Code never reads.
// Remove one only when its bytes are still the bundled content — with OR without
// the frontmatter block, since 1.24 added frontmatter to two of them and a
// single comparison would leave those shadow files behind forever.
function sweepStaleFlatSkills(assetRoot, skillsDir) {
  for (const name of bundledSkillNames(assetRoot)) {
    const flat = join(skillsDir, `${name}.md`);
    if (!existsSync(flat) || !statSync(flat).isFile()) continue;
    const bundled = readFileSync(join(assetRoot, 'skills', name, 'SKILL.md'), 'utf8');
    const body = bundled.replace(/^---\n[\s\S]*?\n---\n\n?/, '');
    const current = readFileSync(flat, 'utf8');
    if (current !== bundled && current !== body) continue;
    try { unlinkSync(flat); } catch { /* cosmetic leftover, never fatal */ }
  }
}

// Pre-flight (run from bin/ BEFORE the first write): a directory or a dangling
// symlink at either CLAUDE.md target is unusable, and discovering that mid-copy
// would report a partial write (exit 2) for what is really a precondition failure.
export function assertMergeTargets(home, cwd, project) {
  const targets = [join(home, '.claude', 'CLAUDE.md')];
  if (project) targets.push(join(cwd, 'CLAUDE.md'));
  for (const p of targets) {
    const t = resolveRealTarget(p);
    if (!t.exists) continue;
    if (t.isDir || t.dangling) {
      const err = new Error(`cannot merge ${p}: the target is ${t.isDir ? 'a directory' : 'a dangling symlink'}`);
      err.code = 'CLAUDE_MD_NOT_FILE';
      throw err;
    }
  }
}

export function deployGlobal(assetRoot, home) {
  const target = join(home, '.claude');
  const globalDir = join(assetRoot, 'global');
  mkdirSync(target, { recursive: true });
  cpSync(globalDir, target, { ...CP_OPTS, filter: skipHostOwned(globalDir) });
  mergeFileInto(join(globalDir, 'CLAUDE.md'), join(target, 'CLAUDE.md'), mergeClaudeMdText);
  const skillsDir = join(target, 'skills');
  unblockSkillPaths(assetRoot, skillsDir);
  cpSync(join(assetRoot, 'skills'), skillsDir, CP_OPTS);
  sweepStaleFlatSkills(assetRoot, skillsDir);
  // skipHostOwned excludes global/memory from the copy, so cpSync never creates
  // <target>/memory. Create it explicitly here so the write-if-absent seeding in
  // config.mjs (and the version/verbosity writes) always has its parent dir.
  mkdirSync(join(target, 'memory'), { recursive: true });
  return target;
}

// 1.23.2 deployed scripts/ as a sibling of .claude at <cwd>/scripts instead of
// nesting it under .claude, colliding with any scripts/ the host project already
// owned. Only remove the stale dir when its contents are EXACTLY the bundled
// script file set (no extras) - anything else is presumed to be the host's own
// scripts/ and is left untouched.
function sweepStaleRootScripts(assetRoot, cwd) {
  const staleDir = join(cwd, 'scripts');
  if (!existsSync(staleDir) || !statSync(staleDir).isDirectory()) return;
  const bundled = readdirSync(join(assetRoot, 'scripts')).sort();
  const present = readdirSync(staleDir).sort();
  const matches = bundled.length === present.length && bundled.every((f, i) => f === present[i]);
  if (matches) rmSync(staleDir, { recursive: true, force: true });
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
    if (name === '.claude' || MERGED_ROOT_FILES.has(name)) continue;
    cpSync(join(templateRoot, name), join(cwd, name), CP_OPTS);
  }
  for (const [source, { target: dest, merge }] of MERGED_ROOT_FILES) {
    mergeFileInto(join(templateRoot, source), join(cwd, dest), merge);
  }
  // scripts/ is a sibling of project-template/ under assetRoot (source layout),
  // but is deployed as a CHILD of .claude/ (target) - it must stay inside the
  // project's self-contained .claude footprint, not spill into the host's own
  // project root where it could collide with a scripts/ dir the host already owns.
  sweepStaleRootScripts(assetRoot, cwd);
  cpSync(join(assetRoot, 'scripts'), join(target, 'scripts'), CP_OPTS);
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
