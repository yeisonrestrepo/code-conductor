#!/usr/bin/env node
// PreToolUse front door. Contract: https://code.claude.com/docs/en/hooks (read 2026-09-25).
// Claude Code writes the payload to stdin as JSON; a decision is returned as
// hookSpecificOutput.permissionDecision and EVERY path exits 0. Nothing here exits 2:
// a deliberate denial must never be indistinguishable from a crashed script.
// Zero dependencies by design; node: builtins only.
import { readFileSync, statSync } from 'node:fs';
import { posix, join } from 'node:path';

const LINE_LIMIT = 150;
const BLOCKED_COMPONENTS = new Set(['graphify-out', 'node_modules']);

let emitted = false;

function debug(msg) {
  if (process.env.CC_HOOK_DEBUG) process.stderr.write(`PRE_TOOL_USE: ${msg}\n`);
}

const deny = (reason) => ({ permissionDecision: 'deny', permissionDecisionReason: reason });
const ask = (reason) => ({ permissionDecision: 'ask', permissionDecisionReason: reason });

function emit(decision) {
  if (emitted) return;
  emitted = true;
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', ...decision },
  }) + '\n');
}

// `wc -l` counts newline characters and the 150-line threshold was calibrated against
// it, so count the same way rather than splitting (which would report one line more).
function countLines(text) {
  let n = 0;
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') n++;
  return n;
}

function isRegularFile(path) {
  try { return statSync(path).isFile(); } catch { return false; }
}

// The platform sends `file_path` for Read/Write/Edit. The bash original read `path`,
// which no tool sends, which is why Guard 2 never fired even where the wiring worked;
// both are accepted so an MCP-provided create_file/write_file keeps working.
function targetPath(input) {
  const raw = input.file_path ?? input.path;
  return typeof raw === 'string' ? raw.trim() : '';
}

