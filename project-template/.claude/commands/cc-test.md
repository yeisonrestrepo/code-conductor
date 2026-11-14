---
description: "(Conductor) Analyze coverage gaps and write missing tests"
---

## Role dispatch - qa (FEAT-061)

The final suite run belongs to the `qa` role agent, which may run only the project's test command (Guard 7). Before Phase 0, from the project root:

```sh
S=.claude/scripts; [ -f "$S/orchestrate.mjs" ] || S=scripts
node "$S/orchestrate.mjs" envelope qa
```

Branch on the first stdout line:

- **`not-installed:`** — a run of this session is live, and the line names the command qa runs. Write no test file: Guard 6 denies the write, and the run's code tasks own the writes. Skip Phase 0 and everything below it: dispatch qa now, as **Dispatch** says, and report.
- **`installed:`** — no run exists, and the verb wrote `.claude/memory/band-envelope.json` for qa with the test command in it. Continue with Phase 0 and the test writing below; at "Run tests after writing them", dispatch qa instead of running the suite here.
- **A non-zero exit, or any other first line** — print `qa not dispatched: <the verb's stderr line>` and continue with the flow below, running the suite in this session.

**Dispatch:** `Agent({ subagent_type: "qa", description: "run the suite", prompt })`. The brief names the scope (`$ARGUMENTS`). It says that a phase command, not a run, dispatched the agent, and either that the envelope is installed at `.claude/memory/band-envelope.json` or, after `not-installed:`, that no envelope was installed for it. Report qa's exact exit status and summary line as the result. A red suite, a guard denial or a report without a `SNAP_HANDBACK` line is reported as it is: never rerun the suite in this session to replace qa's answer.

**Clear:** after `installed:`, run `node "$S/orchestrate.mjs" envelope --clear` before this command ends, on whatever path it ends, also when the developer declines the run. If it refuses, report the refusal and leave the file alone: a run now owns it.

---

## Phase 0 — Skill activation

Before doing anything else, invoke the `subagent-driven-development` Superpowers skill:

```
Skill({ skill: "subagent-driven-development", args: "$ARGUMENTS" })
```

Delegate coverage analysis to an `Explore` sub-agent. Delegate each test file to a separate sub-agent. The main context receives summaries and final file paths only.

---

Analyze coverage gaps first. Run:
```bash
# language-specific coverage command
# e.g.: pnpm test --coverage | tail -20
# e.g.: pytest --cov=src --cov-report=term-missing
```

Identify what is untested. Prioritize:
1. Public functions and API endpoints with no tests
2. Error paths and edge cases in critical paths
3. Integration points between modules

**Strategy:**
- Unit: logic with no I/O dependencies
- Integration: modules that talk to a database, API, or file system
- E2E: user-facing flows (use Playwright)

**All tests use AAA structure:**
```
// Arrange
// Act
// Assert
```

**Test names:** "should [expected behavior] when [condition]"

**For E2E with Playwright:**
1. Confirm the app is running: `curl -f http://localhost:3000 || echo "App not running"`
2. Navigate to the relevant page
3. Interact with the UI to trigger the flow
4. Capture a screenshot
5. Generate the Playwright test

**Run tests after writing them.** Confirm before running. After `installed:` in the role dispatch above, the run is qa's: dispatch it as **Dispatch** says, instead of running the suite here.

**Report:**
- Passed: N
- Failed: N (with failure messages)
- Skipped: N
- Coverage delta: before → after (if available)
