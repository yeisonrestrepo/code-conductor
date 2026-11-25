// scripts/release.mjs
// The Ship band's release driver (FEAT-035). Every fact about how a project releases comes from its committed
// release profile; this file holds none. init proposes the profile; digest, check and handoff prove the tree,
// judge the release role's diff and print the owner's handoff steps. It spawns only git and the profile's checks,
// never fetches, tags, pushes or publishes, and has no top-level side effect: orchestrate.mjs imports it.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, win32 } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { V3_CAPS, elementLength } from './snap-contract.mjs';
import { WRITEBACK_CHANGELOG_MAX_BYTES } from './ticket.mjs';
// BUG-090 D8: orchestrate.mjs imports this module too, so the two form a cycle; use isControlPlanePath only inside a function.
import { isControlPlanePath } from './orchestrate.mjs';

export const PROFILE_PATH = '.claude/release-profile.json';
const PROPOSAL_PATH = '.conductor/release/profile.proposed.json';
const USAGE = 'usage: release.mjs init [--confirm] | digest --version <v> [--items <IDs>] [--date <YYYY-MM-DD>] | check --version <v> [--items <IDs>] [--date <YYYY-MM-DD>] | handoff --version <v> [--pr <N|url>]';
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const PLAIN_SEMVER = /^\d+\.\d+\.\d+$/;
const COMMIT_CAP = 200;

export class ReleaseError extends Error {
  constructor(code, reason) {
    super(`${code}: ${reason}`);
    this.code = code;
    this.reason = reason;
  }
}
const fail = (code, reason) => { throw new ReleaseError(code, reason); };
const invalid = (field, reason) => fail('RELEASE_PROFILE_INVALID', `${field}: ${reason}`);
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// ---- git and text helpers ----

function git(root, args) {
  const r = spawnSync('git', ['-c', 'core.quotepath=off', ...args], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
}

function headText(root, path) {
  const r = git(root, ['show', `HEAD:./${path}`]);
  return r.status === 0 ? r.out : null;
}

// One trailing \r is dropped per line and the final newline is not a line, so a CRLF checkout cannot fail a judgment.
export function lines(text) {
  const all = text.split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
  if (all.length > 0 && all[all.length - 1] === '') all.pop();
  return all;
}

const endsWithNewline = (text) => text.endsWith('\n');
const workText = (root, path) => { try { return readFileSync(join(root, path), 'utf8'); } catch { return null; } };

// ---- templates ----

const PLACEHOLDER = /\{([a-z]+)\}/g;
const KNOWN = ['version', 'date', 'id', 'title', 'tag', 'notes', 'sha'];
const placeholders = (text) => [...text.matchAll(PLACEHOLDER)].map((m) => m[1]);

// allowed: names that may appear; limits: name -> [min, max] occurrences (default [0, 1]).
function checkTemplate(field, text, allowed, limits = {}) {
  if (typeof text !== 'string' || text === '') invalid(field, 'must be a non-empty template string');
  const names = placeholders(text);
  for (const n of names) {
    if (!KNOWN.includes(n)) invalid(field, `unknown placeholder {${n}}`);
    if (!allowed.includes(n)) invalid(field, `placeholder {${n}} is not allowed here`);
  }
  for (const n of allowed) {
    const [min, max] = limits[n] ?? [0, 1];
    const count = names.filter((x) => x === n).length;
    if (count < min) invalid(field, `placeholder {${n}} is required`);
    if (count > max) invalid(field, `placeholder {${n}} may appear at most ${max === 1 ? 'once' : `${max} times`}`);
  }
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const CAPTURE = { version: '(\\d+\\.\\d+\\.\\d+)', date: '(\\d{4}-\\d{2}-\\d{2})', id: '([A-Za-z0-9._-]+)', title: '(.+)' };

export function render(template, values) {
  return template.replace(PLACEHOLDER, (whole, name) => (values[name] === undefined ? whole : values[name]));
}

// Compiles a template to a regular expression; a placeholder in `fixed` matches its literal value, every other one
// captures. anchorEnd = false leaves the end open, for the claim token at the start of a bullet.
export function compile(template, fixed = {}, anchorEnd = true) {
  const names = [];
  let source = '';
  let last = 0;
  for (const m of template.matchAll(PLACEHOLDER)) {
    source += escapeRegExp(template.slice(last, m.index));
    last = m.index + m[0].length;
    if (fixed[m[1]] !== undefined) { source += escapeRegExp(fixed[m[1]]); continue; }
    names.push(m[1]);
    source += CAPTURE[m[1]];
  }
  source += escapeRegExp(template.slice(last));
  return { re: new RegExp(`^${source}${anchorEnd ? '$' : ''}`), source, names };
}

function parseLine(compiled, line) {
  const m = compiled.re.exec(line);
  if (!m) return null;
  return Object.fromEntries(compiled.names.map((n, i) => [n, m[i + 1]]));
}

// ---- the profile validator ----

const at = (field, key) => (field === '' ? key : `${field}.${key}`);

function checkKeys(field, obj, required, optional = []) {
  if (!isObject(obj)) invalid(field || 'profile', 'not a JSON object');
  for (const k of Object.keys(obj)) {
    if (![...required, ...optional].includes(k)) invalid(at(field, k), 'unknown key');
  }
  for (const k of required) {
    if (!(k in obj)) invalid(at(field, k), 'is required');
  }
}

function checkPath(field, path) {
  if (typeof path !== 'string' || path === '') invalid(field, 'must be a non-empty path');
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path) || path.includes('\\')) invalid(field, `${path} must be relative, with / separators`);
  if (path.includes('..')) invalid(field, `${path} must not contain ..`);
  if (/[*?[\]{}]/.test(path)) invalid(field, `${path} must not contain a glob character`);
  if (path.split('/').some((s) => s === '' || s === '.' || s === '.git')) invalid(field, `${path} has an empty, . or .git segment`);
  if (path === PROFILE_PATH) invalid(field, 'the release profile is never on its own surface');
}

function checkLocation(field, entry) {
  checkKeys(field, entry, ['path'], ['json', 'line']);
  checkPath(at(field, 'path'), entry.path);
  if (('json' in entry) === ('line' in entry)) invalid(field, 'exactly one of json or line is required');
  if ('line' in entry) return checkTemplate(at(field, 'line'), entry.line, ['version'], { version: [1, 1] });
  const keys = entry.json;
  if (!Array.isArray(keys) || keys.length === 0 || keys.some((k) => typeof k !== 'string')) invalid(at(field, 'json'), 'must be a non-empty array of strings');
}

function checkVersions(list) {
  if (!Array.isArray(list) || list.length === 0) invalid('versions', 'must be a non-empty array');
  list.forEach((entry, i) => checkLocation(`versions[${i}]`, entry));
  const linePaths = list.filter((e) => 'line' in e).map((e) => e.path);
  const sharing = list.filter((e) => linePaths.includes(e.path));
  if (sharing.length !== linePaths.length) invalid('versions', 'a path holds either json entries or one line entry');
  if (new Set(linePaths).size !== linePaths.length) invalid('versions', 'a path holds either json entries or one line entry');
}

