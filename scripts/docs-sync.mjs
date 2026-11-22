// scripts/docs-sync.mjs
// The Ship band's docs reconciliation (FEAT-036): digest proves the work tree is a shipped release and
// prints what it changed; check judges the docs role's uncommitted diff and citations. It spawns only git,
// writes nothing, and has no top-level side effect: orchestrate.mjs imports docSurface for the envelope scope.
import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DocLocationError, resolveDocLocations } from './doc-locations.mjs';

export const DOC_SURFACE = ['README.md', 'project-template/CLAUDE.md', 'docs/*.md', 'docs/guides/**/*.md', '.github/wiki/pages/*.md'];
export const RANGE_MAX = 300;
const USAGE = 'usage: docs-sync.mjs <digest|check> --release <ref> [--since <ref>]';
const MANAGED_FILE = 'project-template/CLAUDE.md';
const MANAGED_START = '<!-- cc:managed:start -->';
const MANAGED_END = '<!-- cc:managed:end -->';
const MALFORMED = 'malformed; write CITE <path>:<+|-><line> commit <sha> or file <path>[:<line>]';
const CITE_RE = /^CITE (.+?):([+-])([1-9][0-9]*) (commit|file) (.+)$/;
const DRIFT_RE = /^DOCS: drift (\d+) lines in (\d+) files$/;

export class DocsSyncError extends Error {
  constructor(code, reason) {
    super(`${code}: ${reason}`);
    this.name = 'DocsSyncError';
    this.code = code;
    this.reason = reason;
  }
}

