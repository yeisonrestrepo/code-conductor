// The fake gh (FEAT-031 T1). It serves the few gh calls ticket.mjs makes from a JSON state
// file, logs every argv, and persists what a POST or a close changes, so a re-run sees it.
// Shapes follow the measured gh 2.100.0: a 404 exits 1 with "gh: Not Found (HTTP 404)", no
// auth exits 4, and --paginate --slurp prints an array of page arrays.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

const STATE = process.env.FAKE_GH_STATE;
const argv = process.argv.slice(2);
appendFileSync(process.env.FAKE_GH_LOG, JSON.stringify(argv) + '\n');
const state = JSON.parse(readFileSync(STATE, 'utf8'));

// Synchronous writes: process.exit after an async stdout write truncates a pipe at 64 KiB,
// and an over-cap body is larger than that.
function finish(status, out = '', err = '') {
  writeFileSync(STATE, JSON.stringify(state));
  if (out) writeFileSync(1, out);
  if (err) writeFileSync(2, err);
  process.exit(status);
}
const notFound = () => finish(1, '', 'gh: Not Found (HTTP 404)\n');
const key = (repo, n) => Object.keys(state.issues).find((k) => k.toLowerCase() === `${repo}#${n}`.toLowerCase());

function parseApi(args) {
  const opts = { method: 'GET', paginate: false, slurp: false, fields: {}, endpoint: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-X') opts.method = args[++i];
    else if (args[i] === '--paginate') opts.paginate = true;
    else if (args[i] === '--slurp') opts.slurp = true;
    else if (args[i] === '-F') { const [k, ...v] = args[++i].split('='); opts.fields[k] = v.join('='); }
    else opts.endpoint = args[i];
  }
  return opts;
}

function comments(k, opts) {
  const all = state.comments[k] ?? [];
  const size = state.pageSize ?? 100;
  const pages = [];
  for (let i = 0; i < all.length || pages.length === 0; i += size) pages.push(all.slice(i, i + size));
  if (!opts.paginate) return finish(0, JSON.stringify(pages[0]));
  return finish(0, opts.slurp ? JSON.stringify(pages) : pages.map((p) => JSON.stringify(p)).join(''));
}

function api(args) {
  const opts = parseApi(args);
  if (opts.endpoint.includes('{owner}/{repo}')) {
    if (!state.cwdRepo) return finish(1, '', 'unable to expand placeholder in path: failed to run git: fatal: not a git repository\n');
    opts.endpoint = opts.endpoint.replace('{owner}/{repo}', state.cwdRepo);
  }
  if (opts.endpoint === 'user') return finish(0, JSON.stringify({ login: state.login }));
  const m = opts.endpoint.match(/^repos\/([^/]+\/[^/]+)\/issues\/(\d+)(\/comments)?$/);
  const k = m && key(m[1], m[2]);
  if (!k) return notFound();
  if (!m[3]) return finish(0, JSON.stringify(state.issues[k]));
  if (opts.method === 'GET') return comments(k, opts);
  const body = readFileSync(opts.fields.body.slice(1), 'utf8');
  (state.comments[k] ??= []).push({ user: { login: state.login }, body });
  return finish(0, JSON.stringify({ body }));
}

function close([, n, , repo]) {
  const k = key(repo, n);
  if (!k) return notFound();
  if (state.failClose) return finish(1, '', 'GraphQL: Could not close the issue (closeIssue)\n');
  state.issues[k].state = 'closed';
  return finish(0);
}

if (state.unauthenticated) finish(4, '', 'To get started with GitHub CLI, please run:  gh auth login\nAlternatively, populate the GH_TOKEN environment variable with a GitHub API authentication token.\n');
else if (argv[0] === 'api') api(argv.slice(1));
else if (argv[0] === 'issue' && argv[1] === 'close') close(argv.slice(1));
else finish(2, '', `fake gh: unsupported ${JSON.stringify(argv)}\n`);