function checkChangelog(changelog) {
  if (changelog === null) return;
  checkKeys('changelog', changelog, ['path', 'heading']);
  checkPath('changelog.path', changelog.path);
  checkTemplate('changelog.heading', changelog.heading, ['version', 'date'], { version: [1, 1] });
}

function checkChecks(list) {
  if (!Array.isArray(list) || list.length === 0) invalid('checks', 'must be a non-empty array');
  const seen = new Set();
  list.forEach((c, i) => {
    const field = `checks[${i}]`;
    checkKeys(field, c, ['name', 'argv']);
    if (typeof c.name !== 'string' || !/^[A-Za-z0-9._-]+$/.test(c.name)) invalid(at(field, 'name'), 'must match [A-Za-z0-9._-]+');
    if (seen.has(c.name)) invalid(at(field, 'name'), `${c.name} is not unique`);
    seen.add(c.name);
    const argv = c.argv;
    if (!Array.isArray(argv) || argv.length === 0 || argv.some((a) => typeof a !== 'string' || a === '' || placeholders(a).length > 0)) {
      invalid(at(field, 'argv'), 'must be a non-empty array of non-empty strings with no placeholder');
    }
  });
}

function checkPublish(publish) {
  if (publish === null) return;
  checkKeys('publish', publish, ['target', 'argv']);
  const target = publish.target;
  if (typeof target !== 'string' || target === '' || /[\r\n]/.test(target) || placeholders(target).length > 0) {
    invalid('publish.target', 'must be a non-empty single-line string with no placeholder');
  }
  if (!Array.isArray(publish.argv) || publish.argv.length === 0) invalid('publish.argv', 'must be a non-empty array');
  const open = Object.fromEntries(['tag', 'version', 'notes', 'sha'].map((n) => [n, [0, Infinity]]));
  publish.argv.forEach((a, i) => checkTemplate(`publish.argv[${i}]`, a, ['tag', 'version', 'notes', 'sha'], open));
}

function checkBacklog(backlog) {
  checkKeys('backlog', backlog, ['path', 'open', 'closed', 'done', 'claim']);
  checkPath('backlog.path', backlog.path);
  const both = { id: [1, 1], title: [1, 1] };
  checkTemplate('backlog.open', backlog.open, ['id', 'title'], both);
  checkTemplate('backlog.closed', backlog.closed, ['id', 'title'], both);
  checkTemplate('backlog.done', backlog.done, ['version', 'date'], { version: [1, 1] });
  checkTemplate('backlog.claim', backlog.claim, ['id'], { id: [1, 1] });
}

function checkDistinctPaths(profile) {
  const taken = new Set(profile.versions.map((v) => v.path));
  for (const [field, path] of [['changelog.path', profile.changelog?.path], ['backlog.path', profile.backlog?.path]]) {
    if (path === undefined) continue;
    if (taken.has(path)) invalid(field, `${path} is already on the surface`);
    taken.add(path);
  }
}

function checkTagAndRefs(profile) {
  checkTemplate('tag', profile.tag, ['version'], { version: [1, 1] });
  if (!/^[A-Za-z0-9._/-]*$/.test(profile.tag.replace(PLACEHOLDER, ''))) invalid('tag', 'literal text must match [A-Za-z0-9._/-]*');
  for (const f of ['remote', 'mainline']) {
    if (typeof profile[f] !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(profile[f])) invalid(f, 'must match [A-Za-z0-9][A-Za-z0-9._/-]*');
  }
}

export function validateProfile(obj) {
  checkKeys('', obj, ['versions', 'changelog', 'tag', 'remote', 'mainline', 'checks', 'publish'], ['backlog', 'ticket']);
  checkVersions(obj.versions);
  checkChangelog(obj.changelog);
  checkTagAndRefs(obj);
  checkChecks(obj.checks);
  checkPublish(obj.publish);
  if ('backlog' in obj) checkBacklog(obj.backlog);
  if ('ticket' in obj) {
    if (!('backlog' in obj)) invalid('ticket', 'needs a backlog binding');
    if (!isObject(obj.ticket) || Object.keys(obj.ticket).join() !== 'writeback' || obj.ticket.writeback !== true) invalid('ticket', 'must be exactly { "writeback": true }');
  }
  checkDistinctPaths(obj);
  releaseSurface(obj);
  return obj;
}

// The release surface (C13): the version paths, then the changelog when there is one, then the backlog when bound.
export function releaseSurface(profile) {
  const paths = [...new Set(profile.versions.map((v) => v.path))];
  if (profile.changelog) paths.push(profile.changelog.path);
  if (profile.backlog) paths.push(profile.backlog.path);
  const [maxCount, maxLength] = V3_CAPS['ops.scope'];
  if (paths.length > maxCount) fail('RELEASE_SURFACE_TOO_WIDE', `${paths.length} paths exceeds ops.scope cap ${maxCount}`);
  const long = paths.find((p) => elementLength(p) > maxLength);
  if (long !== undefined) fail('RELEASE_SURFACE_TOO_WIDE', `${long} exceeds ops.scope cap ${maxLength}`);
  return paths;
}

export function loadProfile(root) {
  if (git(root, ['rev-parse', '--is-inside-work-tree']).status !== 0) fail('RELEASE_NOT_A_REPO', `${root} is not inside a git work tree`);
  const shown = git(root, ['show', `HEAD:./${PROFILE_PATH}`]);
  if (shown.status !== 0) fail('RELEASE_NOT_CONFIGURED', 'no release profile at HEAD; run /cc-release --init');
  let obj = null;
  try { obj = JSON.parse(shown.out); } catch { /* reported below as not an object */ }
  if (!isObject(obj)) invalid('profile', 'not a JSON object');
  const blob = git(root, ['rev-parse', `HEAD:./${PROFILE_PATH}`]).out.trim();
  return { profile: validateProfile(obj), blob };
}

// ---- arguments, root, versions, items ----

function takeValue(argv, i) {
  const value = argv[i + 1];
  if (value === undefined || value.startsWith('-')) fail('RELEASE_USAGE', USAGE);
  return value;
}

export const isRealDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;
const PR_URL = /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/[1-9]\d*$/;

function checkOptionValue(name, value) {
  if (name === '--date' && !isRealDate(value)) fail('RELEASE_USAGE', USAGE);
  if (name === '--pr' && !/^[1-9]\d*$/.test(value) && !PR_URL.test(value)) fail('RELEASE_USAGE', USAGE);
  if (name !== '--items') return;
  const ids = value.split(',');
  if (ids.some((id) => !/^[A-Za-z0-9._-]+$/.test(id)) || new Set(ids).size !== ids.length) fail('RELEASE_USAGE', USAGE);
}