// -c core.quotepath=off keeps non-ASCII paths literal; every call is an argument array, never a shell.
function git(root, args) {
  const r = spawnSync('git', ['-c', 'core.quotepath=off', ...args], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
}
const nulList = (text) => text.split('\0').filter(Boolean);

// Guard 5's matcher, verbatim: tests/scripts/docs-sync.test.js pins the two texts equal.
function globToRegExp(glob) {
  const body = glob.split(/(\*\*\/|\*\*|\*)/).map((part) => {
    if (part === '**/') return '(?:.*/)?';
    if (part === '**') return '.*';
    if (part === '*') return '[^/]*';
    return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('');
  return new RegExp(`^${body}$`);
}

// ---- the documentation surface (C4) ----

function staticDir(glob) {
  const parts = glob.split('/');
  const at = parts.findIndex((part) => part.includes('*'));
  return (at === -1 ? parts.slice(0, -1) : parts.slice(0, at)).join('/');
}
const isInside = (path, dir) => dir !== '' && (path === dir || path.startsWith(`${dir}/`));

function dropFolder(glob, folders) {
  const dir = staticDir(glob);
  const recurses = glob.includes('**');
  return folders.find((folder) => folder === dir || isInside(dir, folder) || (recurses && isInside(folder, dir)));
}

export function surfaceSplit(tracked, folders) {
  const scope = [];
  const dropped = [];
  for (const glob of DOC_SURFACE) {
    const re = globToRegExp(glob);
    if (!tracked.some((path) => re.test(path))) continue;
    const folder = dropFolder(glob, folders);
    if (folder === undefined) scope.push(glob);
    else dropped.push({ glob, folder });
  }
  return { scope, dropped };
}

function listFailure(root, rev) {
  if (git(root, ['rev-parse', '--is-inside-work-tree']).status !== 0) {
    throw new DocsSyncError('DOCS_NOT_A_REPO', `${root} is not inside a git work tree`);
  }
  throw new DocsSyncError('DOCS_REF_UNKNOWN', `${rev} names no commit`);
}

// Tracked means a blob of the release tree; a submodule entry is not a file.
function trackedBlobs(root, rev) {
  const r = git(root, ['ls-tree', '-r', '-z', rev]);
  if (r.status !== 0) listFailure(root, rev);
  const blobs = new Map();
  for (const entry of nulList(r.out)) {
    const tab = entry.indexOf('\t');
    const [, type, sha] = entry.slice(0, tab).split(' ');
    if (tab !== -1 && type === 'blob') blobs.set(entry.slice(tab + 1), sha);
  }
  return blobs;
}

export function surfaceReport(root, rev) {
  const tracked = [...trackedBlobs(root, rev).keys()];
  const { specs, plans } = resolveDocLocations(root, null);
  const report = surfaceSplit(tracked, [specs, plans]);
  if (report.scope.length > 0) return report;
  throw new DocsSyncError('DOCS_NO_SURFACE', `no tracked file at ${rev} matches the documentation surface [${DOC_SURFACE.join(', ')}]`);
}

export const docSurface = (root, rev = 'HEAD') => surfaceReport(root, rev).scope;

// ---- arguments and the release range (C2, C3, C12) ----

function parseArgs(argv) {
  const [verb, flag, release, flag2, since, ...extra] = argv;
  const sinceShape = flag2 === undefined ? since === undefined : flag2 === '--since' && since !== undefined;
  const shaped = ['digest', 'check'].includes(verb) && flag === '--release' && release !== undefined && extra.length === 0 && sinceShape;
  const refs = [release, since].filter((ref) => ref !== undefined);
  if (!shaped || refs.some((ref) => ref === '' || ref.startsWith('-'))) throw new DocsSyncError('DOCS_USAGE', USAGE);
  return { verb, release, since };
}

function repoRoot(cwd) {
  const r = git(cwd, ['rev-parse', '--show-toplevel']);
  if (r.status !== 0) throw new DocsSyncError('DOCS_NOT_A_REPO', `${cwd} is not inside a git work tree`);
  return r.out.trim();
}

function commitOf(root, ref) {
  const r = git(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  if (r.status !== 0) throw new DocsSyncError('DOCS_REF_UNKNOWN', `${ref} names no commit`);
  return r.out.trim();
}

function assertAtRelease(root, release, releaseSha) {
  const head = git(root, ['rev-parse', 'HEAD']);
  const headSha = head.status === 0 ? head.out.trim() : '';
  if (headSha === releaseSha) return;
  throw new DocsSyncError('DOCS_NOT_AT_RELEASE', `HEAD is ${headSha}, not ${release} (${releaseSha}); check out the release with: git checkout ${release}`);
}

// A rename entry carries its origin path as a second record, which is not another dirty path.
function dirtyPaths(root) {
  const entries = nulList(git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']).out);
  const paths = [];
  for (let i = 0; i < entries.length; i += 1) {
    paths.push(entries[i].slice(3));
    if (/^[RC]/.test(entries[i])) i += 1;
  }
  return paths;
}

function assertClean(root) {
  const paths = dirtyPaths(root);
  if (paths.length === 0) return;
  throw new DocsSyncError('DOCS_TREE_DIRTY', [
    `the work tree is not the release; ${paths.length} modified or untracked paths:`, ...paths,
    "keep a file that must stay local out of git's view with a line in .git/info/exclude, or set it aside with git stash push --include-untracked, then run the command again",
  ].join('\n'));
}

function previousRelease(root, releaseSha, release) {
  const d = git(root, ['describe', '--tags', '--abbrev=0', `${releaseSha}^`]);
  if (d.status !== 0) throw new DocsSyncError('DOCS_NO_PREVIOUS_RELEASE', `no tag before ${release}; name the range start with --since <ref>`);
  const ref = d.out.trim();
  return { ref, sha: commitOf(root, ref) };
}

function assertAncestor(root, since, release, releaseSha) {
  if (git(root, ['merge-base', '--is-ancestor', since.sha, releaseSha]).status === 0) return;
  throw new DocsSyncError('DOCS_SINCE_NOT_ANCESTOR', `${since.ref} is not an ancestor of ${release}`);
}

// Refusal order is the spec's: refs, release checkout, cleanliness (digest only), range start, ancestry, size.
function resolveRange(root, { release, since: sinceRef }, { clean }) {
  const releaseSha = commitOf(root, release);
  const given = sinceRef === undefined ? null : { ref: sinceRef, sha: commitOf(root, sinceRef) };
  assertAtRelease(root, release, releaseSha);
  if (clean) assertClean(root);
  const since = given ?? previousRelease(root, releaseSha, release);
  assertAncestor(root, since, release, releaseSha);
  const shas = git(root, ['rev-list', '--reverse', `${since.sha}..${releaseSha}`]).out.split('\n').filter(Boolean);
  if (shas.length > RANGE_MAX) {
    throw new DocsSyncError('DOCS_RANGE_TOO_LARGE', `${since.ref}..${release} holds ${shas.length} commits; the cap is ${RANGE_MAX}; narrow it with --since <ref>`);
  }
  return { release, releaseSha, since: since.ref, sinceSha: since.sha, shas };
}

// ---- digest ----

function rangeCommits(root, range) {
  const log = git(root, ['log', '--reverse', '--no-show-signature', '--format=%H%x09%s', `${range.sinceSha}..${range.releaseSha}`]);
  return log.out.split('\n').filter(Boolean).map((row) => `COMMIT ${row.replace('\t', ' ')}`);
}

function changedPaths(root, range) {
  const tokens = nulList(git(root, ['diff', '--name-status', '--no-renames', '-z', range.sinceSha, range.releaseSha]).out);
  const rows = [];
  for (let i = 0; i + 1 < tokens.length; i += 2) rows.push({ status: tokens[i], path: tokens[i + 1] });
  return rows;
}

function digest(root, opts) {
  const range = resolveRange(root, opts, { clean: true });
  const { scope, dropped } = surfaceReport(root, range.release);
  const changed = changedPaths(root, range);
  const onSurface = scope.map(globToRegExp);
  return [
    `RELEASE ${range.release} ${range.releaseSha} SINCE ${range.since} ${range.sinceSha}`,
    ...scope.map((glob) => `SURFACE ${glob}`),
    ...dropped.map((drop) => `SURFACE-DROPPED ${drop.glob} ${drop.folder}`),
    ...rangeCommits(root, range),
    ...changed.map((row) => `CHANGED ${row.status} ${row.path}`),
    ...changed.filter((row) => onSurface.some((re) => re.test(row.path))).map((row) => `DOCS-TOUCHED ${row.path}`),
  ];
}

// ---- the work-tree diff (C7) ----

function hunkLines(diffText, path) {
  const rows = [];
  let oldN = 0;
  let newN = 0;
  let inHunk = false;
  for (const line of diffText.split('\n')) {
    const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (header) {
      [oldN, newN, inHunk] = [Number(header[1]), Number(header[2]), true];
      continue;
    }
    if (!inHunk || (line[0] !== '-' && line[0] !== '+')) continue;
    const side = line[0];
    rows.push({ path, side, n: side === '-' ? oldN++ : newN++, blank: line.slice(1).trim() === '' });
  }
  return rows;
}

// An untracked file is wholly added, so every line is a `+` line.
function fileLines(root, path) {
  let text;
  try { text = readFileSync(join(root, path), 'utf8'); } catch { return []; }
  const rows = text.split('\n');
  if (rows.at(-1) === '') rows.pop();
  return rows.map((row, i) => ({ path, side: '+', n: i + 1, blank: row.trim() === '' }));
}

function workTreeChanges(root, releaseSha) {
  const tracked = nulList(git(root, ['diff', '--name-only', '--no-renames', '-z', releaseSha]).out);
  const untracked = nulList(git(root, ['ls-files', '--others', '--exclude-standard', '-z']).out);
  const lines = [];
  for (const path of tracked) {
    const diff = git(root, ['diff', '--unified=0', '--no-renames', '--no-color', '--no-ext-diff', releaseSha, '--', path]);
    lines.push(...hunkLines(diff.out, path));
  }
  for (const path of untracked) lines.push(...fileLines(root, path));
  return { paths: [...tracked, ...untracked], lines };
}

const keyOf = (line) => `${line.path}:${line.side}${line.n}`;

// ---- the report and its citations (C8) ----

function parseReport(text) {
  const lines = text.split('\n').map((line) => line.replace(/\r$/, ''));
  return { docs: lines.filter((line) => line.startsWith('DOCS:')), cites: lines.filter((line) => line.startsWith('CITE ')) };
}

export function matchCommit(prefix, shas) {
  const hits = shas.filter((sha) => sha.startsWith(prefix.toLowerCase()));
  return hits.length > 1 ? 'ambiguous' : hits[0] ?? null;
}

function blobLineCount(root, releaseSha, path) {
  const text = git(root, ['cat-file', 'blob', `${releaseSha}:${path}`]).out;
  const newlines = text.split('\n').length - 1;
  return text === '' || text.endsWith('\n') ? newlines : newlines + 1;
}

function commitProblem(prefix, ctx) {
  if (!/^[0-9a-fA-F]{7,40}$/.test(prefix)) return MALFORMED;
  const hit = matchCommit(prefix, ctx.shas);
  if (hit === 'ambiguous') return `commit ${prefix} is ambiguous in ${ctx.since}..${ctx.release}`;
  return hit ? null : `commit ${prefix} is not a commit of ${ctx.since}..${ctx.release}`;
}

// A cited path that matches the scope is documentation: a doc citing a doc traces to no source.
function fileProblem(target, ctx) {
  const [, path, line] = /^(.+?)(?::([1-9][0-9]*))?$/.exec(target);
  if (ctx.scopeRes.some((re) => re.test(path))) return `file ${path} is documentation, not evidence`;
  if (!ctx.blobs.has(path)) return `file ${path} is not tracked at ${ctx.release}`;
  const count = blobLineCount(ctx.root, ctx.releaseSha, path);
  return line && Number(line) > count ? `file ${path} has ${count} lines at ${ctx.release}` : null;
}

function citeProblem(cite, ctx) {
  return cite.kind === 'commit' ? commitProblem(cite.target, ctx) : fileProblem(cite.target, ctx);
}

function parseCite(raw) {
  const m = CITE_RE.exec(raw);
  return m && { raw, key: `${m[1]}:${m[2]}${m[3]}`, kind: m[4], target: m[5] };
}

function citeFailures(cites, changedKeys, ctx) {
  const parsed = cites.map((raw) => ({ raw, cite: parseCite(raw) }));
  const invalid = [];
  const covered = new Set();
  for (const { raw, cite } of parsed) {
    const why = cite ? citeProblem(cite, ctx) : MALFORMED;
    if (why) invalid.push({ code: 'DOCS_CITE_INVALID', detail: `${raw}: ${why}` });
    else covered.add(cite.key);
  }
  const uncited = changedKeys.filter((key) => !covered.has(key)).map((key) => ({ code: 'DOCS_UNCITED', detail: `${key} has no CITE line` }));
  const unmatched = parsed.filter(({ cite }) => cite && !changedKeys.includes(cite.key))
    .map(({ cite }) => ({ code: 'DOCS_CITE_UNMATCHED', detail: `${cite.key} is not a changed line` }));
  return [...invalid, ...uncited, ...unmatched];
}

// ---- scope, managed block and result judgments (C4, C5) ----

function managedBlock(lines) {
  const strip = (line) => line.replace(/\r$/, '');
  const start = lines.findIndex((line) => strip(line) === MANAGED_START);
  if (start === -1) return null;
  const end = lines.findIndex((line, i) => i > start && strip(line) === MANAGED_END);
  return end === -1 ? null : { start: start + 1, end: end + 1 };
}

function scopeFailures(paths, ctx) {
  return paths.filter((path) => !ctx.scopeRes.some((re) => re.test(path)))
    .map((path) => ({ code: 'DOCS_OUT_OF_SCOPE', detail: `${path} is outside the documentation surface [${ctx.scope.join(', ')}]` }));
}

function managedFailures(root, ctx, lines) {
  const mine = lines.filter((line) => line.path === MANAGED_FILE);
  if (mine.length === 0) return [];
  const old = git(root, ['show', `${ctx.releaseSha}:${MANAGED_FILE}`]);
  let current = '';
  try { current = readFileSync(join(root, MANAGED_FILE), 'utf8'); } catch { /* deleted: no block on the new side */ }
  const blocks = { '-': managedBlock(old.status === 0 ? old.out.split('\n') : []), '+': managedBlock(current.split('\n')) };
  const inside = (line) => blocks[line.side] && line.n > blocks[line.side].start && line.n < blocks[line.side].end;
  return mine.filter((line) => !inside(line))
    .map((line) => ({ code: 'DOCS_OUTSIDE_MANAGED', detail: `${keyOf(line)} is outside the managed block of ${MANAGED_FILE}` }));
}

function resultFailures(docs, changes) {
  const counted = changes.lines.filter((line) => !line.blank);
  const files = new Set(counted.map((line) => line.path)).size;
  const actual = `the diff changes ${counted.length} lines in ${files} files`;
  if (docs.length !== 1) {
    return [{ code: 'DOCS_RESULT_MISSING', detail: docs.length === 0 ? 'the report has no DOCS: line' : `the report has ${docs.length} DOCS: lines` }];
  }
  const value = docs[0].slice('DOCS: '.length);
  if (docs[0] === 'DOCS: no drift found') {
    return changes.paths.length === 0 ? [] : [{ code: 'DOCS_RESULT_INCONSISTENT', detail: `the report says "${value}" but ${actual}` }];
  }
  const drift = DRIFT_RE.exec(docs[0]);
  if (!drift) return [{ code: 'DOCS_RESULT_MISSING', detail: 'the DOCS: line is neither "no drift found" nor "drift <n> lines in <m> files"' }];
  const same = Number(drift[1]) === counted.length && Number(drift[2]) === files;
  return same ? [] : [{ code: 'DOCS_RESULT_INCONSISTENT', detail: `the report says "${value}" but ${actual}` }];
}

function judge(root, opts, readReport) {
  const range = resolveRange(root, opts, { clean: false });
  const { scope } = surfaceReport(root, range.release);
  const ctx = { ...range, root, scope, scopeRes: scope.map(globToRegExp), blobs: trackedBlobs(root, range.release) };
  const changes = workTreeChanges(root, range.releaseSha);
  const report = parseReport(readReport());
  const changedKeys = changes.lines.filter((line) => !line.blank).map(keyOf);
  const failures = [
    ...scopeFailures(changes.paths, ctx),
    ...managedFailures(root, ctx, changes.lines),
    ...citeFailures(report.cites, changedKeys, ctx),
    ...resultFailures(report.docs, changes),
  ];
  return { failures, value: report.docs[0]?.slice('DOCS: '.length) };
}

export function cli(argv, cwd = process.cwd(), readReport = () => readFileSync(0, 'utf8')) {
  try {
    const opts = parseArgs(argv);
    const root = repoRoot(cwd);
    if (opts.verb === 'digest') {
      process.stdout.write(`${digest(root, opts).join('\n')}\n`);
      return 0;
    }
    const { failures, value } = judge(root, opts, readReport);
    if (failures.length === 0) process.stdout.write(`docs-sync: ok ${value}\n`);
    for (const f of failures) process.stdout.write(`docs-sync: ${f.code}: ${f.detail}\n`);
    return failures.length === 0 ? 0 : 1;
  } catch (e) {
    if (!(e instanceof DocsSyncError || e instanceof DocLocationError)) throw e;
    process.stderr.write(`docs-sync: ${e.code}: ${e.reason}\n`);
    return 2;
  }
}

function invokedDirectly() {
  try { return Boolean(process.argv[1]) && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url; } catch { return false; }
}
if (invokedDirectly()) process.exitCode = cli(process.argv.slice(2));
