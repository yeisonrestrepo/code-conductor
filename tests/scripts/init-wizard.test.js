import { describe, it, expect } from 'vitest';
import {
  FIELDS, FIELD_KEYS, fieldByKey, canonicalLine, unresolvedReason, isResolved,
} from '../../scripts/claude-md-fields.mjs';

describe('claude-md-fields', () => {
  it('pins the eight CLAUDE.md fields in file order', () => {
    expect(FIELD_KEYS).toEqual([
      'name', 'description', 'stack', 'build', 'test', 'lint', 'format', 'setup',
    ]);
    expect(FIELDS).toHaveLength(FIELD_KEYS.length);
  });

  it('maps each field to its CLAUDE.md line label', () => {
    expect(canonicalLine(fieldByKey('build'))).toBe('- Build:');
    expect(canonicalLine(fieldByKey('description'))).toBe('- Description:');
    expect(fieldByKey('nope')).toBeUndefined();
  });

  // The spec's truth table, verbatim.
  it.each([
    ['npm run build', null],
    ['N/A',           null],
    ['<COMMAND>',     null],
    ['<Command>',     null],
    ['',              'empty'],
    ['   ',           'empty'],
    ['<command>',     'placeholder'],
    ['  <command>  ', 'placeholder'],
  ])('unresolvedReason(%j) === %j', (value, reason) => {
    expect(unresolvedReason(value)).toBe(reason);
    expect(isResolved(value)).toBe(reason === null);
  });

  it('treats a missing value as empty rather than throwing', () => {
    expect(unresolvedReason(undefined)).toBe('empty');
    expect(unresolvedReason(null)).toBe('empty');
  });
});