const VERB_OPTIONS = {
  init: ['--confirm'],
  digest: ['--version', '--items', '--date'],
  check: ['--version', '--items', '--date'],
  handoff: ['--version', '--pr'],
};

export function parseCli(argv) {
  const verb = argv[0];
  if (!Object.hasOwn(VERB_OPTIONS, verb)) fail('RELEASE_USAGE', USAGE);
  const given = {};
  for (let i = 1; i < argv.length; i += 1) {
    const name = argv[i];
    if (!VERB_OPTIONS[verb].includes(name) || name in given) fail('RELEASE_USAGE', USAGE);
    if (name === '--confirm') { given[name] = true; continue; }
    given[name] = takeValue(argv, i);
    checkOptionValue(name, given[name]);
    i += 1;
  }
  if (verb !== 'init' && given['--version'] === undefined) fail('RELEASE_USAGE', USAGE);
  return { verb, confirm: Boolean(given['--confirm']), version: given['--version'], items: given['--items']?.split(',') ?? null, date: given['--date'] ?? null, pr: given['--pr'] ?? null };
}

export function repoRoot(cwd) {
  const r = git(cwd, ['rev-parse', '--show-toplevel']);
  if (r.status !== 0 || r.out.trim() === '') fail('RELEASE_NOT_A_REPO', `${cwd} is not inside a git work tree`);
  return r.out.trim();
}

