# Security Policy

## Supported versions

Only the latest published version receives security fixes. Older versions are
not patched.

| Version | Supported |
|---|---|
| latest (`1.39.x`) | ✅ |
| < 1.39.0 | ❌ |

Users should always run `npx @yeison.restrepo.r/code-conductor@latest` to get
the most recent fixes.

## Security model

code-conductor is a **governance layer** that runs inside Claude Code sessions.
It executes hooks, guardrails and scripts **on the developer's machine** with
the same permissions as the user's shell. It does not:

- Open network ports or listen for incoming connections
- Store or transmit credentials, tokens or secrets
- Run a background daemon or persistent process
- Add runtime dependencies (`dependencies` in `package.json` is `{}`)

### Guard layers

The project ships seven guard layers in the PreToolUse hook chain. Each guard
denies a class of operations before they execute:

| Guard | Scope |
|---|---|
| Guard 1 | Mass-content-dump patterns (e.g. `cat *`) |
| Guard 2 | Enforces the orchestrator lookup chain |
| Guard 3 | Bash scan allowlist gating |
| Guard 4 | File-scope restrictions |
| Guard 5 | Band-role write scope enforcement |
| Guard 6 | Orchestrator nested-dispatch denial |
| Guard 7 | Band-role Bash denial / test-command-only enforcement |

A security issue in any guard — a bypass, a false allow, or a denial that can
be circumvented — is a security vulnerability.

### Trust boundaries

| Boundary | Trust level |
|---|---|
| User shell → hooks | Trusted (same user) |
| AI agent → hooks | Untrusted (hooks exist to constrain the agent) |
| External issue body → spec role | Untrusted (fenced, hashed snapshot) |
| `npm` registry → installer | Untrusted (installer validates before writing) |

## Reporting a vulnerability

**Do not open a public issue.** Security vulnerabilities must be reported
privately.

### How to report

Send an email to:

📧 **yeison.restrepo.r@gmail.com**

Include:

1. **Description** — what the vulnerability is
2. **Reproduction steps** — minimal steps to trigger it
3. **Impact** — what an attacker could achieve (guard bypass, file write
   outside scope, command injection, etc.)
4. **Affected version(s)** — the version(s) where you observed the issue
5. **Suggested fix** — optional, but welcome

### What to expect

| Step | Timeline |
|---|---|
| Acknowledgement | Within 48 hours |
| Initial assessment | Within 7 days |
| Fix development and release | Best effort, typically within 14 days |
| Public disclosure | After the fix is published |

The reporter will be credited in the CHANGELOG entry unless they request
anonymity.

### What qualifies as a security issue

- A guard bypass that allows a denied operation to execute
- Command injection through hook inputs or script arguments
- Path traversal that escapes a declared scope
- A way to escalate from a band role's constrained permissions
- Arbitrary file write or read outside the expected paths
- An installer action that writes to or modifies files outside `.claude/` and
  the documented managed paths

### What does NOT qualify

- Bugs that require the user to deliberately weaken their own configuration
- Issues that require physical access to the developer's machine
- Denial of service against the developer's own session
- Vulnerabilities in Claude Code itself (report those to
  [Anthropic](https://www.anthropic.com/responsible-disclosure))
- Vulnerabilities in Node.js or npm (report those upstream)

## Security-related configuration

### Bash scan allowlist

Entries in `.claude/memory/bash-scan-allowlist.txt` create permanent exceptions
to Guard 1. These entries:

- Are reviewed in git (they are committed, not local-only)
- Must be proposed by an agent but **added by a human**
- Should be as narrow as possible

### Orchestrator run files

`.claude/memory/orchestrator-run.json` is local-only (`.gitignore`d) and
contains the active run's state. It should never be committed or shared.

## Disclosure policy

We follow **coordinated disclosure**:

1. The reporter sends the vulnerability privately.
2. We acknowledge, assess and develop a fix.
3. We publish the fix in a new version with a CHANGELOG entry.
4. We publicly disclose the vulnerability after the fix is available.

We ask reporters to give us reasonable time to address the issue before any
public disclosure.
