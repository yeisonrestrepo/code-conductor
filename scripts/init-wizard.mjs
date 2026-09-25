// scripts/init-wizard.mjs
// report | check | apply over CLAUDE.md's canonical field lines.
//
// Mode-blind by construction: nothing here inspects whether stdin is a terminal, and
// nothing reads the CI environment variable — a test greps this source for both. The one
// caller that matters — /cc-init executed by Claude Code through Bash — never has a
// terminal, so such a probe would pin the interactive path into non-interactive mode
// forever. The split lives in the caller: cc-init.md asks and applies, CI runs report
// and stops.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIELDS, FIELD_KEYS, fieldByKey, canonicalLine, unresolvedReason } from './claude-md-fields.mjs';

const USAGE = `usage:
  node scripts/init-wizard.mjs report
  node scripts/init-wizard.mjs check <field> --value-stdin
  node scripts/init-wizard.mjs apply <field> --value-stdin
fields: ${FIELD_KEYS.join(', ')}`;

// Labels are fixed ASCII words from the shared module, never developer input, so no
// escaping is needed. No `g` flag: first occurrence is the whole rule.
export function lineMatcher(field) {
  return new RegExp(`^- ${field.label}:(.*)$`, 'm');
}

export function buildReport(text) {
  const report = { unresolved: [], resolved: [], absent: [] };
  for (const field of FIELDS) {
    const m = text.match(lineMatcher(field));
    if (!m) {
      report.absent.push({ field: field.key, expected: canonicalLine(field) });
      continue;
    }
    const reason = unresolvedReason(m[1]);
    if (reason) report.unresolved.push({ field: field.key, raw: m[0], reason });
    else report.resolved.push(field.key);
  }
  return report;
}

// Exactly one trailing line terminator is stripped — the one the heredoc adds. CRLF
// counts as that one terminator; leaving the CR would write a stray carriage return into
// a single-line field. No other whitespace is touched: apply writes what it was given,
// and the predicate judges it trimmed.
export function stripOneTerminator(raw) {
  if (raw.endsWith('\r\n')) return raw.slice(0, -2);
  if (raw.endsWith('\n')) return raw.slice(0, -1);
  return raw;
}

export function applyToText(text, field, value) {
  const re = lineMatcher(field);
  if (!re.test(text)) {
    const err = new Error(
      `${canonicalLine(field)} is missing from CLAUDE.md — restore that line by hand, then re-run. apply never inserts.`,
    );
    err.code = 'LINE_ABSENT';
    throw err;
  }
  // A function replacer: a value may legitimately contain `$&` or `$1`, which a
  // replacement string would expand.
  return text.replace(re, () => `${canonicalLine(field)} ${value}`);
}

const NPM_RUN = /^(?:npm|pnpm)\s+run\s+(\S+)$/;
const YARN    = /^yarn\s+(\S+)$/;

// Only the shapes a package.json can actually answer. Everything else — make, cargo, go,
// a bare binary — is not checkable, and not checkable is not suspicious.
export function scriptNameOf(value) {
  const v = value.trim();
  const m = v.match(NPM_RUN) ?? v.match(YARN);
  return m ? m[1] : null;
}

// Returns one warning string, or null for silence. Never executes anything, never reaches
// the network. An absent or unparseable manifest is silence, not a warning: that is the
// normal case this whole feature exists to serve.
export function checkValue(value, pkgRaw) {
  if (value.trim() === 'N/A') return null;
  const script = scriptNameOf(value);
  if (!script || pkgRaw === null) return null;
  let pkg;
  try {
    pkg = JSON.parse(pkgRaw);
  } catch {
    return null;
  }
  if (typeof pkg !== 'object' || pkg === null || Array.isArray(pkg)) return null;
  const scripts = (typeof pkg.scripts === 'object' && pkg.scripts !== null && !Array.isArray(pkg.scripts))
    ? pkg.scripts
    : {};
  if (Object.prototype.hasOwnProperty.call(scripts, script)) return null;
  return `no script named "${script}" in package.json`;
}

function fail(msg, code) {
  process.stderr.write(`init-wizard: ${msg}\n`);
  process.exit(code);
}

function requireField(name) {
  const field = fieldByKey(name);
  if (!field) fail(`unknown field ${name ? `"${name}"` : '(none)'}\n${USAGE}`, 2);
  return field;
}

// argv is the wrong channel for a developer's answer: quotes, backticks and $(...) in an
// agent-composed command line are an injection surface. stdin has no such edge.
function requireValueStdin(argv) {
  if (!argv.includes('--value-stdin')) fail(`the value must arrive on stdin via --value-stdin\n${USAGE}`, 2);
}

function readValue() {
  try {
    return stripOneTerminator(readFileSync(0, 'utf8'));
  } catch (err) {
    fail(`cannot read the value from stdin: ${err.message}`, 2);
  }
}

function readClaudeMd(root) {
  const path = join(root, 'CLAUDE.md');
  try {
    return { path, text: readFileSync(path, 'utf8') };
  } catch (err) {
    // A missing CLAUDE.md is a broken init, not an unresolved field.
    fail(`cannot read ${path}: ${err.message}`, 1);
  }
}

function main() {
  const [sub] = process.argv.slice(2);
  const root = process.cwd();

  if (sub === 'report') {
    const { text } = readClaudeMd(root);
    const report = buildReport(text);
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    // Advisory only; stdout stays pure JSON.
    if (report.unresolved.length) {
      process.stderr.write(`init-wizard: unresolved: ${report.unresolved.map(u => u.field).join(', ')}\n`);
    }
    if (report.absent.length) {
      process.stderr.write(`init-wizard: absent from CLAUDE.md: ${report.absent.map(a => a.field).join(', ')}\n`);
    }
    return;
  }

  if (sub === 'check') {
    const rest = process.argv.slice(3);
    const field = requireField(rest[0]);
    requireValueStdin(rest);
    const value = readValue();
    let pkgRaw = null;
    try {
      pkgRaw = readFileSync(join(root, 'package.json'), 'utf8');
    } catch {
      pkgRaw = null;
    }
    const warning = checkValue(value, pkgRaw);
    if (warning) process.stderr.write(`init-wizard: ${field.key}: ${warning}\n`);
    return;
  }

  if (sub === 'apply') {
    const rest = process.argv.slice(3);
    const field = requireField(rest[0]);
    requireValueStdin(rest);
    const value = readValue();
    if (value === '') fail(`refusing an empty value for "${field.key}" — a skipped question applies the literal N/A`, 3);
    if (/[\r\n]/.test(value)) fail(`refusing a multi-line value for "${field.key}" — the canonical line is single-line`, 3);
    const { path, text } = readClaudeMd(root);
    let next;
    try {
      next = applyToText(text, field, value);
    } catch (err) {
      fail(err.message, 4);
    }
    try {
      writeFileSync(path, next);
    } catch (err) {
      fail(`cannot write ${path}: ${err.message}`, 5);
    }
    return;
  }

  fail(`unknown subcommand ${sub ? `"${sub}"` : '(none)'}\n${USAGE}`, 2);
}

// Guard: run main() only when this file is the entry point, so the helpers above can be
// imported by tests without side effects.
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) main();