export function compareVersions(a, b) {
  const [x, y] = [a, b].map((v) => v.split('.').map(Number));
  for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

function keyPathValue(obj, keys) {
  return keys.reduce((node, k) => (isObject(node) && Object.hasOwn(node, k) ? node[k] : undefined), obj);
}

function lineLocation(root, entry) {
  const compiled = compile(entry.line);
  const hits = lines(headText(root, entry.path) ?? '').map((text, i) => ({ i, m: parseLine(compiled, text) })).filter((h) => h.m);
  if (hits.length !== 1) fail('RELEASE_PROFILE_AMBIGUOUS', `${entry.path} ${entry.line} matches ${hits.length} lines at HEAD`);
  return { path: entry.path, kind: 'line', template: entry.line, index: hits[0].i, value: hits[0].m.version };
}

function jsonLocation(root, entry) {
  let parsed = null;
  try { parsed = JSON.parse(headText(root, entry.path) ?? ''); } catch { /* reported below */ }
  const value = keyPathValue(parsed, entry.json);
  if (typeof value !== 'string' || !PLAIN_SEMVER.test(value)) {
    fail('RELEASE_PROFILE_AMBIGUOUS', `${entry.path} ${JSON.stringify(entry.json)} holds no MAJOR.MINOR.PATCH version at HEAD`);
  }
  return { path: entry.path, kind: 'json', keys: entry.json, value };
}

// Each location's own HEAD value (C2); agreement between locations is the project's own check, not this driver's.
export function locationValues(root, profile) {
  return profile.versions.map((entry) => ('line' in entry ? lineLocation(root, entry) : jsonLocation(root, entry)));
}

export function itemHeadings(root, profile, ids) {
  const { backlog } = profile;
  const all = lines(headText(root, backlog.path) ?? '');
  return ids.map((id) => {
    const open = compile(backlog.open, { id });
    const closed = compile(backlog.closed, { id });
    const opens = all.map((t, i) => ({ n: i + 1, m: parseLine(open, t) })).filter((h) => h.m);
    const closes = all.map((t, i) => ({ n: i + 1, m: parseLine(closed, t) })).filter((h) => h.m);
    if (opens.length + closes.length === 0) fail('RELEASE_ITEM_UNKNOWN', `${id} has no heading in ${backlog.path}`);
    if (opens.length === 0 && closes.length === 1) fail('RELEASE_ITEM_NOT_OPEN', `${id} is already closed at line ${closes[0].n}`);
    if (opens.length !== 1 || closes.length !== 0) fail('RELEASE_PROFILE_AMBIGUOUS', `${id} has ${opens.length + closes.length} headings in ${backlog.path}`);
    return { id, line: opens[0].n, title: opens[0].m.title };
  });
}

// The 0-based line before which a new changelog entry goes: the first heading at HEAD, else the end.
export function changelogAnchor(headLines, profile) {
  const heading = compile(profile.changelog.heading);
  const found = headLines.findIndex((l) => parseLine(heading, l));
  return found === -1 ? headLines.length : found;
}

export function dirtyPaths(root) {
  const r = git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  const entries = r.out.split('\0').filter(Boolean);
  const paths = [];
  for (let i = 0; i < entries.length; i += 1) {
    paths.push(entries[i].slice(3));
    if (/[RC]/.test(entries[i].slice(0, 2))) i += 1;
  }
  return paths;
}

const today = () => new Date().toISOString().slice(0, 10);

// The refusals digest and check share, in decision 8's order; digest alone also refuses a dirty tree.
export function prepare(root, opts, verb) {
  const { profile, blob } = loadProfile(root);
  if (!SEMVER.test(opts.version)) fail('RELEASE_VERSION_INVALID', `${opts.version}: only MAJOR.MINOR.PATCH is supported`);
  if (opts.items && !profile.backlog) fail('RELEASE_ITEMS_UNBOUND', 'the profile binds no backlog; release without --items');
  if (!opts.items && profile.backlog) fail('RELEASE_USAGE', '--items is required: the profile binds a backlog');
  if (verb === 'digest') refuseDirty(root);
  const locations = locationValues(root, profile);
  const current = locations[0].value;
  if (compareVersions(opts.version, current) <= 0) fail('RELEASE_VERSION_NOT_ADVANCED', `${opts.version} does not advance ${current}`);
  const headings = profile.backlog ? itemHeadings(root, profile, opts.items) : [];
  return { root, profile, blob, version: opts.version, items: opts.items ?? [], date: opts.date ?? today(), locations, current, headings, surface: releaseSurface(profile) };
}

function refuseDirty(root) {
  const dirty = dirtyPaths(root);
  if (dirty.length > 0) fail('RELEASE_TREE_DIRTY', `${dirty.length} modified or untracked paths:\n${dirty.join('\n')}`);
}

// ---- the profile's checks (C6, A1) ----

const DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD';
// cmd.exe metacharacters, escaped the way the widely used cross-spawn package does, written here with no dependency.
const META = /([()\][%!^"`<>&|;, *?])/g;
const NODE_SHIM = /node_modules[\\/]\.bin[\\/][^\\/]+\.cmd$/i;

export function envValue(env, name) {
  const key = Object.keys(env).find((k) => k.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : env[key];
}

export function pathExtensions(env) {
  const own = (envValue(env, 'PATHEXT') ?? '').split(';').filter(Boolean);
  return own.length > 0 ? own : DEFAULT_PATHEXT.split(';');
}

// A bare name is searched on PATH only: the root is never searched, so a committed file cannot shadow a program.
function windowsProgram(argv0, root, env, isFile) {
  const extensions = pathExtensions(env);
  const bases = /[/\\]/.test(argv0)
    ? [win32.resolve(root, argv0)]
    : (envValue(env, 'PATH') ?? '').split(';').filter(Boolean).map((dir) => win32.join(dir.replace(/^"|"$/g, ''), argv0));
  for (const base of bases) {
    const own = extensions.some((e) => base.toLowerCase().endsWith(e.toLowerCase()));
    const candidates = own ? [base] : extensions.map((e) => base + e);
    const found = candidates.find((c) => isFile(c));
    if (found !== undefined) return found;
  }
  return null;
}

const cmdEscape = (text) => text.replace(META, '^$1');

function cmdArgument(arg, twice) {
  const quoted = `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1')}"`;
  const once = cmdEscape(quoted);
  return twice ? cmdEscape(once) : once;
}

export function windowsInvocation(argv, { root, env, isFile }) {
  const program = windowsProgram(argv[0], root, env, isFile);
  if (program === null) return null;
  if (!/\.(cmd|bat)$/i.test(program)) return { file: program, args: argv.slice(1), verbatim: false };
  const twice = NODE_SHIM.test(program);
  const line = [cmdEscape(program), ...argv.slice(1).map((a) => cmdArgument(a, twice))].join(' ');
  return { file: envValue(env, 'ComSpec') ?? 'cmd.exe', args: ['/d', '/s', '/c', `"${line}"`], verbatim: true };
}

const isFile = (p) => existsSync(p) && statSync(p).isFile();

function invocation(root, argv) {
  if (argv[0] === 'node') return { file: process.execPath, args: argv.slice(1), verbatim: false };
  if (process.platform !== 'win32') return { file: argv[0], args: argv.slice(1), verbatim: false };
  return windowsInvocation(argv, { root, env: process.env, isFile });
}

const indent = (text) => lines(text).map((l) => `  ${l}`);

function haltLines(check, rc, detail) {
  return [`release: RELEASE_HALT ${check.name}: exit ${rc}`, ...detail];
}

function spawnCheck(root, check) {
  const call = invocation(root, check.argv);
  if (call === null) {
    const note = `cannot find ${check.argv[0]} on PATH with PATHEXT ${pathExtensions(process.env).join(';')}`;
    return haltLines(check, 127, [`  ${note}`]);
  }
  const r = spawnSync(call.file, call.args, { cwd: root, encoding: 'utf8', shell: false, maxBuffer: 64 * 1024 * 1024, windowsHide: true, windowsVerbatimArguments: call.verbatim });
  if (r.error) return haltLines(check, 127, [`  ${r.error.message}`]);
  if (r.status === 0) return null;
  return haltLines(check, r.status ?? r.signal, [...indent(r.stdout ?? ''), ...indent(r.stderr ?? '')]);
}

// Runs the profile's checks in order and stops at the first red one (E1).
export function runChecks(root, checks) {
  const ok = [];
  for (const check of checks) {
    const halted = spawnCheck(root, check);
    if (halted) return { ok: false, lines: halted };
    ok.push(`CHECK ${check.name} ok`);
  }
  return { ok: true, lines: ok };
}

// ---- the digest ----

export function commitLines(root, profile) {
  const tag = compile(profile.tag);
  const tags = git(root, ['tag', '--list']).out.split('\n').map((t) => ({ t, m: parseLine(tag, t) })).filter((x) => x.m);
  tags.sort((a, b) => compareVersions(b.m.version, a.m.version));
  const range = tags.length > 0 ? `${tags[0].t}..HEAD` : 'HEAD';
  const log = git(root, ['log', '--no-show-signature', '--format=%h%x09%s', '-n', String(COMMIT_CAP), range]);
  const commits = log.out.split('\n').filter(Boolean).map((l) => ({ sha: l.slice(0, l.indexOf('\t')), subject: l.slice(l.indexOf('\t') + 1) }));
  const total = Number(git(root, ['rev-list', '--count', range]).out.trim()) || commits.length;
  return { commits, truncated: Math.max(0, total - commits.length) };
}

function locationLine(root, loc, ctx) {
  if (loc.kind === 'json') return `LOCATION ${loc.path} json ${JSON.stringify(loc.keys)} ${ctx.version}`;
  return `LOCATION ${loc.path} line ${loc.index + 1} ${render(loc.template, { version: ctx.version })}`;
}

function changelogLine(ctx) {
  const { changelog } = ctx.profile;
  if (!changelog) return 'CHANGELOG none';
  const head = lines(headText(ctx.root, changelog.path) ?? '');
  const anchor = changelogAnchor(head, ctx.profile);
  const heading = render(changelog.heading, { version: ctx.version, date: ctx.date });
  return `CHANGELOG ${changelog.path} HEADING ${heading} AT ${anchor === head.length ? 'end' : anchor + 1}`;
}

function itemLines(ctx) {
  const { backlog, changelog } = ctx.profile;
  return ctx.headings.flatMap((h) => [
    `ITEM ${h.id} ${h.line} ${h.title}`,
    `CLOSED ${render(backlog.closed, { id: h.id, title: h.title })}`,
    `DONE ${render(backlog.done, { version: ctx.version, date: ctx.date })}`,
    ...(changelog ? [`CLAIM ${render(backlog.claim, { id: h.id })}`] : []),
  ]);
}

export function digestLines(ctx) {
  const { commits, truncated } = commitLines(ctx.root, ctx.profile);
  return [
    `RELEASE ${ctx.version} FROM ${ctx.current} DATE ${ctx.date}`,
    `PROFILE ${ctx.blob}`,
    ...ctx.surface.map((p) => `SURFACE ${p}`),
    ...ctx.locations.map((l) => locationLine(ctx.root, l, ctx)),
    changelogLine(ctx),
    ...itemLines(ctx),
    ...commits.map((c) => `COMMIT ${c.sha} ${c.subject}`),
    ...(truncated > 0 ? [`COMMITS-TRUNCATED ${truncated}`] : []),
  ];
}

// ---- the judgment (check, C4/C5) ----

export function changedPaths(root) {
  const tracked = git(root, ['diff', '--name-only', '-z', '--no-renames', 'HEAD']).out.split('\0');
  const untracked = git(root, ['ls-files', '--others', '--exclude-standard', '-z']).out.split('\0');
  return [...new Set([...tracked, ...untracked].filter(Boolean))];
}

const shape = (code, why) => `release: ${code}: ${why}`;

function judgeLineFile(ctx, loc) {
  const work = workText(ctx.root, loc.path);
  if (work === null) return 'the file is missing';
  const head = lines(headText(ctx.root, loc.path) ?? '');
  head[loc.index] = render(loc.template, { version: ctx.version });
  const trailing = endsWithNewline(headText(ctx.root, loc.path) ?? '');
  if (endsWithNewline(work) !== trailing || !isDeepStrictEqual(lines(work), head)) return `must equal HEAD with line ${loc.index + 1} reading "${head[loc.index]}"`;
  return null;
}

function judgeJsonFile(ctx, path, locs) {
  const work = workText(ctx.root, path);
  if (work === null) return 'the file is missing';
  let after = null;
  try { after = JSON.parse(work); } catch { return 'is not valid JSON'; }
  const before = JSON.parse(headText(ctx.root, path));
  for (const loc of locs) {
    if (keyPathValue(after, loc.keys) !== ctx.version) return `${JSON.stringify(loc.keys)} must hold ${ctx.version}`;
    setKeyPath(after, loc.keys, loc.value);
  }
  if (!isDeepStrictEqual(after, before)) return 'differs from HEAD in more than its version keys';
  const stat = git(ctx.root, ['diff', '--numstat', 'HEAD', '--', path]).out.trim().split('\t');
  if (Number(stat[0]) !== locs.length || Number(stat[1]) !== locs.length) return `must change exactly ${locs.length} line(s), as one line per version key`;
  return null;
}

function setKeyPath(obj, keys, value) {
  const parent = keyPathValue(obj, keys.slice(0, -1));
  parent[keys[keys.length - 1]] = value;
}

function judgeVersionFiles(ctx) {
  const problems = [];
  for (const path of [...new Set(ctx.locations.map((l) => l.path))]) {
    const locs = ctx.locations.filter((l) => l.path === path);
    const why = locs[0].kind === 'line' ? judgeLineFile(ctx, locs[0]) : judgeJsonFile(ctx, path, locs);
    if (why) problems.push({ path, line: shape('RELEASE_LOCATION_SHAPE', `${path} ${why}`) });
  }
  return problems;
}

// Position-exact on the line arrays: a diff hunk can slide on blank lines, this cannot.
function judgeChangelog(ctx) {
  const { path, heading } = ctx.profile.changelog;
  const work = workText(ctx.root, path);
  if (work === null) return { problem: `${path} is missing`, block: null };
  const headRaw = headText(ctx.root, path) ?? '';
  const [H, W] = [lines(headRaw), lines(work)];
  const a = changelogAnchor(H, ctx.profile);
  const k = W.length - H.length;
  const wanted = render(heading, { version: ctx.version, date: ctx.date });
  const why = [
    [k <= 0, 'the entry adds no lines'],
    [endsWithNewline(work) !== endsWithNewline(headRaw), 'the final newline changed'],
    [!isDeepStrictEqual(W.slice(0, a), H.slice(0, a)), `lines before line ${a + 1} changed`],
    [!isDeepStrictEqual(W.slice(a + k), H.slice(a)), `lines from line ${a + 1} on changed`],
    [W[a] !== wanted, `line ${a + 1} must be "${wanted}"`],
  ].find(([bad]) => bad);
  return why ? { problem: `${path}: ${why[1]}`, block: null } : { problem: null, block: W.slice(a, a + k) };
}

function judgeBacklog(ctx) {
  const { backlog } = ctx.profile;
  const work = workText(ctx.root, backlog.path);
  if (work === null) return `${backlog.path} is missing`;
  const headRaw = headText(ctx.root, backlog.path) ?? '';
  const [H, W] = [lines(headRaw), lines(work)];
  const byLine = new Map(ctx.headings.map((h) => [h.line - 1, h]));
  const donePrefix = render(backlog.done, { version: ctx.version, date: ctx.date });
  let w = 0;
  for (let i = 0; i < H.length; i += 1) {
    const item = byLine.get(i);
    const want = item ? render(backlog.closed, { id: item.id, title: item.title }) : H[i];
    if (W[w] !== want) return `${backlog.path} line ${w + 1} must read "${want}"`;
    w += 1;
    if (item && !W[w]?.startsWith(donePrefix)) return `${backlog.path} line ${w + 1} must start with the DONE text for ${item.id}`;
    if (item) w += 1;
  }
  if (w !== W.length || endsWithNewline(work) !== endsWithNewline(headRaw)) return `${backlog.path} has changes beyond the named items`;
  return null;
}

// Claim bullets of an entry: a bullet whose text starts with the claim template (C5).
export function claimsOf(block, profile) {
  const claim = compile(profile.backlog.claim, {}, false);
  const bullet = new RegExp(`^\\s*[-*]\\s+${claim.source}`);
  return block.map((l) => bullet.exec(l)).filter(Boolean).map((m) => m[1]);
}

export function parseReport(text) {
  return text.split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l)).filter((l) => l.startsWith('RELEASE:'));
}

function judgeReport(ctx, reportText) {
  const found = parseReport(reportText);
  if (found.length === 0) return shape('RELEASE_RESULT_MISSING', 'the report has no RELEASE: line');
  if (found.length > 1) return shape('RELEASE_RESULT_MISSING', `the report has ${found.length} RELEASE: lines`);
  const expected = `RELEASE: ${ctx.version}${ctx.items.length > 0 ? ` items ${ctx.items.join(',')}` : ''}`;
  return found[0] === expected ? null : shape('RELEASE_RESULT_INCONSISTENT', `the report says "${found[0]}" but the release is "${expected}"`);
}

function judgeClaims(ctx, block) {
  const claimed = claimsOf(block, ctx.profile);
  const same = claimed.length === ctx.items.length && ctx.items.every((id) => claimed.includes(id)) && new Set(claimed).size === claimed.length;
  return same ? null : shape('RELEASE_CLAIMS_MISMATCH', `the entry claims [${claimed.join(',')}], --items names [${ctx.items.join(',')}]`);
}

function scopeFailures(ctx, changed) {
  const out = changed.includes(PROFILE_PATH) ? [{ path: PROFILE_PATH, line: shape('RELEASE_PROFILE_CHANGED', `${PROFILE_PATH} differs from HEAD`) }] : [];
  const stray = changed.filter((p) => p !== PROFILE_PATH && !ctx.surface.includes(p)).sort();
  return [...out, ...stray.map((p) => ({ path: p, line: shape('RELEASE_OUT_OF_SCOPE', `${p} is outside the release surface [${ctx.surface.join(', ')}]`) }))];
}

// Every failure, in decision 13's order, and the paths the scope and location failures name (BUG-090); none means the diff is the release.
export function judge(ctx, reportText, changed) {
  const named = [...scopeFailures(ctx, changed), ...judgeVersionFiles(ctx)];
  const failures = named.map((f) => f.line);
  let block = null;
  if (ctx.profile.changelog) {
    const result = judgeChangelog(ctx);
    if (result.problem) failures.push(shape('RELEASE_CHANGELOG_SHAPE', result.problem));
    block = result.block;
  }
  const backlogProblem = ctx.profile.backlog ? judgeBacklog(ctx) : null;
  if (backlogProblem) failures.push(shape('RELEASE_BACKLOG_SHAPE', backlogProblem));
  const claims = block && ctx.profile.backlog ? judgeClaims(ctx, block) : null;
  return { failures: [...failures, ...[claims, judgeReport(ctx, reportText)].filter(Boolean)], rejected: named.map((f) => f.path) };
}

// BUG-090 D4: how git drops each path of the diff: in HEAD, restore it; only in the index, remove it; untracked, delete it.
function diffStates(root) {
  const tracked = git(root, ['diff', '--name-status', '-z', '--no-renames', 'HEAD']);
  const untracked = git(root, ['ls-files', '--others', '--exclude-standard', '-z']);
  if (tracked.status !== 0 || untracked.status !== 0) fail('RELEASE_GIT_FAILED', 'git cannot list the diff against HEAD, so no discard command is printed');
  const states = new Map(untracked.out.split('\0').filter(Boolean).map((p) => [p, 'clean']));
  const fields = tracked.out.split('\0');
  for (let i = 0; i + 1 < fields.length; i += 2) states.set(fields[i + 1], fields[i] === 'A' ? 'rm' : 'checkout');
  return states;
}

const DISCARD_COMMANDS = [['checkout', 'git --literal-pathspecs checkout HEAD --'], ['rm', 'git --literal-pathspecs rm -f --'], ['clean', 'git --literal-pathspecs clean -f --']];
// BUG-090 D6: a control character would split or forge a printed line, and a single quote's POSIX escape is not PowerShell's.
const byHand = (path) => /[\p{Cc}']/u.test(path);
// JSON.stringify leaves DEL and C1 (U+007F-U+009F) raw, and a raw C1 such as U+009B (CSI) can drive a terminal.
const controlEscape = (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`;
const jsonName = (path) => `"${[...path].map((c) => (/\p{Cc}/u.test(c) ? controlEscape(c) : JSON.stringify(c).slice(1, -1))).join('')}"`;
const pathName = (path) => (byHand(path) ? jsonName(path) : path);

// BUG-090: after a rejected judgment, the warning when a rejected path of the diff is control-plane, then the commands
// that drop the whole diff. shellQuote is defined below; it is read only when this runs.
function discardLines(root, rejected) {
  const states = diffStates(root);
  const paths = [...states.keys()].sort();
  const plane = [...new Set(rejected)].filter((p) => states.has(p) && isControlPlanePath(p)).sort();
  const out = plane.length === 0 ? [] : [shape('RELEASE_DISCARD_FIRST', `the rejected diff touches ${plane.map(pathName).join(', ')}, which project tooling reads; discard the whole diff before running any package manager, test, build or hook command`)];
  for (const [state, command] of DISCARD_COMMANDS) {
    const named = paths.filter((p) => states.get(p) === state && !byHand(p));
    if (named.length > 0) out.push(`release: DISCARD ${command} ${named.map(shellQuote).join(' ')}`);
  }
  return [...out, ...paths.filter(byHand).map((p) => `release: DISCARD_BY_HAND ${jsonName(p)}`)];
}

// ---- handoff (D1, E3) ----

const SAFE_ARGUMENT = /^[A-Za-z0-9._/:=@%+,-]+$/;
export const shellQuote = (arg) => (SAFE_ARGUMENT.test(arg) ? arg : `'${arg.replace(/'/g, "'\\''")}'`);
const shellLine = (argv) => argv.map(shellQuote).join(' ');

// The `<v>` section of the changelog at HEAD: after its heading to the next heading or the end, trimmed of blank lines.
export function sectionOf(headLines, profile, version) {
  const heading = compile(profile.changelog.heading, { version });
  const any = compile(profile.changelog.heading);
  const start = headLines.findIndex((l) => parseLine(heading, l));
  if (start === -1) return null;
  const next = headLines.findIndex((l, i) => i > start && parseLine(any, l));
  const body = headLines.slice(start + 1, next === -1 ? undefined : next);
  while (body.length > 0 && body[0].trim() === '') body.shift();
  while (body.length > 0 && body[body.length - 1].trim() === '') body.pop();
  return body;
}

// One claim bullet plus its continuation lines: non-blank, indented, not a bullet.
export function excerptFor(section, id, profile) {
  const claim = compile(profile.backlog.claim, { id }, false);
  const bullet = new RegExp(`^\\s*[-*]\\s+${claim.source}`);
  const parts = [];
  for (let i = 0; i < section.length; i += 1) {
    if (!bullet.test(section[i])) continue;
    const block = [section[i]];
    for (let j = i + 1; j < section.length && /^\s+\S/.test(section[j]) && !/^\s*[-*]\s/.test(section[j]); j += 1) block.push(section[j]);
    parts.push(`${block.join('\n')}\n`);
  }
  return parts.join('');
}

function claimedFromChangelog(ctx, section) {
  const ids = claimsOf(section, ctx.profile);
  return [...new Set(ids)].map((id) => ({ id, excerpt: excerptFor(section, id, ctx.profile) }));
}

function claimedFromBacklog(ctx) {
  const { backlog } = ctx.profile;
  const all = lines(headText(ctx.root, backlog.path) ?? '');
  const closed = compile(backlog.closed);
  const done = compile(backlog.done, { version: ctx.version }, false);
  const claimed = [];
  all.forEach((text, i) => {
    const m = parseLine(closed, text);
    if (m && i + 1 < all.length && done.re.test(all[i + 1])) claimed.push({ id: m.id, excerpt: `${text}\n` });
  });
  return claimed;
}

function notesFromCommits(ctx) {
  const { commits, truncated } = commitLines(ctx.root, ctx.profile);
  const out = commits.map((c) => `- ${c.subject}\n`);
  if (truncated > 0) out.push(`- and ${truncated} earlier commits\n`);
  return out.join('');
}

function refuseUnreleased(ctx) {
  const stale = ctx.locations.find((l) => l.value !== ctx.version);
  if (stale) fail('RELEASE_NOT_RELEASED', `${stale.path} reads ${stale.value} at HEAD, not ${ctx.version}`);
}

function refuseNotOnMain(root, profile) {
  const ref = `refs/remotes/${profile.remote}/${profile.mainline}`;
  const there = git(root, ['rev-parse', '--verify', '--quiet', ref]);
  if (there.status !== 0) fail('RELEASE_NOT_ON_MAIN', `no local ref ${ref}; sync it, then run handoff again`);
  const head = git(root, ['rev-parse', 'HEAD']).out.trim();
  if (there.out.trim() !== head) fail('RELEASE_NOT_ON_MAIN', `HEAD is ${head}, ${ref} is ${there.out.trim()}`);
}

// Everything handoff decides before it runs a check or writes a file (decision 8's order).
export function handoffContext(root, opts) {
  const { profile, blob } = loadProfile(root);
  if (!SEMVER.test(opts.version)) fail('RELEASE_VERSION_INVALID', `${opts.version}: only MAJOR.MINOR.PATCH is supported`);
  refuseDirty(root);
  const locations = locationValues(root, profile);
  const ctx = { root, profile, blob, version: opts.version, locations, surface: releaseSurface(profile), items: [], headings: [] };
  refuseUnreleased(ctx);
  const headLines = profile.changelog ? lines(headText(root, profile.changelog.path) ?? '') : [];
  const section = profile.changelog ? sectionOf(headLines, profile, opts.version) : null;
  if (profile.changelog && section === null) fail('RELEASE_NOT_RELEASED', `${profile.changelog.path} has no ${opts.version} heading at HEAD`);
  refuseNotOnMain(root, profile);
  if (git(root, ['rev-parse', '--verify', '--quiet', `refs/tags/${render(profile.tag, { version: opts.version })}`]).status === 0) {
    fail('RELEASE_TAG_EXISTS', `${render(profile.tag, { version: opts.version })} already exists`);
  }
  return finishHandoff(ctx, opts, section);
}

function finishHandoff(ctx, opts, section) {
  const { profile, root } = ctx;
  const claimed = !profile.backlog || !profile.ticket ? [] : profile.changelog ? claimedFromChangelog(ctx, section) : claimedFromBacklog(ctx);
  const bound = claimed.map((c) => ({ ...c, bound: existsSync(join(root, '.conductor/ticket', `${c.id}.md`)) }));
  if (bound.some((c) => c.bound) && opts.pr === null) fail('RELEASE_USAGE', '--pr is required: a writeback step will print');
  for (const c of bound.filter((x) => x.bound)) {
    const size = Buffer.byteLength(c.excerpt, 'utf8');
    if (size > WRITEBACK_CHANGELOG_MAX_BYTES) fail('RELEASE_EXCERPT_TOO_LARGE', `${c.id}'s excerpt is ${size} bytes; the cap is ${WRITEBACK_CHANGELOG_MAX_BYTES}`);
  }
  const notes = profile.changelog ? `${section.join('\n')}\n` : notesFromCommits(ctx);
  return { ...ctx, pr: opts.pr, claimed: bound, notes, tag: render(profile.tag, { version: ctx.version }), sha: git(root, ['rev-parse', 'HEAD']).out.trim() };
}

function ticketScript(root) {
  return relative(root, join(dirname(fileURLToPath(import.meta.url)), 'ticket.mjs')).replace(/\\/g, '/');
}

export function stepLines(ctx) {
  const { profile } = ctx;
  const dir = `.conductor/release/${ctx.version}`;
  const out = [`STEP 1 tag ${shellLine(['git', 'tag', '-a', ctx.tag, '-m', ctx.tag, ctx.sha])}`, `STEP 2 push ${shellLine(['git', 'push', profile.remote, ctx.tag])}`];
  let n = 2;
  if (profile.publish) {
    const values = { tag: ctx.tag, version: ctx.version, notes: `${dir}/notes.md`, sha: ctx.sha };
    n += 1;
    out.push(`PUBLISH-TARGET ${profile.publish.target}`, `STEP ${n} publish ${shellLine(profile.publish.argv.map((a) => render(a, values)))}`);
  }
  for (const c of ctx.claimed) {
    if (!c.bound) { out.push(`WRITEBACK-NONE ${c.id}`); continue; }
    n += 1;
    const argv = ['node', ticketScript(ctx.root), 'writeback', c.id, '--version', ctx.version, '--pr', ctx.pr, '--changelog', `${dir}/${c.id}.md`];
    out.push(`STEP ${n} writeback ${shellLine(argv)}`);
  }
  return out;
}

export function writeHandoffFiles(ctx) {
  const dir = join(ctx.root, '.conductor/release', ctx.version);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'notes.md'), ctx.notes);
  for (const c of ctx.claimed.filter((x) => x.bound)) writeFileSync(join(dir, `${c.id}.md`), c.excerpt);
}

