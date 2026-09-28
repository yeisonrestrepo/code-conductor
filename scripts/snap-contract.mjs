// scripts/snap-contract.mjs
// The handoff contract: every limit, array cap, field set and version the SNAP
// envelope is defined by. snap-build.mjs (writer), snap-validate.mjs (validator)
// and conductor-db.mjs (store) all import from here, so a literal on one side
// cannot drift from the other. Zero dependencies, node: builtins only.

// Hard pre-parse ceiling: the largest any version may legitimately be. Applied
// before JSON.parse, whatever version the payload claims, so a hostile or
// corrupt file cannot exhaust memory through the parser.
export const PRE_PARSE_MAX_BYTES = 10485760; // 10 MiB

// The v1 context budget for .claude/memory/session-snapshot.json, a file whose
// whole purpose is to be read into a session. Not a drifted literal: a real
// constraint, kept under its own name.
export const V1_MAX_CHARS = 4096;

// Post-parse, version-specific caps, applied once snap.v is known. For v2 the
// two tiers coincide; they separate the moment a v3 arrives with its own budget.
export const POST_PARSE_MAX = { 1: V1_MAX_CHARS, 2: PRE_PARSE_MAX_BYTES };

// Highest v this contract understands. Raising it here moves the
// SNAP_UNKNOWN_VERSION boundary with no edit anywhere else.
export const MAX_VERSION = 2;

// One array-cap table in ONE key scheme: dotted path to [count cap, element cap].
// Two schemes for one table is how a drift hides from every diff and grep.
export const CAPS = {
  'ops.n': [3, 200],
  'ops.f': [20, 300],
  'mem.d': [10, 300],
  'mem.x': [5, 200],
};

// Field sets. Top-level is per version; block members are version-invariant.
export const TOP_FIELDS = {
  1: ['v', 'sys', 'ops', 'mem'],
  2: ['v', 'sys', 'ops', 'mem', 'pr'],
};
export const BLOCK_FIELDS = { sys: ['ph', 'c', 's'], ops: ['n', 'f'], mem: ['d', 'x'] };
