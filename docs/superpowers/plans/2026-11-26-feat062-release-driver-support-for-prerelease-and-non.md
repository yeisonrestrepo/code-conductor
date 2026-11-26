# FEAT-062 Release driver support for prerelease and non-semver version schemes: implementation plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Update one checkbox per edit (BUG-003 invariant). Execute in file order.

**Goal:** the release profile names its version scheme (`MAJOR.MINOR.PATCH` by default, or `semver`, `pep440`, `numeric`); `digest`, `check` and `handoff` validate and order versions by that scheme; a prerelease publishes only through the profile's `prerelease.publish` step, with its channel printed and, for a program the driver does not know, marked `unverified`; `--init` detects the scheme from the current version and the local tags and refuses what it cannot support; every `MAJOR.MINOR.PATCH` profile behaves byte for byte as in FEAT-035.

**Spec:** `docs/superpowers/specs/2026-11-26-feat062-release-driver-support-for-prerelease-and-non-design.md` (sha256 `1ffcbd43781eee8f8e214c3621f727f5daa1ae8d1faa851ac0bc3c0e64f642be`), approved by the owner with decision D1 (an unverified prerelease publish channel is named "as declared in the profile, not verified", tested under `[E4]`). The owner's plan decision D2 (the `MAJOR.MINOR.PATCH` init row shows its evidence; see Owner decisions below) rules over S11, the "Plain versions everywhere" path and `[E2]` of the spec where they still say that row reads `(default)` for plain versions; the spec amendment D2 asks for goes through the spec gate, not through this plan. Intake of issue #295, follow-up of FEAT-035.

**Test command:** `npm test`. Filtered runs use `npx vitest run <file>` and `-t '<pattern>'`.

## Global Constraints

