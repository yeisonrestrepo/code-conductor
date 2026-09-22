// Pure text engine for the CLAUDE.md / .gitignore merge. Deliberately imports
// nothing from node:fs — every function here is a string -> string transform, so
// the fence, sentinel and EOL rules are unit-testable without touching disk.
// The I/O half (backups, atomic write, symlinks) lives in file-merge.mjs.

export const SENTINEL_START = '<!-- cc:managed:start -->';
export const SENTINEL_END = '<!-- cc:managed:end -->';

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

// One fence-aware pass over LF-normalized text. Returns line INDICES only, so
// callers slice `lines` themselves and no substring arithmetic is needed.
// A fence opens on ``` or ~~~ at column 0 (info string allowed) and closes on a
// bare run of the SAME marker char. An unclosed fence runs to EOF, so everything
// after it is body text — never a heading, never a sentinel.
export function scanLines(lfText) {
  const lines = lfText.split('\n');
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
  return { lines, headings, start: starts[0], end: ends[0], status };
}

// A section runs from its `## ` line to the line before the next heading, or to
// `limit` (the sentinel start, or EOF) — whichever comes first.
function sectionRange(scan, n, limit) {
  const from = scan.headings[n].index;
  const next = scan.headings[n + 1];
  return [from, Math.min(next ? next.index : limit, limit)];
}

// Append `block` at EOF with exactly one blank separator line and exactly one
// trailing newline, collapsing whatever trailing blank lines the host had.
function appendBlock(lines, block) {
  const out = lines.slice();
  while (out.length && out[out.length - 1].trim() === '') out.pop();
  if (out.length) out.push('');
  out.push(...block);
  if (out[out.length - 1] !== '') out.push('');
  return out;
}

export function mergeClaudeMdText(templateText, hostText) {
  const tpl = scanLines(toLf(templateText));
  // Never mutate host content on the authority of a broken shipped template.
  if (tpl.status !== 'balanced') {
    return { text: hostText, changed: false, warning: 'TEMPLATE_SENTINEL_UNBALANCED' };
  }
  if (hostText.trim() === '') {
    return { text: templateText, changed: templateText !== hostText, warning: null };
  }
  const host0 = scanLines(toLf(hostText));
  // Guessing the intended block risks eating host content, so every malformed
  // count takes the same path: touch nothing at all, not even a section append.
  if (host0.status === 'unbalanced') {
    return { text: hostText, changed: false, warning: 'CLAUDE_MD_SENTINEL_UNBALANCED' };
  }

  const eol = detectEol(hostText);
  const block = tpl.lines.slice(tpl.start, tpl.end + 1);      // sentinels included
  const interior = tpl.lines.slice(tpl.start + 1, tpl.end);   // sentinels excluded
  const managedKeys = new Set(
    tpl.headings.filter((h) => h.index > tpl.start && h.index < tpl.end).map((h) => h.key),
  );

  let lines = host0.lines.slice();
  if (host0.status === 'balanced') {
    // Both sides are already LF here, so this comparison is EOL-normalized by
    // construction — without that a CRLF host would "change" on every run.
    const current = lines.slice(host0.start + 1, host0.end);
    if (current.join('\n') !== interior.join('\n')) {
      lines.splice(host0.start + 1, host0.end - host0.start - 1, ...interior);
    }
  } else {
    // Migration — the ONE path that discards host content. Host sections whose
    // heading matches a managed heading are dropped so the appended block does
    // not duplicate them. The caller's backup file is the recovery.
    const drop = [];
    for (let n = 0; n < host0.headings.length; n++) {
      if (managedKeys.has(host0.headings[n].key)) drop.push(sectionRange(host0, n, lines.length));
    }
    for (const [from, to] of drop.reverse()) lines.splice(from, to - from);
    lines = appendBlock(lines, block);
  }

  // Host-owned template sections the host lacks, in template order, inserted
  // immediately before the sentinel start so the block stays last across releases.
  const host1 = scanLines(lines.join('\n'));
  const have = new Set(host1.headings.map((h) => h.key));
  const additions = [];
  for (let n = 0; n < tpl.headings.length; n++) {
    const h = tpl.headings[n];
    if (h.index > tpl.start || have.has(h.key)) continue;
    const [from, to] = sectionRange(tpl, n, tpl.start);
    additions.push(...tpl.lines.slice(from, to));
  }
  if (additions.length) {
    lines = host1.status === 'balanced'
      ? [...lines.slice(0, host1.start), ...additions, ...lines.slice(host1.start)]
      : appendBlock(lines, additions);
  }

  const text = lines.join(eol);
  return { text, changed: text !== hostText, warning: null };
}

// .gitignore is line-oriented, not section-oriented: compare trimmed, CR-stripped,
// non-empty lines and append the template lines the host lacks. Blank and
// comment-only template lines are never appended.
export function appendMissingLinesText(templateText, hostText) {
  if (hostText.trim() === '') {
    return { text: templateText, changed: templateText !== hostText, warning: null };
  }
  const eol = detectEol(hostText);
  const lines = toLf(hostText).split('\n');
  const have = new Set(lines.map((l) => l.replace(/\r$/, '').trim()).filter(Boolean));
  const additions = [];
  for (const raw of toLf(templateText).split('\n')) {
    const t = raw.replace(/\r$/, '').trim();
    if (!t || t.startsWith('#') || have.has(t)) continue;
    have.add(t);
    additions.push(t);
  }
  if (!additions.length) return { text: hostText, changed: false, warning: null };
  const out = lines.slice();
  while (out.length && out[out.length - 1].trim() === '') out.pop();
  out.push(...additions, '');
  const text = out.join(eol);
  return { text, changed: text !== hostText, warning: null };
}
