# Flow viewer probes (#57)

Proofs of concept for the flow viewer candidate. Spec and plan are in PR #81. These scripts measure; they assert nothing, ship nothing, and vitest does not collect them (no `.test.js` suffix). Nothing here modifies the shipped hook: `patched-hook.mjs` splices a candidate emitter into a temporary copy.

| Script | Answers |
|---|---|
| `append-race.mjs` | R1 and D7: do parallel appends tear lines, and does the unlocked tmp-and-rename rotation survive parallel hook processes? |
| `hook-bench.mjs` | Emitter cost on the real hook, the D5 event shape, AC2 fail-open, AC9 secret handling, rotation behind a lock file |
| `viewer-probe.mjs` | D1 viewer side: parse cost by event count, and what one torn line does to a `<script>`-loaded file |
| `viewer-prototype.html` + `screenshot.mjs` | What the D3 lanes look like, fed by real events from the patched hook, opened from `file://` |
| `hook-edge-cases.mjs` | 16 emitter edge cases, PASS/FAIL: opt-out, no `.claude/`, unparseable payload, unknown tool, secrets, `</script>`, caps, unicode, torn tail, fresh and stale locks |
| `cc-flow-mod/` | **Interactive CLI view.** A Claude Code mod that adds a band above the prompt: one line by default, expanded or collapsed with `e` (after ctrl+x tab) or `/cc-flow`. It stays hidden while there are no events. 7 tests (`claude plugin test tests/probes/flow-viewer/cc-flow-mod`) on the terminal and desktop surfaces. Try it with `claude --plugin-dir tests/probes/flow-viewer/cc-flow-mod`. |
| `flow-cli.mjs` | The same views from a plain terminal: full view, `--band [--expanded]` (the mod's rows as text), `--line`, `--watch` |
| `edge-visual.mjs` | Screenshots of the viewer's edge cases and of the CLI view, over the Chrome DevTools Protocol, into `shots/` |
| `sample-session.mjs` | The 12-call session the screenshot probes drive through the hook |

Run any of them with `node tests/probes/flow-viewer/<script>.mjs`.

## Results, 2026-10-16

Windows 11, Node v24.16.0, 8 cores, NTFS, Chrome and Edge headless. macOS, Linux, Firefox and Safari were not measured.

- **Appends do not tear.** 0 torn lines from 16 processes × 500 appends, nor from 64 KiB lines.
- **D7 rotation as written fails under concurrency.** The unlocked rename hits `EPERM` on Windows: 11 to 200 errors per run at the 160 KiB cap. At a 16 KiB cap: 6,366 errors and 44 s, because the file stays over the cap and every call retries the rotation.
- **A `wx` lock file fixes it.** 960 parallel hook calls: 0 errors, 0 torn lines, 0 leftover files.
- **One torn line blanks the viewer.** 500 good lines followed by one torn line load as 0 events in both browsers.
- **Hook cost is in the noise.** p50 changes by 0 to +3 ms on a 57 to 73 ms baseline. The hook grows from 806 to 850 lines.
- **Viewer parse cost:** 1.3 ms at 500 events, 8 ms at 5,000, 77 ms at 50,000.
- **Fail-open (AC2) holds.** Output is byte-identical to a `CC_FLOW_OFF` run on an allow, a deny and an ask. A Bearer token in a Bash command leaves only `curl` in the file.
- **Pulling `code` out of the reason text is fragile.** Guard 2's ask yields `ALREADY`.

### Edge cases, first run, and what changed in the candidate emitter

Three of the 16 failed against the emitter as the spec describes it. Each is now fixed in `patched-hook.mjs`, and all 16 pass.

- **Secret in an env assignment.** "First word" recorded `TOKEN=sk-...` from `TOKEN=sk-... curl`. Leading `VAR=value` words are now skipped. **Spec D5/AC9 need the same rule.**
- **Stale lock.** A hook that dies mid-rotation leaves its lock behind, and the file then grows without bound (2,003 lines at a 1 KiB cap). A lock older than 10 s is now broken.
- **Torn tail.** The next append fuses onto a torn last line, and the viewer stays blind until rotation. Each call now checks the file's last byte (one 1-byte read), and rotation drops lines that do not parse, so the next call repairs the file.

These changes add 20 lines to the emitter: 806 to 870 in total, against the spec's estimate of about 40. Hook p50 is still inside the noise.
