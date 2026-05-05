---
description: "(Conductor) Refactor a file or module for clarity and simplicity"
---

Diagnose the target file or module:

**Complexity issues found:**
- Functions over 30 lines: [list with line numbers]
- Nesting over 3 levels: [list with line numbers]
- Classes with 5+ dependencies: [list]
- Layers that only delegate: [list]
- Misleading names: [list]

Generate a refactor plan: ordered list of changes, one per step.

For each step:
- What changes (exact file:line range)
- Why (complexity signal it resolves)
- Risk (what could break)

**Execute one change at a time.** After each:
1. Run the test suite
2. Report: tests passed / failed
3. Confirm before the next step

**Final report:**
- Before: [line count, complexity metrics]
- After: [line count, complexity metrics]
- Test status: [passed / N failed]