// ---- init (C14): propose the profile from the project's files ----

const readJson = (root, path) => { try { return JSON.parse(readFileSync(join(root, path), 'utf8')); } catch { return null; } };
const readText = (root, path) => { try { return readFileSync(join(root, path), 'utf8'); } catch { return null; } };

function tomlLocation(root, path) {
  const text = readText(root, path);
  const hits = text === null ? [] : lines(text).map((l) => /^version = "(\d+\.\d+\.\d+)"$/.exec(l)).filter(Boolean);
  return hits.length === 1 ? [{ entry: { path, line: 'version = "{version}"' }, value: hits[0][1] }] : [];
}

function jsonLocations(root) {
  const out = [];
  const pkg = readJson(root, 'package.json');
  if (typeof pkg?.version === 'string' && PLAIN_SEMVER.test(pkg.version)) out.push({ entry: { path: 'package.json', json: ['version'] }, value: pkg.version });
  const lock = readJson(root, 'package-lock.json');
  const nested = lock?.packages?.['']?.version;
  if (lock?.lockfileVersion >= 2 && PLAIN_SEMVER.test(lock.version ?? '') && PLAIN_SEMVER.test(nested ?? '')) {
    out.push({ entry: { path: 'package-lock.json', json: ['version'] }, value: lock.version }, { entry: { path: 'package-lock.json', json: ['packages', '', 'version'] }, value: nested });
  }
  return out;
}

