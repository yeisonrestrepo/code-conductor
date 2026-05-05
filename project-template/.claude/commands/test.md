---
description: "(Conductor) Analyze coverage gaps and write missing tests"
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

**Run tests after writing them.** Confirm before running.

**Report:**
- Passed: N
- Failed: N (with failure messages)
- Skipped: N
- Coverage delta: before → after (if available)
