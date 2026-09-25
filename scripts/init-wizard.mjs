// scripts/init-wizard.mjs
// report | check | apply over CLAUDE.md's canonical field lines.
//
// Mode-blind by construction: nothing here inspects whether stdin is a terminal, and
// nothing reads the CI environment variable — a test greps this source for both. The one
// caller that matters — /cc-init executed by Claude Code through Bash — never has a
// terminal, so such a probe would pin the interactive path into non-interactive mode
// forever. The split lives in the caller: cc-init.md asks and applies, CI runs report
// and stops.
import { readFileSync } from 'node:fs';
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

function fail(msg, code) {
  process.stderr.write(`init-wizard: ${msg}\n`);
  process.exit(code);
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

  fail(`unknown subcommand ${sub ? `"${sub}"` : '(none)'}\n${USAGE}`, 2);
}

// Guard: run main() only when this file is the entry point, so the helpers above can be
// imported by tests without side effects.
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) main();