- No release records: `VERSION`, the `package.json` / `package-lock.json` version, `CHANGELOG.md`, `AGENT-READABLE BACKLOG.md`, `.claude/memory/**` and the README "Known limits" lines stay untouched. The release rewrites them.
- **The spec is not touched by this plan.** Until the spec is amended through its own gate, D2 rules over S11, the "Plain versions everywhere" path and `[E2]` on the `MAJOR.MINOR.PATCH` init row; every other spec line stands as approved.
- **Seven files change in the build, plus this plan and its `.gitignore` leaf:** `scripts/release.mjs`, `tests/scripts/release.test.js`, `tests/installer/commands-parity.test.js`, `.claude/commands/cc-release.md`, `project-template/.claude/commands/cc-release.md`, `project-template/.agents/workflows/cc-release.md`, `project-template/.agents/skills/cc-release/SKILL.md`, and nothing else (the spec's System Impact list, with the parity test that pins the four command copies, plan decision 11).
- Not touched: `scripts/orchestrate.mjs` (it reaches the new keys only through `loadProfile` and `releaseSurface`), `.claude/release-profile.json` (it names no scheme), `.claude/agents/release.md`, the hooks, the SNAP contract, the installer, settings, `.github/workflows/`, `.github/actions/`, dependencies. No network is added; the driver still never publishes, only prints the step.
- Every file this plan edits after Task 0 is already tracked and none sits under an ignored directory, so each is staged with `git add -u <path>`. This plan is new in Task 0 under the ignored `docs/superpowers/plans/` (so `git add -f`) and is tracked and re-included by its leaf afterwards (so `git add -u`).
- `.claude/` is read-only for Bash in the build sandbox: the edit of `.claude/commands/cc-release.md` uses the Edit tool. The other files may use either.
- Functions stay at or under 30 lines; the source still holds no fact of this repository (test 6 of `release.test.js` pins it).

## Files read in full (spec, Files Requiring Full Read)

- `scripts/release.mjs` (1011 lines). `SEMVER` and `PLAIN_SEMVER` (`:19-20`); `KNOWN` (`:59`); `checkTemplate` (`:63-76`); `CAPTURE` (`:79`); `compile` (`:87-100`), which returns `{ re, source, names }`; `parseLine` (`:102-106`); `checkPublish` (`:172-182`), whose three messages are `publish.target: must be a non-empty single-line string with no placeholder`, `publish.argv: must be a non-empty array` and the per-element `checkTemplate` ones; `validateProfile` (`:211-227`); `loadProfile` (`:240-250`); `compareVersions` (`:299-303`); `lineLocation` (`:309-314`); `jsonLocation` (`:316-324`); `itemHeadings` (`:331-345`, its `compile` calls fix or omit `{version}`); `changelogAnchor` (`:347-351`); `prepare` (`:367-378`); `commitLines` (`:473-482`) and its two callers `digestLines` (`:508-521`) and `notesFromCommits` (`:751-756`); the judges (`:532-660`), which compare rendered text and never parse a version; `claimsOf` (`:615`), `excerptFor` (`:720`) and `claimedFromBacklog` (`:738-749`), whose `compile` calls capture no `{version}` (`backlog.done` fixes it); `sectionOf` (`:707-718`); `refuseUnreleased` (`:758`), a string comparison; `handoffContext` (`:772-787`); `finishHandoff` (`:789-800`); `stepLines` (`:806-823`); the init detectors `tomlLocation`, `jsonLocations`, `detectVersions`, `detectChangelog`, `detectTag`, `detectPublish` (`:837-921`); `proposal` (`:923-933`); `initVerb` (`:941-948`), which writes `Object.fromEntries(rows)`; `confirmVerb` (`:950-963`), which runs `validateProfile`. **The `compile` callers that capture `{version}` are exactly four:** `lineLocation`, `changelogAnchor`, `commitLines` and the `any` pattern of `sectionOf`. The backlog DONE judgment (`judgeBacklog`, `:593`) renders and compares by prefix, so it needs no scheme.
- `tests/scripts/release.test.js` (1216 lines). Imports `ReleaseError, releaseSurface, validateProfile, windowsInvocation` (`:7`). Fixtures: `PROFILE` (`:18-39`, stable `publish` `demo-publish {tag} {notes}`), `clone`, `without`, `NOCL`; `project(profile)` (`:87-105`: `VERSION`, `package.json`, `package-lock.json` at `1.0.0`, tag `v1.0.0` on `chore: base`, then `feat: alpha work`); `applyRelease({ v, items, changelog })` (`:107-127`); `report`, `merge`, `checkArgs`, `ticketPath`, `walk`, `refusal`, `initProject` (`:151-163`: npm at `2.3.4`, tag `v2.3.4`, `origin/HEAD` → `trunk`), `proposalFile`. The validator suite's `INVALID` table (`:188`) asserts a field and a reason. Init test 12 (`:337-358`) asserts the exact proposal file and `expect(r.out).not.toContain('(default)')`; test 13 asserts the exact file for a pyproject project. Digest test 24 (`:479-509`) and handoff test 46 (`:1090-1112`) pin the exact lines. Test 61 (`:1182`) pins the null-changelog notes. The last suite is `describe('this repository\'s release profile [FEAT-035]'` at `:1210`. No title contains `FEAT-062`.
- `tests/installer/commands-parity.test.js` (739 lines). `RELEASE_MIRRORS` (`:625`, the two Claude Code copies); `describe('cc-release [FEAT-035]'` (`:627-674`), whose `[O6]` row pins `"this publishes to \`<PUBLISH-TARGET>\` and cannot be undone"`; the harness copies are named only in the BUG-090 row (`:663`). The block is followed by `describe('the release role ships [FEAT-035 O5]'` at `:676`.
- The four `cc-release` copies: Handoff step 3 is `.claude/commands/cc-release.md:38`, `project-template/.claude/commands/cc-release.md:38`, `project-template/.agents/workflows/cc-release.md:41` and `project-template/.agents/skills/cc-release/SKILL.md:42`; the four lines are byte-identical and each holds once `before the \`publish\` step the question reads "this publishes to \`<PUBLISH-TARGET>\` and cannot be undone".`

## Owner decisions

| # | Decision | Effect on this plan |
|---|---|---|
| D2 | Test 12 stays unmodified. When only plain versions evidence the scheme, the `MAJOR.MINOR.PATCH` row shows its evidence (the current version and, when one exists, the first tag that backs it, for example `(from package.json 2.3.4; tag v2.3.4)`), and `(default)` only when there is no evidence at all. D2 also asks that S11, the "Plain versions everywhere" path and `[E2]` of the spec be amended to match; that amendment goes through the spec gate, and until it lands D2 rules over those three spots; `[E6]` stays as written; plan decision 7 (a default `scheme` is not written to the proposal file) stands | Decision 6's `DEFAULT_SCHEME` branch returns that evidence; decision 8 drops the narrowing of test 12; rows `i7`, `i8`, `i9` of decision 10, T-102, T-104, T-802, T-806 and the risks follow. The new-test count (90) and the red and green predictions are unchanged. |
| D3 | The plan is approved on the condition that its Spec line cites the sha256 of the spec as committed on this branch (`1ffcbd43781eee8f8e214c3621f727f5daa1ae8d1faa851ac0bc3c0e64f642be`) and that no uncommitted spec edit is left in the working tree. Only that citation changes. D2's spec amendment goes through the spec gate before the build is judged, and the cited hash is updated there | The Spec line cites `c5829f48…`; the spec file is unchanged on this branch; no task, test or decision of this plan changes. |

## Plan decisions

1. **The scheme table (spec S1-S4, S12).** A new section in `scripts/release.mjs`, after the text helpers (`:55`) and before `// ---- templates ----`:

   ```js
   // ---- version schemes (FEAT-062): a closed list, each a fixed grammar, precedence and prerelease test ----

   const DEFAULT_SCHEME = 'MAJOR.MINOR.PATCH';
   const SCHEME_LIST = 'MAJOR.MINOR.PATCH, semver, pep440, numeric';
   const INIT_ORDER = ['MAJOR.MINOR.PATCH', 'semver', 'numeric', 'pep440'];
   const NO_LEADING_ZERO = /^(0|[1-9]\d*)$/;
   const SEMVER_FORM = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
   const PEP440_FORM = /^(\d+(?:\.\d+)*)(?:(a|b|rc)(\d+))?(?:\.post(\d+))?(?:\.dev(\d+))?$/;
   // PEP 440's permissive spellings (without epoch and local), so a near miss is told it is not in normal form.
   const PEP440_LOOSE = /^v?\d+(?:\.\d+)*(?:[-_.]?(?:a|b|c|rc|alpha|beta|pre|preview)[-_.]?\d*)?(?:-\d+|[-_.]?(?:post|rev|r)[-_.]?\d*)?(?:[-_.]?dev[-_.]?\d*)?$/i;
   const NUMERIC_FORM = /^\d+(?:\.\d+)+$/;
   const near = (reason) => ({ reason, near: true });
   const far = (reason) => ({ reason, near: false });
   ```

   Each `parse` returns `{ value }` or `{ reason, near }`; `near` marks a reason specific enough to show at `--init` (decision 7).

   - `parseTriple(text)`: `SEMVER.test(text) ? { value: text } : far('only MAJOR.MINOR.PATCH is supported')`. `compareTriple` is the shipped `compareVersions` body, moved unchanged.
   - `parseSemver(text)`: a `+` → `near('build metadata is not supported')`; no `SEMVER_FORM` match → `far('not MAJOR.MINOR.PATCH with an optional -prerelease')`; a leading zero in a number → `near('a numeric part has a leading zero')`; a numeric prerelease identifier with a leading zero → `near(\`prerelease identifier ${id} has a leading zero\`)`; else `{ value: { release: [M, m, p] as numbers, pre: identifiers or [] } }`.
   - `parsePep440(text)`: a `!` → `near('an epoch is not supported')`; a `+` → `near('a local version is not supported')`; no `PEP440_FORM` match, or any number (release parts, pre, post, dev) with a leading zero → `PEP440_LOOSE.test(text) ? near('not in PEP 440 normal form') : far('not a PEP 440 version')`; else `{ value: { release, pre: [rank of a|b|rc as 0|1|2, N] or null, post: N or null, dev: N or null } }`.
   - `parseNumeric(text)`: `NUMERIC_FORM.test(text) ? { value: numbers } : far('not two or more dot-separated numbers')`.
   - `compareLists(x, y, pad = 0)`: element by element over the longer length, a missing element reading as `pad`; `-1 | 0 | 1`.
   - `compareSemver(a, b)`: release by `compareLists`; then, when either has no prerelease, `Math.sign((x.pre.length === 0) - (y.pre.length === 0))`; then identifiers left to right with `compareIdentifiers` (both numeric: numerically; one numeric: it is lower; else ASCII order with `<`); then `Math.sign(x.pre.length - y.pre.length)` (S3).
   - `comparePep440(a, b)`: release by `compareLists` (trailing zeros ignored through `pad = 0`); then the PEP's key, built by `pep440Key(v)`: `[v.pre ?? (v.post === null && v.dev !== null ? [-Infinity] : [Infinity]), [v.post ?? -Infinity], [v.dev ?? Infinity]]`, its three parts compared in order with `compareLists`. That yields `1.2.0.dev1 < 1.2.0a1 < 1.2.0b2 < 1.2.0rc1 < 1.2.0 < 1.2.0.post1.dev1 < 1.2.0.post1` (S3).
   - `compareNumeric(a, b)`: `compareLists` of the parsed numbers (`2026.11 == 2026.11.0`, `2026.01 == 2026.1`).
   - The table, in `SCHEME_LIST` order:

     ```js
     const SCHEMES = {
       'MAJOR.MINOR.PATCH': { capture: '(\\d+\\.\\d+\\.\\d+)', validates: false, prereleases: false, parse: parseTriple, compare: compareTriple, isPrerelease: () => false },
       semver: { capture: '(\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?)', validates: true, prereleases: true, parse: parseSemver, compare: compareSemver, isPrerelease: (v) => parseSemver(v).value.pre.length > 0 },
       pep440: { capture: '(\\d+(?:\\.\\d+)*(?:(?:a|b|rc)\\d+)?(?:\\.post\\d+)?(?:\\.dev\\d+)?)', validates: true, prereleases: true, parse: parsePep440, compare: comparePep440, isPrerelease: (v) => { const p = parsePep440(v).value; return p.pre !== null || p.dev !== null; } },
       numeric: { capture: '(\\d+(?:\\.\\d+)+)', validates: true, prereleases: false, parse: parseNumeric, compare: compareNumeric, isPrerelease: () => false },
     };
     const SCHEME_NAMES = Object.keys(SCHEMES);
     const schemeOf = (profile) => profile.scheme ?? DEFAULT_SCHEME;
     const versionReason = (scheme, text) => SCHEMES[scheme].parse(text).reason ?? null;
     const isPrerelease = (profile, version) => SCHEMES[schemeOf(profile)].isPrerelease(version);
     ```

     The `MAJOR.MINOR.PATCH` capture is today's `CAPTURE.version` byte for byte; the other three are S7's.
   - `compareVersions` stays exported at its place (`:299`) as `export function compareVersions(a, b, scheme = DEFAULT_SCHEME) { return SCHEMES[scheme].compare(a, b); }`; with no third argument it is the shipped function.
   - `refuseInvalidVersion(version, scheme)` (S12), next to `prepare`: no reason → return; else `fail('RELEASE_VERSION_INVALID', scheme === DEFAULT_SCHEME ? \`${version}: ${reason}\` : \`${version}: not a ${scheme} version: ${reason}\`)`. Under the default the text stays `<v>: only MAJOR.MINOR.PATCH is supported`.

2. **The validator (S1, S5, S6).**
   - `KNOWN` gains `'channel'`. `checkTemplate` is unchanged: `{channel}` is in `allowed` only for `prerelease.publish.argv`, so anywhere else it refuses `placeholder {channel} is not allowed here`.
   - `checkPublish` is split, its messages unchanged: `checkTarget(field, target)` (the target rule, `:175-177`) and `checkPublishArgv(field, argv, names)` (the non-empty array and the per-element `checkTemplate` with every name open `[0, Infinity]`). `checkPublish` calls them with `'publish.target'`, `'publish.argv'` and `PUBLISH_NAMES = ['tag', 'version', 'notes', 'sha']`.
   - `validateProfile`: the top-level optional keys become `['backlog', 'ticket', 'scheme', 'prerelease']`; `checkScheme(obj)` runs right after `checkPublish(obj.publish)`, so no existing first refusal moves:

     ```js
     // FEAT-062 S1, S5: a scheme with prereleases states, in the committed profile, where a prerelease goes.
     function checkScheme(obj) {
       if ('scheme' in obj && (typeof obj.scheme !== 'string' || !Object.hasOwn(SCHEMES, obj.scheme))) invalid('scheme', `must be one of ${SCHEME_LIST}`);
       const scheme = schemeOf(obj);
       if (SCHEMES[scheme].prereleases && !('prerelease' in obj)) invalid('prerelease', `required by scheme ${scheme}`);
       if (!SCHEMES[scheme].prereleases && 'prerelease' in obj) invalid('prerelease', `not allowed with scheme ${scheme}`);
       if ('prerelease' in obj) checkPrerelease(obj.prerelease);
     }
     ```

     The `typeof` guard matters: `Object.hasOwn` coerces its key, so `["semver"]` would otherwise pass.
   - `checkPrerelease(pre)`: `checkKeys('prerelease', pre, ['publish', 'countsAsLastRelease'])`; `countsAsLastRelease` not a boolean → `invalid('prerelease.countsAsLastRelease', 'must be true or false')`; `publish === null` → return; `checkKeys('prerelease.publish', pre.publish, ['channel', 'target', 'argv'])`; `channel` not a string matching `^[A-Za-z0-9._-]+$` → `invalid('prerelease.publish.channel', 'must match [A-Za-z0-9._-]+')`; `checkTarget('prerelease.publish.target', …)`; `checkPublishArgv('prerelease.publish.argv', …, [...PUBLISH_NAMES, 'channel'])`; then `latestRisk(argv, channel)`, a non-null reason → `invalid('prerelease.publish.argv', reason)`.
   - `latestRisk(argv, channel)` (S6): argv starting `npm publish` → `null` when some element is `--tag` followed by `{channel}` or the literal channel, or is `--tag={channel}` / `--tag=<channel>`, else `'npm publish needs --tag {channel} or --tag <channel>'`; argv starting `gh release create` → `'gh release create needs --prerelease'` when `--prerelease` is absent, `'gh release create must not carry --latest'` when `--latest` or `--latest=true` is present, else `null`; any other program → `null`. `knownPublish(argv)` is the predicate "starts `npm publish` or `gh release create`", shared with decision 5.

3. **Templates and locations (S7).**
   - `CAPTURE` loses its `version` key. `compile(template, fixed = {}, anchorEnd = true, scheme = DEFAULT_SCHEME)` uses `SCHEMES[scheme].capture` for a captured `{version}` and returns `{ re, source, names, scheme }`.
   - `parseLine`: after building the captures, `if (found.version !== undefined && SCHEMES[compiled.scheme].validates && versionReason(compiled.scheme, found.version) !== null) return null;` with the comment `// FEAT-062 S7: under a validating scheme a captured value the scheme rejects is no match.` Under the default nothing is validated, as shipped.
   - The four capturing callers pass `schemeOf(profile)`: `lineLocation(root, entry, scheme)` (its caller `locationValues` passes it), `changelogAnchor`, `commitLines`, and `sectionOf`'s `any` (its fixed `heading` captures nothing).
   - `jsonLocation(root, entry, scheme)`: under the default keeps `PLAIN_SEMVER` and its message; otherwise a value is accepted when `versionReason(scheme, value) === null`, and the refusal reads `holds no ${scheme} version at HEAD`.

4. **The digest and the range (S8, S10, S12).**
   - `prepare`: `refuseInvalidVersion(opts.version, schemeOf(profile))` replaces the `SEMVER` test at `:369`; the advance check is `compareVersions(opts.version, current, schemeOf(profile)) <= 0`, its text unchanged. `handoffContext` makes the same replacement at `:774`.
   - `commitLines(root, profile, version)`: `compile(profile.tag, {}, true, scheme)`; a tag is dropped when `skipsPrereleases(profile, version) && isPrerelease(profile, x.m.version)`; the sort is `compareVersions(b.m.version, a.m.version, scheme)`; the rest unchanged. `skipsPrereleases = (profile, version) => Boolean(profile.prerelease) && profile.prerelease.countsAsLastRelease === false && !isPrerelease(profile, version)`. `digestLines` and `notesFromCommits` pass `ctx.version`.
   - `digestLines`: right after the `RELEASE` line, `...schemeLines(ctx)`, where `schemeLines` returns `[]` when `schemeOf(ctx.profile) === DEFAULT_SCHEME` (named or defaulted) and otherwise `[\`SCHEME ${scheme} ${isPrerelease(ctx.profile, ctx.version) ? 'prerelease' : 'stable'}\`]`.

5. **The publish step (S9, D1).** `stepLines` takes its publish step from a new `publishStep(ctx)`:

   ```js
   // FEAT-062 S9: a prerelease publishes only through prerelease.publish, and names its channel.
   function publishStep(ctx) {
     const { profile } = ctx;
     if (!isPrerelease(profile, ctx.version)) return profile.publish ? { step: profile.publish, channel: [] } : null;
     const step = profile.prerelease.publish;
     if (step === null) return null;
     return { step, channel: [`PUBLISH-CHANNEL ${step.channel}${knownPublish(step.argv) ? '' : ' unverified'}`] };
   }
   ```

   In `stepLines`, the `if (profile.publish)` block becomes `const publish = publishStep(ctx); if (publish) { … }`, with `channel: publish.step.channel` added to `values` and `...publish.channel` pushed between `PUBLISH-TARGET ${publish.step.target}` and the `STEP <n> publish` line. A stable release prints exactly FEAT-035 C9's lines (the stable `publish` cannot hold `{channel}`, decision 2).

6. **`--init` detection (S11).**
   - `VERSION_TOKEN = /^\d[0-9A-Za-z.+!-]*$/` replaces `PLAIN_SEMVER` in `jsonLocations` (`:846`, `:849`), `tomlLocation`'s pattern becomes `/^version = "(\d[0-9A-Za-z.+!-]*)"$/`, and `detectVersions`' `VERSION` test becomes `/^(\d[0-9A-Za-z.+!-]*)\r?\n?$/`. `detectVersions` also returns `currentPath: found[0]?.entry.path ?? null`; `RELEASE_INIT_VERSIONS_DISAGREE` still runs first.
   - `schemeEvidence(root, current, tagTemplate)`: the prefix is `'v'` when `detectTag` chose `v{version}`, else `''`; the evidence is `{ label: '<path> <value>', value }` for the current version, then, in `git tag --list` order, `{ label: 'tag <tag>', value: <tag without prefix> }` for each tag that starts with the prefix whose rest matches `VERSION_TOKEN`, has two or more release parts (`/^\d+(?:\.\d+)*/` split on `.`) and is accepted by at least one scheme.
   - `refuseUnsupported(current)`: no current, or a scheme accepts it → return; else `fail('RELEASE_INIT_SCHEME_UNSUPPORTED', \`${path} ${value}: fits none of ${SCHEME_LIST}\`)`, followed by ` (<scheme>: <reason>; …)` listing, in `SCHEME_LIST` order, every scheme whose reason is `near` (none: no parenthesis).
   - `detectScheme(root, current, tagTemplate)`: `refuseUnsupported`; `firstRejected(s)` is the first evidence `s` rejects; `chosen` is the first of `INIT_ORDER` with none rejected; none → `fail('RELEASE_INIT_SCHEME_CONFLICT', INIT_ORDER.map((s) => \`${s} rejects ${firstRejected(s).label}\`).join('; '))`; `chosen === DEFAULT_SCHEME` → the labels of the current version's evidence (when there is a current version) and of the first tag evidence (when there is one), as `(from <label>; <label>)` (`(from package.json 2.3.4; tag v2.3.4)`), or `'(default)'` when the evidence is empty (S11, D2); else the deduplicated labels of `firstRejected` for each scheme before `chosen` in `INIT_ORDER`, as `(from <label>; <label>)`.
   - `prereleaseProposal(publish)`: `{ publish: null, countsAsLastRelease: false }` for a `null` stable publish; for a `gh` argv `{ publish: { channel: 'prerelease', target, argv: [...argv, '--prerelease'] }, countsAsLastRelease: false }`; otherwise (`npm publish`) `{ publish: { channel: 'next', target, argv: ['npm', 'publish', '--tag', '{channel}'] }, countsAsLastRelease: false }`.
   - `proposal` rows become `versions`, `scheme`, `changelog`, `tag`, `remote`, `mainline`, `checks`, `publish`, then `['prerelease', prereleaseProposal(publish.value), '(default)']` when `SCHEMES[scheme].prereleases`. Every refusal throws before `initVerb` writes anything.

7. **The proposal file omits a default scheme.** `initVerb` prints every row, so the owner always sees the `PROPOSED scheme "MAJOR.MINOR.PATCH"` row with its evidence or `(default)` (S11, `[E2]`, D2), but writes `Object.fromEntries(rows.filter(([k, v]) => k !== 'scheme' || v !== DEFAULT_SCHEME))`. Absent means `MAJOR.MINOR.PATCH` (S1), so the confirmed profile means the same thing, and a project with plain versions gets exactly FEAT-035's profile ("plain versions keep FEAT-035's profile", S11). Init tests 12, 13 and 19 then pass on the file unmodified.

8. **Test 12 stays unmodified (D2).** Test 12 runs `--init` on `initProject()` (npm at `2.3.4`, tag `v2.3.4`) and asserts `expect(r.out).not.toContain('(default)')`. Under D2 that run prints `PROPOSED scheme "MAJOR.MINOR.PATCH" (from package.json 2.3.4; tag v2.3.4)` (decision 6), and no other row it prints changes, so the assertion holds as written and `[E6]` (every existing test passes unmodified) holds with it. The proposal file is the same bytes as FEAT-035's (decision 7). No existing test changes; the earlier narrowing of test 12 is withdrawn. The other existing init tests that assert `(default)` (13, 15, 17) assert it on their own rows (`PROPOSED <field>`, `PROPOSED tag`, `PROPOSED changelog`), never on the scheme row, so they hold too.

9. **The `[E6]` byte-identity test.** It builds two `project()` fixtures, one with `PROFILE` and one with `{ ...clone(PROFILE), scheme: 'MAJOR.MINOR.PATCH' }`, and on each runs, in order: `digest` for `1.1.0`, `digest` for `1.1.0-rc.1` (a refusal), `applyRelease` and `check`, `merge` and `handoff --version 1.1.0`. It records `{ status, out, err }` of each run and the handoff's `notes.md`, and replaces every `\b[0-9a-f]{7,40}\b` with `<sha>` before comparing: the profile blob (the `PROFILE` line) and the commit ids are the only bytes that must differ, since the two profiles are different files in different repositories. The two records must be equal, and the first must contain no `SCHEME` line.

10. **New tests in `tests/scripts/release.test.js`** (90, every title carrying `[FEAT-062]`), as four `describe` blocks inserted before `// ---- H. this repository's profile (1)` (`:1208`), with `compareVersions` added to the import at `:7`. Shared helpers at the top of the first block: `GH_ARGV` (test 14's `PUBLISH_GH`, re-declared), `NPM_NEXT = { channel: 'next', target: 'the npm registry', argv: ['npm', 'publish', '--tag', '{channel}'] }`, `GH_PRE = { channel: 'prerelease', target: 'the GitHub Release', argv: [...GH_ARGV, '--prerelease'] }`, `SCRIPT_NEXT = { channel: 'next', target: 'the demo registry', argv: ['./scripts/publish.sh', '{channel}'] }`, `pre = (publish, counts = false) => ({ publish, countsAsLastRelease: counts })`, `withScheme = (scheme, prerelease, base = PROFILE) => ({ ...clone(base), scheme, ...(prerelease === undefined ? {} : { prerelease }) })`.
    - `describe('release.mjs version schemes in the profile [FEAT-062]')`:
      - `[E1]` it.each, 7 valid rows, `validateProfile` returns the object: no `scheme`; `MAJOR.MINOR.PATCH`; `semver` + `pre(NPM_NEXT)`; `pep440` + `pre(NPM_NEXT)`; `numeric` without `prerelease`; `semver` + `pre(null)`; `semver` + `pre(NPM_NEXT, true)`.
      - `[E1]` it.each, 13 refusals, each asserting `RELEASE_PROFILE_INVALID` with its field and reason: `scheme: 'calver'` and `scheme: ['semver']` (`scheme: must be one of MAJOR.MINOR.PATCH, semver, pep440, numeric`); `semver` and `pep440` without `prerelease` (`prerelease: required by scheme <s>`); `numeric` and no scheme with `prerelease` (`prerelease: not allowed with scheme <s>`); `prerelease.extra` (`unknown key`); `countsAsLastRelease: 'no'` (`must be true or false`); channel `'a b'`; a target with `{tag}`; an empty argv; `{channel}` in the stable `publish.argv[1]` and in `tag` (`placeholder {channel} is not allowed here`).
      - `[E4]` it.each, 5 refusals of `prerelease.publish.argv`: `npm publish` alone and `npm publish --tag latest2` with channel `next` (`npm publish needs --tag {channel} or --tag <channel>`); `GH_ARGV` without `--prerelease` (`gh release create needs --prerelease`); with `--prerelease --latest` and `--prerelease --latest=true` (`gh release create must not carry --latest`).
      - `[E4]` it.each, 7 accepted argvs: `npm publish --tag {channel}`, `npm publish --tag next`, `npm publish --tag=next`, `npm publish --tag={channel}`, `GH_PRE.argv`, `GH_PRE.argv` plus `--latest=false`, `SCRIPT_NEXT.argv`.
    - `describe('release.mjs digest under each scheme [FEAT-062]')`:
      - `[E3]` it.each, 13 refusals on `project(<profile>)`, each `digest --version <v> --items FEAT-001 --date DATE` exiting 2 with `release: RELEASE_VERSION_INVALID: <v>: not a <s> version: <reason>`: semver `1.1.0+build.5` (build metadata), `1.1.0-rc.01` (identifier `01`), `1.1`, `1.1.0-` (the `far` reason); pep440 `1.1.0-rc1`, `1.1.0RC1`, `1.1.0.beta1`, `1.02` (`not in PEP 440 normal form`), `1!1.1.0` (epoch), `1.1.0+local` (local); numeric `2`, `2026.11-beta`; and explicit `MAJOR.MINOR.PATCH` with `1.1.0-rc.1` (`<v>: only MAJOR.MINOR.PATCH is supported`).
      - `[E3]` it.each, 6 accepted versions, status 0, line 1 `RELEASE <v> FROM 1.0.0 DATE <DATE>` and line 2 the `SCHEME` line: semver `1.1.0-rc.1` prerelease, `1.1.0` stable; pep440 `1.1.0rc1` and `1.1.0.dev1` prerelease, `1.0.0.post1` stable; numeric `2026.11` stable.
      - `[E3]` it.each, 5 rows refusing `RELEASE_VERSION_NOT_ADVANCED: <v> does not advance 1.0.0`: semver `1.0.0-rc.1`; pep440 `1.0`, `1.0.0rc1`; numeric `1.0.0.0`, `1.0`.
      - `[E3]` it.each, 3 precedence chains through `compareVersions(a, b, s)`, every earlier element `-1` against every later one and `1` reversed: semver `1.2.0-1 < 1.2.0-alpha < 1.2.0-alpha.1 < 1.2.0-beta < 1.2.0-rc.1 < 1.2.0-rc.10 < 1.2.0 < 1.10.0`; pep440 `1.2.0.dev1 < 1.2.0a1 < 1.2.0b2 < 1.2.0rc1 < 1.2.0 < 1.2.0.post1.dev1 < 1.2.0.post1 < 1.10`; numeric `2026.9 < 2026.10 < 2026.10.1 < 2026.11 < 2027.1`.
      - `[E3]` one test, three equalities (`0`): pep440 `1.2` / `1.2.0`, numeric `2026.11` / `2026.11.0` and `2026.01` / `2026.1`.
      - `[E6]` one test: `compareVersions('1.10.0', '1.9.0')` and with `'MAJOR.MINOR.PATCH'` are both `1`.
    - `describe('release.mjs init detects the scheme [FEAT-062]')`, 15 tests, each on a fresh repository (`fresh`, `git init -b main`, `.gitignore` `.conductor/`):
      - `i1` `package.json` and its lock at `1.2.0-rc.1`: `PROPOSED scheme "semver" (from package.json 1.2.0-rc.1)`; the `PROPOSED` fields in order `versions, scheme, changelog, tag, remote, mainline, checks, publish, prerelease`; the `prerelease` row is `(default)` and the file holds `scheme: 'semver'` and `prerelease: pre(NPM_NEXT)` (target `the npm registry`).
      - `i2` `initProject()` plus a tag `v2.4.0-rc.1`: `semver (from tag v2.4.0-rc.1)`.
      - `i3` `pyproject.toml` at `1.2.0rc1`: `pep440 (from pyproject.toml 1.2.0rc1)`, `prerelease` `pre(null)`.
      - `i4` `pyproject.toml` at `5.0`, tags `5.0` and `5.1a1`: `pep440 (from pyproject.toml 5.0; tag 5.1a1)`.
      - `i5` `VERSION` `2026.11`, tags `v2026.09`, `v2026.10`: `numeric (from VERSION 2026.11)`, no `PROPOSED prerelease` line, no `prerelease` key in the file.
      - `i6` `package.json` `1.0.0` (`private: true`) and a tag `v2026.10`: `numeric (from tag v2026.10)`.
      - `i7` `initProject()`: `PROPOSED scheme "MAJOR.MINOR.PATCH" (from package.json 2.3.4; tag v2.3.4)`, no `prerelease` line, and `'scheme' in proposalFile()` is `false` (decision 7).
      - `i8` a repository with no version file and no tag: `PROPOSED scheme "MAJOR.MINOR.PATCH" (default)` (no evidence, D2).
      - `i9` `initProject()` plus tags `v1`, `vnext`, `v2.0.0.Final`, `release-3`: still `"MAJOR.MINOR.PATCH" (from package.json 2.3.4; tag v2.3.4)`, the ignored tags named nowhere (`v1` sorts before `v2.3.4` but is not evidence).
      - `i10` it.each, 3 rows, status 2, the exact stderr line, no proposal file: `package.json` `2.0.0.Final` → `release: RELEASE_INIT_SCHEME_UNSUPPORTED: package.json 2.0.0.Final: fits none of MAJOR.MINOR.PATCH, semver, pep440, numeric`; `package.json` `1.0.0+build` → the same plus ` (semver: build metadata is not supported; pep440: a local version is not supported)`; `VERSION` `1!2.0` → plus ` (pep440: an epoch is not supported)`.
      - `i11` `package.json` `1.2.0-rc.1` and a tag `v1.2.0rc1`: status 2, `release: RELEASE_INIT_SCHEME_CONFLICT: MAJOR.MINOR.PATCH rejects package.json 1.2.0-rc.1; semver rejects tag v1.2.0rc1; numeric rejects package.json 1.2.0-rc.1; pep440 rejects package.json 1.2.0-rc.1`, no proposal file.
      - `i12` `i1`'s layout plus test 14's workflow: `prerelease.publish` is `{ channel: 'prerelease', target: 'the GitHub Release .github/workflows/pub.yml listens for', argv: [...GH_ARGV, '--prerelease'] }`.
      - `i13` `i1`'s layout: a proposal edited to drop `prerelease` makes `init --confirm` refuse `RELEASE_PROFILE_INVALID: prerelease: required by scheme semver` and write nothing; after `init` again, `init --confirm` exits 0 and writes the proposal bytes.
    - `describe('release.mjs prerelease publish and range [FEAT-062]')`:
      - `[E4]` `h1` `project(withScheme('semver', pre(NPM_NEXT)))`, `applyRelease({ v: '1.1.0-rc.1', items: ['FEAT-001'] })`, `merge`, a bound ticket, `handoff --version 1.1.0-rc.1 --pr 7`: exactly `CHECK alpha ok`, `CHECK beta ok`, `STEP 1 tag …v1.1.0-rc.1…`, `STEP 2 push git push origin v1.1.0-rc.1`, `PUBLISH-TARGET the npm registry`, `PUBLISH-CHANNEL next`, `STEP 3 publish npm publish --tag next`, the `STEP 4 writeback` line, `release: handoff ready 1.1.0-rc.1`; no `demo-publish`, no `unverified`.
      - `[E4]` `h2` the same with `pre(GH_PRE)`: `PUBLISH-CHANNEL prerelease` and `STEP 3 publish gh release create v1.1.0-rc.1 --verify-tag --title v1.1.0-rc.1 --notes-file .conductor/release/1.1.0-rc.1/notes.md --prerelease`; no `unverified`.
      - `[E4]` `h3` `pre(null)`: no `PUBLISH-TARGET`, no `PUBLISH-CHANNEL`, no `publish` step; the writeback is `STEP 3`.
      - `[E4, D1]` `h4` `pre(SCRIPT_NEXT)`: `PUBLISH-TARGET the demo registry`, `PUBLISH-CHANNEL next unverified`, `STEP 3 publish ./scripts/publish.sh next`.
      - `[E4]` `h5` a stable `1.1.0` under `withScheme('semver', pre(NPM_NEXT))`: exactly test 46's lines (the `demo-publish` step), no `PUBLISH-CHANNEL`.
      - `[E4]` `h6` it.each, 2 rows under `withScheme('pep440', pre(NPM_NEXT))`: `1.0.0.post1` prints the stable `demo-publish` step and no channel; `1.1.0.dev1` prints `PUBLISH-CHANNEL next` and `npm publish --tag next`.
      - `[E5]` it.each, 2 rows (`semver` `1.1.0-rc.1`, `pep440` `1.1.0rc1`): `check` passes the release (`release: ok <v> items FEAT-001` last), then after `merge` `handoff` exits 0, prints `STEP 1 tag git tag -a v<v> -m v<v> <sha>` and writes `notes.md` from the `<v>` changelog section.
      - `[E5]` it.each, 3 rows on `project(withScheme('semver', pre(NPM_NEXT, counts)))` with a tag `v1.1.0-rc.1` on `feat: alpha work`, then `feat: beta work` committed: `digest 1.1.0` with `counts` `false` lists `feat: beta work`, `feat: alpha work`; with `true` lists `feat: beta work`; `digest 1.1.0-rc.2` with `false` lists `feat: beta work`.
      - `[E5]` one test, `withScheme('semver', pre(NPM_NEXT), NOCLB)` (null changelog), the same tags and commits, a stable `1.1.0` released and merged: `notes.md` is `- chore: release\n- feat: beta work\n- feat: alpha work\n` (the `notesFromCommits` path passes the version).
      - `[E6]` one test, decision 9.

11. **The confirmation sentence (S9, D1) and its parity test.** In each of the four `cc-release` copies, the clause `before the \`publish\` step the question reads "this publishes to \`<PUBLISH-TARGET>\` and cannot be undone".` becomes `before the \`publish\` step the question reads "this publishes to \`<PUBLISH-TARGET>\` and cannot be undone"; when \`handoff\` printed a \`PUBLISH-CHANNEL\` line it reads "this publishes to \`<PUBLISH-TARGET>\` on channel \`<PUBLISH-CHANNEL>\` and cannot be undone", and when that line ends in \`unverified\` it reads "this publishes to \`<PUBLISH-TARGET>\` on channel \`<channel>\` as declared in the profile, not verified, and cannot be undone".` The rest of the line is unchanged, so the `[O6]` row and `[P1]` byte-identity still hold. `tests/installer/commands-parity.test.js` gains, directly after the `cc-release [FEAT-035]` block (`:674`), `describe('cc-release publish channel [FEAT-062]')` with one it.each over the four copies (`RELEASE_MIRRORS` plus the workflow and skill copies), `[E4, D1] %s names the channel in the publish confirmation, and an unverified one as declared in the profile`, asserting the three quoted questions and the phrases ``a `PUBLISH-CHANNEL` line`` and ``ends in `unverified` ``.

12. **The `.gitignore` leaf.** `!/docs/superpowers/plans/2026-11-26-feat062-release-driver-support-for-prerelease-and-non.md`, inserted after the `2026-11-26-bug092` plan leaf (`.gitignore:214`) and before the first spec leaf, its sorted position.

## Baseline (measured on this branch, HEAD 3050bd1, Node v24.22.2, git 2.43.0)

- `npx vitest run tests/scripts/release.test.js`: **151 passed | 1 skipped (152)** (the skip is the win32-only `[O8]`).
- `npx vitest run tests/installer/commands-parity.test.js`: **124 passed (124)**.
- After every change: `release.test.js` **241 passed | 1 skipped (242)** (152 + 90); `commands-parity.test.js` **128 passed (128)** (124 + 4).

---

### Task 0: Commit this plan

**Files:**
- Create: `docs/superpowers/plans/2026-11-26-feat062-release-driver-support-for-prerelease-and-non.md`
- Modify: `.gitignore`

- [X] [T-001] Create this plan file from the approved spec (the one named in the header) and the owner decisions D1 and D2. No dependency.
- [X] [T-002] `.gitignore`: insert the leaf of plan decision 12 after the `2026-11-26-bug092` plan leaf. Depends on T-001.
- [X] [T-004] Stage: `git add -u .gitignore` (tracked) and `git add -f docs/superpowers/plans/2026-11-26-feat062-release-driver-support-for-prerelease-and-non.md` (new, under the ignored `docs/superpowers/plans/`). Depends on T-002.
- [X] [T-005] Commit: `docs: plan the release driver's version schemes and prerelease publish step [FEAT-062]`. Depends on T-004.

---

### Task 1: Scheme tests first (red)

**Files:**
- Test: `tests/scripts/release.test.js`

- [X] [T-101] `tests/scripts/release.test.js`: add `compareVersions` to the import at `:7`. Depends on T-005.
- [X] [T-102] `tests/scripts/release.test.js`: leave test 12 and every other existing test unmodified (plan decision 8, D2); no edit in this step, only the check that `git diff` touches no existing `it(` body. Depends on T-101.
- [X] [T-103] `tests/scripts/release.test.js`: the four `[FEAT-062]` `describe` blocks and their helpers (plan decisions 9 and 10), before the `// ---- H.` section comment. Depends on T-102.
- [X] [T-104] Red run: `npx vitest run tests/scripts/release.test.js -t 'FEAT-062'`. Its full match set is the 90 new tests (no existing title contains `FEAT-062`). Predicted: **88 failed | 2 passed**, 152 skipped (242). The two passes are the `[E1]` row with no `scheme` and the `[E6]` `compareVersions` row, both true of the shipped driver. Then `npx vitest run tests/scripts/release.test.js -t '^release.mjs init \[FEAT-035\] 12\.'`: **1 passed** (the unmodified test 12 holds before the change). Any other split means a test is wrong: fix the test, not the prediction. Depends on T-103.

---

### Task 2: The scheme table and the validator

**Files:**
- Modify: `scripts/release.mjs`

- [X] [T-201] `scripts/release.mjs`: the version-scheme section, `compareVersions` with its scheme argument and `compareTriple`, and `refuseInvalidVersion` (plan decision 1). Depends on T-104.
- [X] [T-202] `scripts/release.mjs`: `KNOWN` gains `channel`; `checkTarget`, `checkPublishArgv`, `checkScheme`, `checkPrerelease`, `latestRisk`, `knownPublish`; `validateProfile`'s optional keys and its `checkScheme` call (plan decision 2). Depends on T-201.
- [X] [T-203] Run: `npx vitest run tests/scripts/release.test.js -t 'version schemes in the profile \[FEAT-062\]|validator and surface'`. Predicted: **the 32 `[FEAT-062]` profile rows and every validator-suite test pass**, nothing failed. Depends on T-202.

---

### Task 3: Templates, locations, digest and the range

**Files:**
- Modify: `scripts/release.mjs`

- [X] [T-301] `scripts/release.mjs`: `CAPTURE` without `version`, `compile`'s scheme argument and `scheme` field, `parseLine`'s validation, and the scheme passed by `locationValues`, `lineLocation`, `jsonLocation`, `changelogAnchor` and `sectionOf` (plan decision 3). Depends on T-203.
- [X] [T-302] `scripts/release.mjs`: `prepare` and `handoffContext` through `refuseInvalidVersion` and the scheme's order; `commitLines(root, profile, version)` with `skipsPrereleases`; `digestLines` and `notesFromCommits` passing the version; `schemeLines` (plan decision 4). Depends on T-301.

---

### Task 4: The prerelease publish step

**Files:**
- Modify: `scripts/release.mjs`

- [X] [T-401] `scripts/release.mjs`: `publishStep` and its use in `stepLines` (plan decision 5). Depends on T-302.

---

### Task 5: `--init` detects the scheme

**Files:**
- Modify: `scripts/release.mjs`

- [X] [T-501] `scripts/release.mjs`: `VERSION_TOKEN` in the three detectors, `currentPath` from `detectVersions`, `schemeEvidence`, `refuseUnsupported`, `detectScheme`, `prereleaseProposal`, the new `proposal` rows, and `initVerb`'s filtered file (plan decisions 6 and 7). Depends on T-401.
- [X] [T-502] Green run: `npx vitest run tests/scripts/release.test.js`. Predicted: **241 passed | 1 skipped (242)**. Depends on T-501.

---

### Task 6: The confirmation sentence in the four `cc-release` copies (red, then green)

**Files:**
- Test: `tests/installer/commands-parity.test.js`
- Modify: `.claude/commands/cc-release.md`
- Modify: `project-template/.claude/commands/cc-release.md`
- Modify: `project-template/.agents/workflows/cc-release.md`
- Modify: `project-template/.agents/skills/cc-release/SKILL.md`

- [X] [T-601] `tests/installer/commands-parity.test.js`: the `cc-release publish channel [FEAT-062]` block of plan decision 11, after `:674`. Depends on T-502.
- [X] [T-602] Red run: `npx vitest run tests/installer/commands-parity.test.js -t 'FEAT-062'`. Its full match set is the 4 new rows. Predicted: **4 failed**, 124 skipped (128). Depends on T-601.
- [X] [T-603] `.claude/commands/cc-release.md` (Edit tool): the Handoff step 3 sentence of plan decision 11. Depends on T-602.
- [X] [T-604] `project-template/.claude/commands/cc-release.md`, `project-template/.agents/workflows/cc-release.md`, `project-template/.agents/skills/cc-release/SKILL.md`: the same replacement, byte-identical. Depends on T-603.
- [X] [T-605] Green run: `npx vitest run tests/installer/commands-parity.test.js`. Predicted: **128 passed (128)**. Depends on T-604.

---

### Task 7: Full suite, scope check and commit

**Files:**
- Modify: `docs/superpowers/plans/2026-11-26-feat062-release-driver-support-for-prerelease-and-non.md` (ticks)

- [X] [T-701] Run `npm test` (long: run it in the background if the shell times out). Predicted: exit 0, with `tests/scripts/release.test.js` at **241 passed | 1 skipped** and `tests/installer/commands-parity.test.js` at **128 passed**. A red is called ENV only if the sandbox caused it (network, tmp permissions) and its file is not one this plan touches; report it with its name. Any other red is fixed. Depends on T-605.
- [X] [T-702] Scope check: `git status --short` lists exactly the seven files of the Global Constraints and this plan; no temporary file is left in the tree. `git diff --stat` shows no change since Task 0 to the FEAT-062 spec, `scripts/orchestrate.mjs`, `.claude/release-profile.json`, the hooks, the installer, `.github/workflows/`, `.github/actions/` or any record. Depends on T-701.
- [X] [T-703] Stage: `git add -u scripts/release.mjs tests/scripts/release.test.js tests/installer/commands-parity.test.js .claude/commands/cc-release.md project-template/.claude/commands/cc-release.md project-template/.agents/workflows/cc-release.md project-template/.agents/skills/cc-release/SKILL.md` (all tracked). Depends on T-702.
- [X] [T-704] Stage: `git add -u docs/superpowers/plans/2026-11-26-feat062-release-driver-support-for-prerelease-and-non.md` (carries the ticks for T-101 to T-703). Depends on T-703.
- [X] [T-705] Commit: `feat: release driver version schemes and a prerelease publish step that never moves latest [FEAT-062]`. Depends on T-704.

---

## Test List

- [X] [T-801] `tests/scripts/release.test.js` (Task 1), `[E1]`: the 7 valid and 13 refused profile rows (plan decision 10).
- [X] [T-802] `tests/scripts/release.test.js` (Task 1), `[E2]`: init tests `i1` to `i13` (15 tests), with `i7` to `i9` pinning D2's evidence and `(default)` rows; test 12 unmodified (plan decision 8).
- [X] [T-803] `tests/scripts/release.test.js` (Task 1), `[E3]`: 13 refusals, 6 accepted versions with their `SCHEME` line, 5 non-advances, 3 precedence chains and the equality test.
- [X] [T-804] `tests/scripts/release.test.js` (Task 1), `[E4]` and D1: the 5 refused and 7 accepted prerelease argvs, handoff `h1` to `h6` (7 tests), including `PUBLISH-CHANNEL next unverified`.
- [X] [T-805] `tests/scripts/release.test.js` (Task 1), `[E5]`: the 2 check-and-handoff rows, the 3 range rows and the null-changelog notes test.
- [X] [T-806] `tests/scripts/release.test.js` (Task 1), `[E6]`: the byte-identity test (plan decision 9), the default `compareVersions` row, and every existing test unmodified, test 12 included (D2).
- [X] [T-807] `tests/installer/commands-parity.test.js` (Task 6), `[E4]` and D1: the 4 rows over the four `cc-release` copies; the existing `[P1]` and `[O6]` rows keep the mirrors byte-identical.
- [X] [T-808] No E2E/UI test: there is no UI. `orchestrate.mjs envelope release` reaches the new keys only through `loadProfile`, whose validator the `[E1]` rows pin, so no orchestrate test is added. CI legs: no new test is conditionally skipped, so no leg's skipped set in `tools/skip-baseline.json` changes.

## Commit Order

1. Task 0 (T-005): this plan and its `.gitignore` leaf.
2. Task 7 (T-705): the script, both test files, the four command copies and the plan ticks for T-101 to T-703, in one commit, so no commit has a red suite. The red runs (T-104, T-602) happen in the working tree before each change. The ticks for T-704, T-705 and the Test List ride the closeout commit.

## Identified Risks

- **Test 12 under D2** (plan decision 8). The scheme row must carry evidence for plain versions, or test 12's unmodified `not.toContain('(default)')` turns red. Caught at T-104 (test 12 green before the change) and T-502 (green after), and pinned by `i7` and `i9`.
- **Regex backtracking in a template whose `{version}` is followed by `-`** (`{version}-{date}` under `semver`): the capture may stop at a shorter prefix. The match is still validated by the scheme (`parseLine`), and a template that matches no line or two lines refuses `RELEASE_PROFILE_AMBIGUOUS`, as today; never a silent wrong value.
- **Large numeric identifiers** (beyond 2^53) compare through `Number` and may tie. No real version does this; the precedence tests use small values.
- **`npm publish` with two `--tag` flags** (`--tag next --tag latest`): S6 checks that the channel's `--tag` is present, not that no other is. Out of scope (S6 verifies the accident the entry names); the confirmation still names the declared channel.
- **The init detectors now read non-plain values**, so a project whose `package.json` holds `1.0.0-beta` gets a `semver` proposal where FEAT-035 proposed no version location. That is the feature; projects with plain values get FEAT-035's proposal unchanged (tests 12-23).
- **Function length.** `parsePep440`, `detectScheme` and `stepLines` are the longest; each stays under 30 lines by keeping the helpers of decisions 1 and 6 separate.
- **The long suite timing out the shell.** T-701 notes the duration; a timeout is not a red.
