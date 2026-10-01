// Pure text engine for the CLAUDE.md / .gitignore merge. Deliberately imports
// nothing from node:fs — every function here is a string -> string transform, so
// the fence, sentinel and EOL rules are unit-testable without touching disk.
// The I/O half (backups, atomic write, symlinks) lives in file-merge.mjs.

export const SENTINEL_START = '<!-- cc:managed:start -->';
export const SENTINEL_END = '<!-- cc:managed:end -->';
// Opens the installer's labelled block in a host .gitignore. The shipped template
// starts with it (templates.test.js) and the merge finds the block by it.
export const GITIGNORE_HEADER = '# Code Conductor (added by the installer; safe to keep)';
const NEGATION_NOTICE = 'left the existing Code Conductor entries in .gitignore where they are, because the file has a "!" line and moving them could change what it ignores';

const toLf = (t) => t.replace(/\r\n/g, '\n');

// Host EOL wins for everything this writer emits. A file with no terminator at
// all (one line, no trailing newline) offers no evidence either way -> LF.
export function detectEol(text) {
  const i = text.indexOf('\n');
  if (i === -1) return '\n';
  return i > 0 && text[i - 1] === '\r' ? '\r\n' : '\n';
}

// Comparison key for a `## ` heading: case, inner whitespace, a trailing CR and
// trailing #'s are all noise, so `## Conventions` matches `## conventions  ##`.
export function normalizeHeading(line) {
  return line
    .replace(/\r$/, '')
    .replace(/^##\s+/, '')
    .replace(/\s*#*\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// One fence-aware pass. Takes raw text: each element of `lines` keeps its own CR,
// so a caller that splices `lines` and rejoins on '\n' reproduces every untouched
// byte. Returns line INDICES only. A fence opens on ``` or ~~~ at column 0 (info
// string allowed) and closes on a bare run of the SAME marker char. An unclosed
// fence runs to EOF, so everything after it is body text — never a heading, never
// a sentinel — and `openFence` says so.
export function scanLines(text) {
  const lines = text.split('\n');
  const headings = [];
  const starts = [];
  const ends = [];
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, '');
    const marker = line.match(/^(`{3,}|~{3,})/);
    if (fence) {
      if (marker && marker[1][0] === fence && /^(`{3,}|~{3,})\s*$/.test(line)) fence = null;
      continue;
    }
    if (marker) { fence = marker[1][0]; continue; }
    const trimmed = line.trim();
    if (trimmed === SENTINEL_START) { starts.push(i); continue; }
    if (trimmed === SENTINEL_END) { ends.push(i); continue; }
    if (/^## /.test(line)) headings.push({ index: i, key: normalizeHeading(line) });
  }
  const status =
    starts.length === 0 && ends.length === 0 ? 'none'
      : starts.length === 1 && ends.length === 1 && starts[0] < ends[0] ? 'balanced'
        : 'unbalanced';
  return { lines, headings, start: starts[0], end: ends[0], status, openFence: fence !== null };
}

const unchanged = (hostText, warning) => ({ text: hostText, changed: false, warning });

// The host's bytes, one blank separator line, then `added` in the host's EOL. A host
// with no final newline gets one first, so its last line never fuses with ours.
function appendLines(hostText, added, eol) {
  if (hostText === '') return added.join(eol) + eol;
  const separator = hostText.endsWith('\n') ? eol : eol + eol;
  return hostText + separator + added.join(eol) + eol;
}

// Only the lines strictly between the sentinels are replaced. The sentinel lines and
// every byte outside them are the host's raw lines, rejoined exactly as they were split.
function refreshInterior(host, interior, eol) {
  const current = host.lines.slice(host.start + 1, host.end).map((l) => l.replace(/\r$/, ''));
  if (current.join('\n') === interior.join('\n')) return host.lines.join('\n');
  const cr = eol === '\r\n' ? '\r' : '';
  return [
    ...host.lines.slice(0, host.start + 1),
    ...interior.map((l) => l + cr),
    ...host.lines.slice(host.end),
  ].join('\n');
}

// Ownership is the sentinels' alone (BUG-049). A heading's name decides nothing: a
// sentinel-less host keeps every byte and gets the block appended, and a balanced
// host has only its block interior refreshed.
export function mergeClaudeMdText(templateText, hostText) {
  const tpl = scanLines(toLf(templateText));
  // Never mutate host content on the authority of a broken shipped template.
  if (tpl.status !== 'balanced') return unchanged(hostText, 'TEMPLATE_SENTINEL_UNBALANCED');
  if (hostText.trim() === '') {
    return { text: templateText, changed: templateText !== hostText, warning: null };
  }
  const host = scanLines(hostText);
  // Guessing the intended block risks eating host content, so every malformed
  // count takes the same path: touch nothing at all.
  if (host.status === 'unbalanced') return unchanged(hostText, 'CLAUDE_MD_SENTINEL_UNBALANCED');
  // A block appended after an unclosed fence would sit inside it, invisible to the
  // next run, which would append another. Writing nothing is the only idempotent move.
  if (host.status === 'none' && host.openFence) return unchanged(hostText, 'CLAUDE_MD_UNCLOSED_FENCE');
  const eol = detectEol(hostText);
  const text = host.status === 'balanced'
    ? refreshInterior(host, tpl.lines.slice(tpl.start + 1, tpl.end), eol)
    : appendLines(hostText, tpl.lines.slice(tpl.start, tpl.end + 1), eol);
  return { text, changed: text !== hostText, warning: null };
}

const keyOf = (line) => line.replace(/\r$/, '').trim();

// The installer's own entries are the template's non-blank, non-comment lines.
function managedEntries(templateText) {
  return toLf(templateText).split('\n').map(keyOf).filter((k) => k && !k.startsWith('#'));
}

// The block runs from the header to the first blank line or EOF; `end` is exclusive.
function findBlock(lines) {
  const header = lines.findIndex((l) => keyOf(l) === GITIGNORE_HEADER);
  if (header === -1) return null;
  let end = header + 1;
  while (end < lines.length && keyOf(lines[end]) !== '') end++;
  return { header, end };
}

// Exact copies of a managed entry outside the block: the lines gathering would move.
function strayEntryIndices(lines, block, entries) {
  const inBlock = (i) => block !== null && i > block.header && i < block.end;
  return lines.flatMap((l, i) => (!inBlock(i) && entries.includes(keyOf(l)) ? [i] : []));
}

// Missing entries go at the end of an existing block, or into a new block appended
// after one blank line. Every other host line keeps its bytes and its place.
function insertEntries(lines, block, missing, eol) {
  if (!block) return appendLines(lines.join('\n'), [GITIGNORE_HEADER, ...missing], eol);
  const cr = eol === '\r\n' ? '\r' : '';
  const out = lines.slice();
  if (block.end === out.length) {
    out[out.length - 1] = out[out.length - 1].replace(/\r$/, '') + cr;
    out.push('');
  }
  out.splice(block.end, 0, ...missing.map((e) => e + cr));
  return out.join('\n');
}

export function mergeGitignoreText(templateText, hostText) {
  if (hostText.trim() === '') {
    return { text: templateText, changed: templateText !== hostText, warning: null, notice: null };
  }
  const entries = managedEntries(templateText);
  const lines = hostText.split('\n');
  const strays = strayEntryIndices(lines, findBlock(lines), entries);
  // Moving an ignore line past a later `!` re-include can change what the file
  // ignores, so a host with any negation keeps every line exactly where it is.
  const negated = lines.some((l) => keyOf(l).startsWith('!'));
  const kept = negated || !strays.length ? lines : lines.filter((_, i) => !strays.includes(i));
  const present = new Set(kept.map(keyOf));
  const missing = entries.filter((e) => !present.has(e));
  if (kept === lines && !missing.length) return { text: hostText, changed: false, warning: null, notice: null };
  const text = insertEntries(kept, findBlock(kept), missing, detectEol(hostText));
  const notice = negated && strays.length ? NEGATION_NOTICE : null;
  return { text, changed: text !== hostText, warning: null, notice };
}
