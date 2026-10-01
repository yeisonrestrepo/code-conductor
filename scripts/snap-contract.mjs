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

// Post-parse, version-specific caps, applied once snap.v is known. v2 and v3 share the
// pre-parse ceiling: neither is a context-budget file.
export const POST_PARSE_MAX = { 1: V1_MAX_CHARS, 2: PRE_PARSE_MAX_BYTES, 3: PRE_PARSE_MAX_BYTES };

// Highest v this contract understands. Raising it here moves the
// SNAP_UNKNOWN_VERSION boundary with no edit anywhere else.
export const MAX_VERSION = 3;

// One array-cap table in ONE key scheme: dotted path to [count cap, element cap].
// Two schemes for one table is how a drift hides from every diff and grep.
export const CAPS = {
  'ops.n': [3, 200],
  'ops.f': [20, 300],
  'mem.d': [10, 300],
  'mem.x': [5, 200],
};
// Same scheme, v3 only: ops.scope exists in no earlier version, so it cannot join CAPS.
export const V3_CAPS = { 'ops.scope': [20, 300] };

// Field sets, both per version. v1 and v2 share one block map, unchanged since v1;
// v3 adds the band fields reserved by FEAT-010 (ARCH-010).
export const TOP_FIELDS = {
  1: ['v', 'sys', 'ops', 'mem'],
  2: ['v', 'sys', 'ops', 'mem', 'pr'],
  3: ['v', 'sys', 'ops', 'mem', 'pr'],
};
const V1_BLOCKS = { sys: ['ph', 'c', 's'], ops: ['n', 'f'], mem: ['d', 'x'] };
export const BLOCK_FIELDS = {
  1: V1_BLOCKS,
  2: V1_BLOCKS,
  3: { sys: ['ph', 'c', 's', 'role', 'tk'], ops: ['n', 'f', 'scope', 'gate'], mem: ['d', 'x', 'p'] },
};

// The band contract (ARCH-010). A role names an agent with a mask behind it, so the roster
// stops at FEAT-012's five and widens only at a new version. A gate names a band's whole
// exit condition, which the ARCH-009 band table fixes independently of any agent.
export const ROLES = ['spec', 'plan', 'code', 'audit', 'qa'];
export const TOOL_KINDS = ['R', 'RW', 'X'];
export const BANDS = ['boundary', 'define', 'build', 'verify', 'ship'];
export const GATES = ['boundary_routed', 'define_approved', 'build_executed', 'verify_pass', 'ship_released'];
export const ROLE_BAND = { spec: 'define', plan: 'define', code: 'build', audit: 'verify', qa: 'verify' };
// The tools Guard 5 gates. The hook cannot import this module from both of its install
// locations, so it carries a copy that tests/hooks/guard5.test.js pins to this one (D7).
export const WRITE_TOOLS = ['Write', 'Edit', 'create_file', 'write_file'];

// A receiving role expects the exit gate of the band before its own: GATES[i] is the
// exit of BANDS[i].
export const expectedGate = (role) => GATES[BANDS.indexOf(ROLE_BAND[role]) - 1];
