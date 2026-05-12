---
name: critical-review
description: "4-phase adversarial review protocol: pre-flight analysis, adversarial execution check, self-correction loop, and [VALIDATION] report"
type: skill
---

# Critical Review Protocol

Apply this protocol to every implementation task. Do not skip phases.

---

## Phase 1 — Pre-Flight Analysis

Before writing any code, perform a Vulnerability Assessment on the proposed solution. Do not proceed to implementation until all three are answered:

**Happy Path** — Describe the most common successful execution flow in one sentence.

**Failure Points** — Where is this logic most likely to break? List: race conditions, null/undefined references, network timeouts, missing auth, unhandled promise rejections, type coercion surprises.

**Boundary Conditions** — What inputs or volume break assumptions? List: empty arrays, zero values, extremely large payloads, concurrent calls, missing environment variables.

Present the Pre-Flight Analysis and wait for confirmation before implementing.

---

## Phase 2 — Execution & Adversarial Review

After completing the initial implementation, switch to an Adversarial Review persona. Run each check:

### RESILIENCE
Does the system fail gracefully or crash silently when a dependency fails or input is malformed? Look for:
- Caught errors that swallow the stack trace
- Unchecked nulls after async calls
- Missing fallbacks on external API responses

### EFFICIENCY
Is this the best possible outcome? Flag:
- Redundant loops or duplicate traversals
- Deep nesting (>3 levels) replaceable by early returns
- High cyclomatic complexity (branches > 5 in one function)
- N+1 query patterns

### FRICTION
Analyze the Happy Path for unnecessary friction:
- Steps the caller must repeat on every use
- Configuration that should have a sensible default
- Error messages that don't tell the user what to do next

---

## Phase 3 — Self-Correction Loop

For each weakness identified in Phase 2:

1. State the weakness in one sentence (`file:line` reference if applicable).
2. Refactor the code to address it.
3. Re-verify: confirm the original failure point no longer applies.

Do not bundle multiple fixes into one step. One weakness → one refactor → one verification.

---

## Phase 4 — Final Report

End every implementation with a `[VALIDATION]` section:

```
[VALIDATION]
- Edge cases accounted for: [list]
- Why this is the best outcome vs simpler alternatives: [one paragraph]
- Residual risks outside current scope: [list or "none identified"]
```

Do not omit `[VALIDATION]`. If verbosity is MIN, keep each item to one line. If VERBOSE, expand freely.