function stamp(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Guard 4: reads of graphify-out/ and node_modules/ (BUG-017). Runs before Guard 1 for
// Read: a forbidden path is forbidden whatever its size, and deciding here spares a stat
// and a full file read on a path that is about to be denied anyway.
function guard4BlockedRead(input) {
  const path = targetPath(input);
  if (!path) return null; // Case A: nothing to verify
  const normalized = posix.normalize(path.replace(/\\/g, '/'));
  const parts = normalized.split('/').filter(p => p && p !== '.');
  if (!parts.some(p => BLOCKED_COMPONENTS.has(p.toLowerCase()))) return null;
  return deny(
    'Guard 4: direct reads of graphify-out/ and node_modules/ are forbidden. ' +
    'Use Glob for existence checks or the graphify skill: /graphify query "<question>".'
  );
}

// Guard 1: a large-file Read with no limit. A path that cannot be stat'd has no size to
// exceed the threshold, so it allows.
function guard1LargeRead(input) {
  if (input.limit !== undefined) return null;
  const path = targetPath(input);
  if (!path || !isRegularFile(path)) return null;
  let lines;
  try { lines = countLines(readFileSync(path, 'utf8')); }
  catch (e) { debug(`guard 1 could not read ${path}: ${e.message}`); return null; }
  if (lines <= LINE_LIMIT) return null;
  return deny(
    `Guard 1: LARGE FILE READ BLOCKED. File: ${path}. Lines: ${lines} ` +
    `(>${LINE_LIMIT}, no limit specified). Follow the orchestrator lookup chain: ` +
    '1. Check .claude/memory/project.md  2. Query graphify for structural questions  ' +
    '3. Use Grep/Glob for pattern searches  4. Read with explicit offset + limit.'
  );
}

// Guard 2: writing over a file that already exists. "ask" rather than "deny" because the
// bash original printed a three-option prompt, and the contract's "ask" is that prompt in
// the platform's own vocabulary. Not registered for Edit: a targeted edit is the action
// this guard recommends, so gating it would contradict its own text.
function guard2DuplicateWrite(input) {
  const path = targetPath(input);
  if (!path || !isRegularFile(path)) return null;
  let lines = '?';
  try { lines = countLines(readFileSync(path, 'utf8')); } catch { /* keep '?' */ }
  let modified = 'unknown';
  try { modified = stamp(statSync(path).mtimeMs); } catch { /* keep 'unknown' */ }
  return ask(
    'FILE ALREADY EXISTS\n' +
    `   Path:          ${path}\n` +
    `   Lines:         ${lines}\n` +
    `   Last modified: ${modified}\n\n` +
    '   Choose an action:\n' +
    '   1. Edit the existing file instead of overwriting\n' +
    '   2. Confirm you want to overwrite (re-issue the command)\n' +
    '   3. Cancel'
  );
}

// ── Guard 3 constants ─────────────────────────────────────────────────────────
// POSIX ERE fragments from tests/fixtures/guard3-reference.sh, translated class by
// class. [[:space:]] in the C locale is EXACTLY [ \t\n\r\f\v]; JavaScript \s also
// matches U+00A0, U+2028, U+2029 and U+FEFF, so using it here would widen every
// check below and make the port disagree with its own authority. No \s \S \w \W \d
// \D appears anywhere in this block, and a test asserts that.
const SP = '[ \\t\\n\\r\\f\\v]';
const NSP = '[^ \\t\\n\\r\\f\\v]';
const G3_POS = '(^|[|;{([!&]|`|&&|\\|\\||;;|\\$\\(|<\\(|>\\(|(then|else|elif|do)' + SP + '|!' + SP + ')' + SP + '*';
const G3_MOD = '((env|exec|time|nohup|coproc|command|builtin)(' + SP + '+' + NSP + '+)*' + SP + '+)?';
const G3_PATH = '([A-Za-z0-9_./@%-]*/)?';
const G3_READERS = '(cat|less|more|head|tail|sed|awk|grep|egrep|fgrep|mapfile|readarray)';
const G3_SHELLS = '(sh|bash|dash|zsh|ksh|fish)';
const G3_MAX_LEN = 8192;
const G3_ALLOWLIST_REL = ['.claude', 'memory', 'bash-scan-allowlist.txt'];

const reFind = new RegExp(G3_POS + G3_MOD + G3_PATH + 'find(' + SP + '|$)');
const reCat = new RegExp(G3_POS + G3_MOD + G3_PATH + 'cat(' + SP + '|$)');
const rePager = new RegExp(G3_POS + G3_MOD + G3_PATH + '(less|more|head|tail|sed|awk)(' + SP + '|$)');
const reReader = new RegExp(G3_POS + G3_MOD + G3_PATH + G3_READERS + '(' + SP + '|$)');

// bash's `read -ra` splits on IFS (space, tab, newline), which is NARROWER than
// [[:space:]]. The token walks in P3 and P6 use this, everything else uses SP.
const IFS_SPLIT = /[ \t\n]+/;

// Join line continuations. A line ending in an ODD number of backslashes continues;
// an even number does not. bash's here-string appends a trailing newline, so a
// non-continued line always contributes one, including the last: the preprocessed
// string normally ends in a separator and every ([[:space:]]|$) anchor depends on it.
function g3JoinContinuations(input) {
  let result = '';
  for (const raw of input.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    let bs = 0;
    while (bs < line.length && line[line.length - 1 - bs] === '\\') bs += 1;
    if (bs % 2 === 1) result += line.slice(0, -1) + ' ';
    else result += line + '\n';
  }
  return result;
}

// The five-state scanner, in two modes. "strip" removes unquoted comments and
// reports malformed input (a state other than UNQUOTED at end of input, meaning an
// unclosed quote). "glob" reports whether an unquoted glob character appears, and
// treats malformed input as a glob, which is the authority's fail-closed choice.
function g3Scan(mode, input) {
  let state = 'UNQUOTED';
  let result = '';
  let i = 0;
  const len = input.length;
  while (i < len) {
    const ch = input[i];
    const two = input.slice(i, i + 2);
    if (state === 'UNQUOTED') {
      if (two === "$'") { if (mode === 'strip') result += two; i += 2; state = 'ANSI_C_QUOTED'; }
      else if (two === '$"') { if (mode === 'strip') result += two; i += 2; state = 'LOCALE_QUOTED'; }
      else if (ch === '\\') { if (mode === 'strip') result += input.slice(i, i + 2); i += 2; }
      else if (ch === "'") { if (mode === 'strip') result += ch; i += 1; state = 'SINGLE_QUOTED'; }
      else if (ch === '"') { if (mode === 'strip') result += ch; i += 1; state = 'DOUBLE_QUOTED'; }
      else if (ch === '#' && mode === 'strip') { while (i < len && input[i] !== '\n') i += 1; }
      else {
        if (mode === 'glob' && (ch === '*' || ch === '?' || ch === '{' || ch === '[')) return { glob: true };
        if (mode === 'strip') result += ch;
        i += 1;
      }
    } else if (state === 'SINGLE_QUOTED') {
      // Backslash is literal here and ANY quote exits: there is no escape mechanism.
      if (mode === 'strip') result += ch;
      if (ch === "'") state = 'UNQUOTED';
      i += 1;
    } else if (state === 'DOUBLE_QUOTED' || state === 'LOCALE_QUOTED') {
      if (ch === '\\') { if (mode === 'strip') result += input.slice(i, i + 2); i += 2; }
      else if (ch === '"') { if (mode === 'strip') result += ch; i += 1; state = 'UNQUOTED'; }
      else { if (mode === 'strip') result += ch; i += 1; }
    } else {
      if (ch === '\\') { if (mode === 'strip') result += input.slice(i, i + 2); i += 2; }
      else if (ch === "'") { if (mode === 'strip') result += ch; i += 1; state = 'UNQUOTED'; }
      else { if (mode === 'strip') result += ch; i += 1; }
    }
  }
  if (state !== 'UNQUOTED') return mode === 'strip' ? { result, malformed: true } : { glob: true };
  return mode === 'strip' ? { result, malformed: false } : { glob: false };
}

// Each check returns true when it FIRES (the authority's shell functions returned 1).
//
// A quirk worth naming, because it looks like a bug and is not: the authority walks
// with `after="${rest:mlen}"`, slicing by the match LENGTH from position 0 rather
// than from the match index. For `ls; cat *.ts` the match is `; cat ` and bash's
// `after` is `at *.ts`, not `*.ts`. P4 and P7 reproduce that exactly. "Fixing" it
// would make the port disagree with the corpus.

function g3P1FindDepth(s) {
  if (!reFind.test(s)) return false;
  const m = new RegExp('-(-)?maxdepth[= \\t\\n\\r\\f\\v]+(\\+?)([0-9]+)').exec(s);
  if (m) return m[3] !== '1';
  return true;
}

function g3P2FindExec(s) {
  if (!reFind.test(s)) return false;
  if (!new RegExp('-(exec|execdir|ok|okdir)' + SP).test(s)) return false;
  return new RegExp('-(exec|execdir|ok|okdir)' + SP + '+(' + G3_READERS + '|' + G3_SHELLS + ')(' + SP + '|$)').test(s);
}

function g3P3Xargs(s) {
  if (!new RegExp(G3_POS + G3_MOD + 'xargs(' + SP + '|$)').test(s)) return false;
  const at = s.indexOf('xargs');
  const after = at === -1 ? '' : s.slice(at + 'xargs'.length);
  const toks = after.split(IFS_SPLIT).filter(Boolean);
  const optRe = /^(-I|--replace|-n|--max-args|-P|--max-procs|-s|--max-chars|-a|--arg-file|-d|--delimiter|-E|--eof)$/;
  const utilRe = new RegExp('^(' + G3_READERS + '|' + G3_SHELLS + ')$');
  let i = 0;
  while (i < toks.length) {
    const t = toks[i];
    if (optRe.test(t)) {
      if (i + 1 < toks.length && !/^-[A-Za-z]/.test(toks[i + 1])) i += 2;
      else i += 1;
    } else if (t.startsWith('-')) {
      i += 1;
    } else {
      return utilRe.test(t);
    }
  }
  return false;
}

function g3GlobWalk(s, re) {
  let rest = s;
  for (;;) {
    const m = re.exec(rest);
    if (!m) return false;
    const after = rest.slice(m[0].length); // authority quirk: slice by length, not index
    if (g3Scan('glob', after).glob) return true;
    rest = after;
    if (rest === '') return false;
  }
}

function g3P4CatGlob(s) { return g3GlobWalk(s, reCat); }
function g3P7PagerGlob(s) { return g3GlobWalk(s, rePager); }

function g3P5CmdSubst(s) {
  const m = reReader.exec(s);
  if (!m) return false;
  const at = s.indexOf(m[0]);
  const after = at === -1 ? '' : s.slice(at + m[0].length);
  if (/^"?\$\(([^)]+)\)"?(\/[A-Za-z0-9_./@%-]+)"?$/.test(after)) return false;
  if (/\$\(/.test(after)) return true;
  if (after.includes('`')) return true;
  return false;
}

const G3_MATCHALL = '(\\.\\*|\\.|\\.\\+|\\^|"")';
const stripQuotes = (v) => v.replace(/'/g, '').replace(/"/g, '');

function g3GrepHasMatchAll(s) {
  const whole = new RegExp('^' + G3_MATCHALL + '$');
  const eRe = new RegExp(SP + '-e' + SP + '+(' + NSP + '+)');
  let rest = s;
  for (;;) {
    const m = eRe.exec(rest);
    if (!m) break;
    if (whole.test(stripQuotes(m[1]))) return true;
    const at = rest.indexOf(m[0]);
    rest = at === -1 ? '' : rest.slice(at + m[0].length);
  }
  const rm = new RegExp('--regexp[= \\t\\n\\r\\f\\v]+(' + NSP + '+)').exec(s);
  if (rm && whole.test(stripQuotes(rm[1]))) return true;
  let seenCmd = false;
  let pat = '';
  for (const tok of s.split(IFS_SPLIT).filter(Boolean)) {
    if (/^(git|grep|egrep|fgrep|-r|-R|--recursive|-[a-zA-Z]+)$/.test(tok)) { seenCmd = true; continue; }
    if (!seenCmd) continue;
    if (tok.includes('(') || tok.includes(')')) continue;
    if (/^-/.test(tok)) continue;
    if (/^(\/|\.\/|\.\.\/|~\/)/.test(tok)) continue;
    if (tok.includes('/') && !/[*+?[\](){}^$|\\]/.test(tok)) continue;
    pat = stripQuotes(tok);
    break;
  }
  if (pat === '') return true;
  return whole.test(pat);
}

function g3P6GrepMatchAll(s) {
  if (new RegExp(SP + '-F(' + SP + '|$)').test(s)) return false;
  if (new RegExp(SP + '--fixed-strings(' + SP + '|$)').test(s)) return false;
  if (new RegExp(G3_POS + G3_MOD + '(grep|egrep|fgrep)(' + SP + '|$)').test(s)) {
    if (!new RegExp(SP + '(-r|-R|--recursive)(' + SP + '|$)').test(s)) return false;
    if (g3GrepHasMatchAll(s)) return true;
  }
  if (new RegExp(G3_POS + 'git' + SP + '+grep(' + SP + '|$)').test(s)) {
    if (g3GrepHasMatchAll(s)) return true;
  }
  return false;
}

function g3P8LsRecursive(s) {
  if (!new RegExp(G3_POS + G3_MOD + G3_PATH + 'ls(' + SP + '|$)').test(s)) return false;
  if (new RegExp(SP + '--recursive(' + SP + '|$)').test(s)) return true;
  if (new RegExp(SP + '-R(' + SP + '|$)').test(s)) return true;
  if (new RegExp(SP + '-[a-zA-Z]*R[a-zA-Z]*(' + SP + '|$)').test(s)) return true;
  return false;
}

function g3P9ShellLoop(s) {
  return new RegExp(G3_POS + '(for|while|until)' + SP).test(s);
}

function g3P10SlurpBuiltins(s) {
  return new RegExp(G3_POS + '(mapfile|readarray)(' + SP + '|$)').test(s);
}

function g3P11DynamicExec(s) {
  if (new RegExp(G3_POS + '(eval|source)(' + SP + '|$)').test(s)) return true;
  if (new RegExp(G3_POS + '\\.' + SP).test(s)) return true;
  if (new RegExp(G3_POS + '\\.$').test(s)) return true;
  return false;
}

function g3P12Alias(s) {
  if (!new RegExp(G3_POS + 'alias' + SP).test(s)) return false;
  const m = new RegExp('alias' + SP + '+[A-Za-z_][A-Za-z_0-9]*=(.+)').exec(s);
  if (!m) return false;
  let val = m[1];
  val = val.replace(/^'/, '').replace(/'$/, '').replace(/^"/, '').replace(/"$/, '');
  if (new RegExp('^(' + G3_READERS + '|eval|source|\\.)' + SP).test(val)) return true;
  if (new RegExp('^(' + G3_READERS + '|eval|source|\\.)$').test(val)) return true;
  return false;
}

function g3Obfuscation(s) {
  if (/^\$"/.test(s)) return true;
  if (new RegExp(G3_POS + '(\\\\.)+(' + SP + '|$)').test(s)) return true;
  if (new RegExp(G3_POS + "[a-zA-Z]'[a-zA-Z]+'[a-zA-Z]").test(s)) return true;
  return false;
}

// All thirteen in one place, in the authority's order. A reviewer reads this table,
// not the call sites.
const G3_CHECKS = [
  { id: 'P1', check: g3P1FindDepth },
  { id: 'P2', check: g3P2FindExec },
  { id: 'P3', check: g3P3Xargs },
  { id: 'P4', check: g3P4CatGlob },
  { id: 'P5', check: g3P5CmdSubst },
  { id: 'P6', check: g3P6GrepMatchAll },
  { id: 'P7', check: g3P7PagerGlob },
  { id: 'P8', check: g3P8LsRecursive },
  { id: 'P9', check: g3P9ShellLoop },
  { id: 'P10', check: g3P10SlurpBuiltins },
  { id: 'P11', check: g3P11DynamicExec },
  { id: 'P12', check: g3P12Alias },
  { id: 'OBF', check: g3Obfuscation },
];

// Operator policy, read fresh on every invocation so a change applies without a
// session restart. Absent means an empty list, which is policy, not a fault.
// Present-but-unreadable means an empty list PLUS a debug line, because that is a
// fault worth seeing, and neither condition may throw: a permissions problem on a
// policy file must never escalate into denying every tool call in the session.
function g3ReadAllowlist() {
  let raw;
  try {
    raw = readFileSync(join(process.cwd(), ...G3_ALLOWLIST_REL), 'utf8');
  } catch (e) {
    if (e.code !== 'ENOENT') debug(`guard 3 allowlist unreadable: ${e.message}`);
    return [];
  }
  return raw.split('\n')
    .map(l => l.trim())
    .filter(l => l !== '' && !l.startsWith('#'));
}

// Entries match LITERALLY. The authority interpolates them raw into an ERE, so its
// entry file.ts also matches fileXts; that leak is fixed here and the divergence is
// asserted by the corpus EXCEPTIONS row. Escaping also keeps an entry from adding a
// capture group, which would shift the suffix index below.
const g3EscapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const G3_BD = '(^|[ \\t\\n\\r\\f\\v|;()])';
const G3_AD = '([ \\t\\n\\r\\f\\v|;()]|$)';

function g3AllowlistCovers(s, entries) {
  if (entries.length === 0) return false;
  for (const entry of entries) {
    if (entry.endsWith('/')) {
      const m = new RegExp(G3_BD + g3EscapeRe(entry) + '([A-Za-z0-9_./@%*?-]*)' + G3_AD).exec(s);
      if (m) {
        // G3_BD contributes group 1, so the suffix is group 2, matching the
        // authority's BASH_REMATCH[2]. A suffix that walks up the tree is not
        // covered: an allowlist entry must not become a path-traversal gift.
        if (/(^|\/)\.\.(\/|$)/.test(m[2])) continue;
        return true;
      }
    } else if (new RegExp(G3_BD + g3EscapeRe(entry) + G3_AD).test(s)) {
      return true;
    }
  }
  return false;
}

// bash's $( ) strips ALL trailing newlines from a command substitution, and the
// authority captures both preprocessing stages that way. The joiner appends a newline
// per line INCLUDING the last, so without this chomp the port's preprocessed string
// ends in a spurious ';' and every ([ \t\n\r\f\v]|$) end anchor silently fails:
// `ls -laR` stops matching P8, `alias c='cat'` stops matching P12, `git grep '.*'`
// stops matching P6 and `ls | xargs cat` stops matching P3.
const g3Chomp = (s) => s.replace(/\n+$/, '');

function g3Blocked(detail) {
  return deny(
    `BASH SCAN BLOCKED. ${detail} ` +
    'Authorized alternatives: 1. Grep for targeted content search with file and pattern scope. ' +
    '2. Glob for path listing without file content. 3. Read with an explicit offset and limit. ' +
    'To permit a path permanently, add a commented entry to .claude/memory/bash-scan-allowlist.txt.'
  );
}

// Guard 3: the bash command scanner, ported from tests/fixtures/guard3-reference.sh.
// That file remains the behavioral authority and both are driven by one shared corpus.
function guard3BashScan(input) {
  const command = typeof input.command === 'string' ? input.command : '';
  if (command === '') return null;
  if (command.length > G3_MAX_LEN) {
    return g3Blocked(`The command string exceeds the maximum scan length (${G3_MAX_LEN} chars).`);
  }
  const scan = g3Scan('strip', g3Chomp(g3JoinContinuations(command)));
  if (scan.malformed) {
    return g3Blocked('Malformed shell syntax (unclosed quote), blocked as a precaution.');
  }
  // Real newlines become semicolons so a multi-line script reads as a command
  // sequence to every position-anchored pattern above.
  const pre = g3Chomp(scan.result).split('\n').join(';');
  const ids = [];
  for (const { id, check } of G3_CHECKS) if (check(pre)) ids.push(id);
  if (ids.length === 0) return null;
  if (g3AllowlistCovers(pre, g3ReadAllowlist())) return null;
  return g3Blocked(`The command triggered a mass content-dump pattern. Pattern ids: ${ids.join(' ')}.`);
}

const DISPATCH = {
  Read: [guard4BlockedRead, guard1LargeRead],
  Write: [guard2DuplicateWrite],
  create_file: [guard2DuplicateWrite],
  write_file: [guard2DuplicateWrite],
  Edit: [],
  Bash: [guard3BashScan],
};

// Case B. Unparseable input is not "nothing to verify", it is "the verifier could not
// run", which is the condition that fails closed. CC_HOOK_ALLOW bypasses THIS denial only;
// it does not suppress, alter or bypass any guard's decision on input that parses.
function unreadable(why) {
  process.stderr.write(
    `pre-tool-use: ${why}; no guard could inspect this call. ` +
    'Set CC_HOOK_ALLOW=1 to allow calls whose payload this hook cannot read.\n'
  );
  if (process.env.CC_HOOK_ALLOW) return;
  emit(deny(
    `Pre-tool-use hook: ${why}, so no guard could inspect this call. ` +
    'Unreadable input fails closed. Set CC_HOOK_ALLOW=1 to override.'
  ));
}

function main() {
  let raw = '';
  try { raw = readFileSync(0, 'utf8'); }
  catch (e) { debug(`stdin read failed: ${e.message}`); }

  let payload;
  try { payload = JSON.parse(raw); }
  catch { return unreadable('stdin did not parse as JSON'); }

  // Parsed, so not Case B. Anything the table cannot route on is unfamiliar-but-valid,
  // and fail-closed is scoped to unparseable input, never to an additive payload change.
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    debug('payload is not a JSON object; allowing');
    return;
  }
  const name = typeof payload.tool_name === 'string' ? payload.tool_name : '';
  const rawInput = payload.tool_input;
  const input = (rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput)) ? rawInput : {};
  const guards = DISPATCH[name];
  if (!guards) { debug(`no guard registered for tool_name "${name}"; allowing`); return; }
  for (const guard of guards) {
    const decision = guard(input);
    if (decision) { emit(decision); return; }
  }
}

try { main(); } catch (e) { unreadable(`the hook threw (${e && e.message})`); }