export function detectVersions(root) {
  const plain = readText(root, 'VERSION');
  const found = [
    ...(plain !== null && /^\d+\.\d+\.\d+\r?\n?$/.test(plain) ? [{ entry: { path: 'VERSION', line: '{version}' }, value: plain.trim() }] : []),
    ...jsonLocations(root), ...tomlLocation(root, 'pyproject.toml'), ...tomlLocation(root, 'Cargo.toml'),
  ];
  if (new Set(found.map((f) => f.value)).size > 1) {
    fail('RELEASE_INIT_VERSIONS_DISAGREE', found.map((f) => `${f.entry.path} ${f.value}`).join(', '));
  }
  return { versions: found.map((f) => f.entry), current: found[0]?.value ?? null };
}

export function detectChangelog(root, current) {
  const path = ['CHANGELOG.md', 'CHANGELOG', 'HISTORY.md'].find((p) => existsSync(join(root, p)));
  if (path === undefined) return { value: null, evidence: '(default)' };
  const heading = current === null ? undefined : lines(readText(root, path) ?? '').find((l) => l.startsWith('#') && l.includes(current));
  if (heading === undefined) return { value: { path, heading: '## [{version}] - {date}' }, evidence: '(default)' };
  const templated = heading.replace(current, '{version}').replace(/\d{4}-\d{2}-\d{2}/, '{date}');
  return { value: { path, heading: templated }, evidence: `(from ${path})` };
}

