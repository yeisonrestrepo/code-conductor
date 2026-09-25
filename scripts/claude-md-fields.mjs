// scripts/claude-md-fields.mjs
// The canonical CLAUDE.md field list and the one resolved/unresolved predicate.
// detect-stack.mjs, init-wizard.mjs and the test fixtures all key off this module,
// so a field added here fails the suite on every side that has not followed.

export const FIELDS = [
  { key: 'name',        label: 'Name' },
  { key: 'description', label: 'Description' },
  { key: 'stack',       label: 'Stack' },
  { key: 'build',       label: 'Build' },
  { key: 'test',        label: 'Test' },
  { key: 'lint',        label: 'Lint' },
  { key: 'format',      label: 'Format' },
  { key: 'setup',       label: 'Setup' },
];

export const FIELD_KEYS = FIELDS.map(f => f.key);

export function fieldByKey(key) {
  return FIELDS.find(f => f.key === key);
}

// The line `report` locates and `apply` replaces, e.g. `- Build:`.
export function canonicalLine(field) {
  return `- ${field.label}:`;
}

// 'empty' | 'placeholder' for an unresolved value, null when resolved.
// Trimmed, or `- Build: <command> ` would miss the exact match and slip through as
// resolved. Case-sensitive: the template ships exactly one spelling, so only the
// lowercase `<command>` is a placeholder — `<COMMAND>` is a value someone typed.
// `N/A` is resolved: it means asked, and there is none.
export function unresolvedReason(value) {
  const v = String(value ?? '').trim();
  if (v === '') return 'empty';
  if (v === '<command>') return 'placeholder';
  return null;
}

export function isResolved(value) {
  return unresolvedReason(value) === null;
}
