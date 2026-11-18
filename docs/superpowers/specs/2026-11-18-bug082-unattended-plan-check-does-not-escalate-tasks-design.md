# BUG-082: Unattended plan check does not escalate tasks that write nested CLAUDE.md files

**Status:** Approved 2026-11-18 by independent review (round 1)

**Item:** `[BUG-082]` (intake of issue #230). **Date:** 2026-11-18.

## Problem

In an unattended `/cc-orchestrate` run, `delegate plan` turns a delegated `APPROVE` into `ESCALATE` when a plan task's **Files:** entry reaches `WRITE_SURFACE` or `CONTROL_PLANE` (`surfaceTask` in `scripts/orchestrate.mjs`; FEAT-054, BUG-080, BUG-081, BUG-086). For instruction files, `CONTROL_PLANE` lists only four fixed paths: `claude.md`, `claude.local.md`, `.claude/claude.md` and `project-template/claude.md` (`scripts/orchestrate.mjs:35`).

The BUG-080 spec kept `docs/CLAUDE.md` as a near miss that does not escalate (its AC3, pinned by test row U43). Its premise was that Claude Code reads only the named files. That premise is wrong. Claude Code also loads a `CLAUDE.md` file that sits in a subdirectory when it reads files in that subdirectory. So a delegated plan that declares `src/CLAUDE.md` passes `delegate plan` today. Whatever that file says can then reach the instructions of the later reviewers in the same run (audit, security, delegated build review), and in an unattended run no owner reads the plan first.

Impact is limited, as the issue says. Hooks and guards do not read these files, and the reviewers they reach already give model judgements. The precondition is `--unattended`, which the owner opts into. Attended runs are unaffected, because the owner approves every plan.

The same depth gap holds for the npm manifests BUG-081 added at the root only (`package.json`, `package-lock.json`, `npm-shrinkwrap.json`, `.npmrc`). With workspaces already declared in the root `package.json`, a new or edited workspace `package.json` runs its lifecycle scripts on the next `npm install`, without any root edit. A nested lockfile or `.npmrc` steers an `npm ci` or `npm install` run in that directory. So a delegated plan that declares `packages/a/package.json` or `tools/.npmrc` passes `delegate plan` today (U48 even pins `tools/package.json` and `src/package.json` as approved near misses).

## Solution

`inControlPlane` (`scripts/orchestrate.mjs`) gets one more disjunct. An entry also reaches the control plane when its **last segment** can name one of six file names, at any depth: `claude.md`, `claude.local.md`, `package.json`, `package-lock.json`, `npm-shrinkwrap.json` and `.npmrc`. The names are compared in lower case, after the existing `taskGlob` normalization (leading `./` dropped, lower-cased). The six names live in one new exported constant next to `CONTROL_PLANE`, in exactly that order, pinned by a test next to the `CONTROL_PLANE` pin. The reason text stays `task <id> declares <entry> inside the control-plane files`. `CONTROL_PLANE` itself, `WRITE_SURFACE`, `inSurface`, `reachesList`, `reachesDir`, `globToRegExp`, the precedence and the run-file shape stay as shipped. The `docs/CLAUDE.md` row moves out of U43 (approve) and into the new escalation rows, as the entry asks. Four U48 rows move the same way: `tools/package.json`, `src/package.json`, `tools/package-lock.json` and `docs/.npmrc`.

### The last-segment test

`Files` entries are globs with Guard 5's semantics (`globToRegExp`): `*` matches within one segment, and `**` matches across segments. Let `g` be the normalized entry and `L` its last `/`-separated segment.

1. If `L` holds no `**`, a path that `g` matches has a last segment that `L` matches exactly. The entry escalates when `globToRegExp(L)` matches one of the six names.
2. If `L` holds `**`, that `**` can span a `/` and absorb the start of the final path segment. So only the text after the last `**` in `L` (call it `S`) has to match the end of the final segment. The entry escalates when `globToRegExp('**' + S)` matches one of the six names.

The test is exact in both directions. Rule 1 is equality on the last segment. In rule 2, a match of `**S` against the name is both needed and enough for some path that `g` matches to end in that name. A single helper of a few lines covers both rules (rule 1 is rule 2 with nothing to strip).

Measured with a copy of `globToRegExp` and the six names on the rows below: every escalation row matches, and every near-miss row does not. The same check passes on every approve row already in U43 (less `docs/CLAUDE.md`), U48 (less the four rows that move) and U51, so none of them starts to escalate.

### Choices the entry leaves open, and the ones this spec takes

| Choice | Taken | Why |
|---|---|---|
| Which names | `claude.md`, `claude.local.md`, `package.json`, `package-lock.json`, `npm-shrinkwrap.json`, `.npmrc`, case-insensitive | The first two are the names the entry gives; the four manifests are an owner decision (see Owner decisions). Case-insensitive, like every other protected path: `taskGlob` lower-cases, and a case-insensitive filesystem resolves `Src/Claude.MD` to the same file. |
| What "matches at any depth" means for globs | Rules 1 and 2 above: the entry escalates when it can name such a file | Guard 5 lets a task write any path its glob matches. So `src/**`, `src/*` and `src/*.md` can write `src/CLAUDE.md`, the same reasoning BUG-080 used for `*.md` and `project-template/**`. The test stays exact: `src/**.js` and `src/**/x.js` cannot name the file and do not escalate. |
| Where the rule lives | A new disjunct in `inControlPlane`, with the names in a new exported constant and its own pin test | The entry names `inControlPlane`. `CONTROL_PLANE` uses path notation (`d/**`, fixed paths) and cannot say "last segment at any depth" without new syntax. A separate constant keeps the `CONTROL_PLANE` pin test unchanged. |
| The fixed `CLAUDE.md` and manifest entries in `CONTROL_PLANE` | Kept | The new rule covers them too, so keeping them changes no behavior. Removing them would churn the pinned array for no gain, and they still record which files are the BUG-080 and BUG-081 owner decisions. |
| Reason text | The existing control-plane reason | A nested `CLAUDE.md` belongs to the same family as the root one: files that steer later dispatches. A nested manifest belongs to the same family as the root manifests: files that run code outside the run. |

## Behavior

### Main path

1. An unattended run reaches `delegate plan`. The delegated review returns `APPROVE`.
2. Task 2 declares `- Create: \`src/CLAUDE.md\``.
3. `inSurface` does not match. `inControlPlane` normalizes the entry to `src/claude.md`; its last segment `claude.md` matches by rule 1.
4. `delegate plan` prints `owner approval required: delegated review plan returned ESCALATE (task Task 2 declares src/CLAUDE.md inside the control-plane files); see .conductor/delegate/plan.md`. `approvals.plan` stays `null`, and `delegated.plan` records `ESCALATE` with that reason, as for every other control-plane escalation.
5. The owner reads the plan and runs `approve plan` or rejects it, as today.

### Alternative paths

- Nested forms escalate with the control-plane reason: `docs/CLAUDE.md`, `src/CLAUDE.md`, `src/CLAUDE.local.md`, `packages/a/b/CLAUDE.md`, `src/.claude/CLAUDE.md`, `project-template/docs/CLAUDE.md`, `./src/CLAUDE.md`, `Src/Claude.MD`.
- Globs that can name such a file escalate with the control-plane reason: `src/**/CLAUDE.md`, `src/*/CLAUDE.md`, `src/*.md`, `src/*`, `src/**`, `src/CLAUDE*`, `src/**.md`, `src/a**`, `src/c*.local.md`.
- Nested manifests escalate with the control-plane reason: `tools/package.json`, `src/package.json`, `tools/package-lock.json`, `docs/.npmrc`, `packages/a/package.json`, `packages/a/b/package-lock.json`, `tools/npm-shrinkwrap.json`, `tools/.npmrc`; the globs `packages/*/package.json`, `packages/**`, `packages/*/*.json`, `tools/.npm*`; the upper-case forms `Packages/A/Package.JSON`, `Tools/.NPMRC`; and the `./` form `./packages/a/package.json`.
- Near misses do not escalate: `src/CLAUDE.md.bak`, `src/CLAUDE.mdx`, `src/xCLAUDE.md`, `src/CLAUDE.md/x.js` (a directory named `CLAUDE.md`), `src/notes.md`, `src/**.js`, `src/**/x.js`, `docs/CLAUDE.local.md.example`, `src/claude-md`, `src/package.json.bak`, `src/package.jsonc`, `src/xpackage.json`, `docs/npmrc`, `src/package-lock.json.orig`, `src/package.json/x.js`, `.npmrc.example`.
- Entries that reach the write surface keep the write-surface reason, because `inSurface` runs first: `**/CLAUDE.md` (its first segment can be `.conductor`), `src/CLAUDE.md.` (NTFS trailing dot), and `src/CLAUDE​.md` (non-ASCII, BUG-086).
- The root and mirror files (`CLAUDE.md`, `CLAUDE.local.md`, `.claude/CLAUDE.md`, `project-template/CLAUDE.md`) escalate exactly as today (U41).
- Attended runs, the owner's `approve plan`, and a delegated `REVISE` or `ESCALATE` are unchanged.

### Error cases

- None are new. The new test is a pure string predicate. It cannot throw on any string `extractTasks` returns: an empty last segment (`src/`) matches neither name and does not escalate.
- A plan with several matching tasks names the first one in plan order, as today (U45).

## Acceptance Criteria

- [ ] AC1: a plan whose only non-source task declares one of `docs/CLAUDE.md`, `src/CLAUDE.md`, `src/CLAUDE.local.md`, `packages/a/b/CLAUDE.md`, `src/.claude/CLAUDE.md`, `project-template/docs/CLAUDE.md`, `./src/CLAUDE.md`, `Src/Claude.MD` escalates over an `APPROVE` report with the control-plane reason (`expectEscalation(path, 'control-plane files')`).
- [ ] AC2: the same holds for the glob forms `src/**/CLAUDE.md`, `src/*/CLAUDE.md`, `src/*.md`, `src/*`, `src/**`, `src/CLAUDE*`, `src/**.md`, `src/a**`, `src/c*.local.md`.
- [ ] AC3: the `docs/CLAUDE.md` row is removed from U43 (it is now an AC1 row), and every other U43 row still approves. A plan whose only non-source task declares one of `src/CLAUDE.md.bak`, `src/CLAUDE.mdx`, `src/xCLAUDE.md`, `src/CLAUDE.md/x.js`, `src/notes.md`, `src/**.js`, `src/**/x.js`, `docs/CLAUDE.local.md.example`, `src/claude-md` is approved by the delegated review (`plan approved by delegated review`, `approvals.plan.by === 'define-review'`).
- [ ] AC3b: a plan whose only non-source task declares one of `tools/package.json`, `src/package.json`, `tools/package-lock.json`, `docs/.npmrc`, `packages/a/package.json`, `packages/a/b/package-lock.json`, `tools/npm-shrinkwrap.json`, `tools/.npmrc`, `packages/*/package.json`, `packages/**`, `packages/*/*.json`, `tools/.npm*`, `Packages/A/Package.JSON`, `Tools/.NPMRC`, `./packages/a/package.json` escalates over an `APPROVE` report with the control-plane reason. The first four leave U48, with their `[BUG-082]` comments. A plan whose only non-source task declares one of `src/package.json.bak`, `src/package.jsonc`, `src/xpackage.json`, `docs/npmrc`, `src/package-lock.json.orig`, `src/package.json/x.js` is approved by the delegated review; `.npmrc.example` stays a U48 near miss.
- [ ] AC4: `**/CLAUDE.md`, `src/CLAUDE.md.` and `src/CLAUDE​.md` escalate with the write-surface reason.
- [ ] AC5: `CONTROL_PLANE`, `WRITE_SURFACE` and their pin tests stay byte-identical. U41, U42, U44-U51 stay green unchanged, except the four U48 rows that move out under AC3b (`tools/package.json`, `src/package.json`, `tools/package-lock.json`, `docs/.npmrc`).
- [ ] AC5b: a pin test next to the `CONTROL_PLANE` pin asserts the new constant equals exactly `['claude.md', 'claude.local.md', 'package.json', 'package-lock.json', 'npm-shrinkwrap.json', '.npmrc']`.
- [ ] AC6: the full suite (`npm test`) passes.

## Out of Scope

- Other files that coding agents may read as instructions: `AGENTS.md` (OpenCode hosts), files a `CLAUDE.md` pulls in with `@path` imports, and other memory or rule directories under `.claude/`. If any of these needs escalation, it should be reported as its own issue.
- Guard 5 and the hook (`.claude/hooks/pre-tool-use.mjs` and its `project-template/` copy): not edited.
- The delegated build review and the other bands: this item changes only the plan check.
- Records: `README.md` Known limits (the BUG-082 line), `CHANGELOG.md`, the backlog and the memory files are written at release.

## System Impact

- `scripts/orchestrate.mjs`: one new exported constant holding the six names, one small helper for the last-segment test, and a second disjunct in `inControlPlane`. The comment block above `CONTROL_PLANE` gets one line citing BUG-082. The installer deploys this file to `.claude/scripts/`, so host projects get the fix on their next install; no installer change is needed.
- `tests/scripts/orchestrate.test.js`: `docs/CLAUDE.md` is removed from U43 and four rows from U48; new `it.each` blocks for AC1-AC4 go beside U41-U51, reusing `atPlan`, `plan`, `task`, `delegateDoc`, `runFile`, `expectEscalation` and the U43 approve-path body. A pin test for the new constant goes next to the `CONTROL_PLANE` pin (AC5b).
- No other caller: `inControlPlane` is used only by `surfaceTask`, and `CONTROL_PLANE` only by `inControlPlane`.

### Files Requiring Full Read (deferred to /cc-plan)

- `scripts/orchestrate.mjs`: the spec read its first 30 lines plus grep-located lines (26-40, 1052-1100). The plan reads `globToRegExp`, `reachesList`, `inControlPlane` and `surfaceTask` in full to place the helper.
- `tests/scripts/orchestrate.test.js`: the U41-U51 blocks, `expectEscalation`, and the `CONTROL_PLANE` pin near line 480.

## Owner decisions

- **Nested manifests are in scope.** The new exported constant holds exactly `claude.md`, `claude.local.md`, `package.json`, `package-lock.json`, `npm-shrinkwrap.json` and `.npmrc`, all matched by the same last-segment test (rules 1 and 2) with the control-plane reason. A pin test for that exact array sits next to the `CONTROL_PLANE` pin.
- **Test rows.** In U48, `tools/package.json`, `src/package.json`, `tools/package-lock.json` and `docs/.npmrc` move out, with their `[BUG-082]` comments, and become escalation rows; `.npmrc.example` stays a near miss. The new escalation rows and near misses are the ones listed under AC3b.
- **Unchanged surfaces.** `CONTROL_PLANE`, `WRITE_SURFACE` and their pins stay byte-identical; U41, U42 and U44-U51 stay green unchanged except the four U48 rows above.
- **Kept as proposed.** The rules 1 and 2 last-segment test, the fixed `CLAUDE.md` entries in `CONTROL_PLANE`, `**/CLAUDE.md` keeping the write-surface reason, and `AGENTS.md`, `@path` imports and `.claude/` rule directories out of scope.
- **Approval.** The spec and the plan each need an owner approval, not a delegated one; no `--unattended` run approves them. The `Approved <date> by the owner` Status line is an owner commit, so this document keeps its Draft status.

## Complexity Estimate

S: one predicate and one constant in one function, plus a pin test and test rows that follow an existing pattern.