export function detectTag(root, current) {
  const has = (t) => git(root, ['rev-parse', '--verify', '--quiet', `refs/tags/${t}`]).status === 0;
  if (current !== null && has(`v${current}`)) return { value: 'v{version}', evidence: `(from tag v${current})` };
  if (current !== null && has(current)) return { value: '{version}', evidence: `(from tag ${current})` };
  return { value: 'v{version}', evidence: '(default)' };
}

export function detectRemote(root) {
  const remotes = git(root, ['remote']).out.split('\n').filter(Boolean);
  for (const r of remotes) {
    const target = git(root, ['symbolic-ref', '--quiet', `refs/remotes/${r}/HEAD`]);
    const prefix = `refs/remotes/${r}/`;
    if (target.status === 0 && target.out.trim().startsWith(prefix)) return { remote: r, mainline: target.out.trim().slice(prefix.length), evidence: `(from refs/remotes/${r}/HEAD)`, defaulted: false };
  }
  if (remotes.length === 1) return { remote: remotes[0], mainline: 'main', evidence: '(default)', defaulted: true };
  return { remote: 'origin', mainline: 'main', evidence: '(default)', defaulted: true };
}

export function detectChecks(root) {
  const test = readJson(root, 'package.json')?.scripts?.test;
  if (typeof test !== 'string' || test === 'echo "Error: no test specified" && exit 1') return { value: [], evidence: '(default)' };
  return { value: [{ name: 'test', argv: ['npm', 'test'] }], evidence: '(from package.json scripts.test)' };
}

function workflowPublish(root) {
  const dir = join(root, '.github/workflows');
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).sort() : [];
  for (const file of files) {
    const all = lines(readText(root, `.github/workflows/${file}`) ?? '');
    const hit = all.some((l, i) => /^\s*release:\s*$/.test(l) && all.slice(i + 1, i + 4).some((n) => /^\s*types:.*\bpublished\b/.test(n)));
    if (hit) return `.github/workflows/${file}`;
  }
  return null;
}

export function detectPublish(root) {
  const workflow = workflowPublish(root);
  if (workflow !== null) {
    const argv = ['gh', 'release', 'create', '{tag}', '--verify-tag', '--title', '{tag}', '--notes-file', '{notes}'];
    return { value: { target: `the GitHub Release ${workflow} listens for`, argv }, evidence: `(from ${workflow})` };
  }
  const pkg = readJson(root, 'package.json');
  if (pkg !== null && pkg.private !== true) return { value: { target: 'the npm registry', argv: ['npm', 'publish'] }, evidence: '(from package.json)' };
  return { value: null, evidence: '(default)' };
}

// The proposal: [field, value, evidence] rows in profile order.
export function proposal(root) {
  const { versions, current } = detectVersions(root);
  const remote = detectRemote(root);
  const [changelog, tag, checks, publish] = [detectChangelog(root, current), detectTag(root, current), detectChecks(root), detectPublish(root)];
  return [
    ['versions', versions, versions.length > 0 ? `(from ${[...new Set(versions.map((v) => v.path))].join(', ')})` : '(default)'],
    ['changelog', changelog.value, changelog.evidence], ['tag', tag.value, tag.evidence],
    ['remote', remote.remote, remote.evidence], ['mainline', remote.mainline, remote.evidence],
    ['checks', checks.value, checks.evidence], ['publish', publish.value, publish.evidence],
  ];
}

function refuseExistingProfile(root) {
  if (existsSync(join(root, PROFILE_PATH)) || git(root, ['cat-file', '-e', `HEAD:./${PROFILE_PATH}`]).status === 0) {
    fail('RELEASE_PROFILE_EXISTS', `${PROFILE_PATH} exists at HEAD or in the work tree`);
  }
}

function initVerb(root) {
  refuseExistingProfile(root);
  const rows = proposal(root);
  mkdirSync(join(root, '.conductor/release'), { recursive: true });
  writeFileSync(join(root, PROPOSAL_PATH), `${JSON.stringify(Object.fromEntries(rows.map(([k, v]) => [k, v])), null, 2)}\n`);
  const shown = rows.map(([field, value, evidence]) => `PROPOSED ${field} ${JSON.stringify(value)} ${evidence}`);
  return { code: 0, lines: [...shown, `release: proposal written to ${PROPOSAL_PATH}; review it, then run init --confirm`] };
}

function confirmVerb(root) {
  refuseExistingProfile(root);
  const text = readText(root, PROPOSAL_PATH);
  let obj = null;
  try { obj = JSON.parse(text); } catch { /* refused below */ }
  if (text === null || obj === null) invalid('proposal', `${PROPOSAL_PATH} is missing or not JSON; run init first`);
  validateProfile(obj);
  if (git(root, ['check-ignore', '-q', PROFILE_PATH]).status === 0) fail('RELEASE_PROFILE_IGNORED', `${PROFILE_PATH} is ignored by git; it must be committed`);
  mkdirSync(dirname(join(root, PROFILE_PATH)), { recursive: true });
  writeFileSync(join(root, PROFILE_PATH), text);
  return { code: 0, lines: ['release: profile written; commit it before releasing'] };
}

// ---- verbs and the CLI ----

function digestVerb(root, opts) {
  const ctx = prepare(root, opts, 'digest');
  const ran = runChecks(root, ctx.profile.checks);
  return ran.ok ? { code: 0, lines: [...digestLines(ctx), ...ran.lines] } : { code: 1, lines: ran.lines };
}

function checkVerb(root, opts, readReport) {
  const ctx = prepare(root, opts, 'check');
  const { failures, rejected } = judge(ctx, readReport(), changedPaths(root));
  if (failures.length > 0) return { code: 1, lines: [...failures, ...discardLines(root, rejected)] };
  const ran = runChecks(root, ctx.profile.checks);
  const done = `release: ok ${ctx.version}${ctx.items.length > 0 ? ` items ${ctx.items.join(',')}` : ''}`;
  return ran.ok ? { code: 0, lines: [...ran.lines, done] } : { code: 1, lines: ran.lines };
}

function handoffVerb(root, opts) {
  const ctx = handoffContext(root, opts);
  const ran = runChecks(root, ctx.profile.checks);
  if (!ran.ok) return { code: 1, lines: ran.lines };
  writeHandoffFiles(ctx);
  return { code: 0, lines: [...ran.lines, ...stepLines(ctx), `release: handoff ready ${ctx.version}`] };
}

function runVerb(root, opts, readReport) {
  if (opts.verb === 'init') return opts.confirm ? confirmVerb(root) : initVerb(root);
  if (opts.verb === 'digest') return digestVerb(root, opts);
  if (opts.verb === 'check') return checkVerb(root, opts, readReport);
  return handoffVerb(root, opts);
}

export function cli(argv, cwd = process.cwd(), readReport = () => readFileSync(0, 'utf8')) {
  try {
    const opts = parseCli(argv);
    const result = runVerb(repoRoot(cwd), opts, readReport);
    if (result.lines.length > 0) process.stdout.write(`${result.lines.join('\n')}\n`);
    return result.code;
  } catch (e) {
    if (!(e instanceof ReleaseError)) throw e;
    process.stderr.write(`release: ${e.message}\n`);
    return 2;
  }
}

function invokedDirectly() {
  try { return Boolean(process.argv[1]) && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url; } catch { return false; }
}
if (invokedDirectly()) process.exitCode = cli(process.argv.slice(2));
