# BUG-088: Installer prints the OpenCode plugin symlink target to stderr without escaping control characters

**Status:** Draft (pending independent review)
**Item:** BUG-088 (intake of issue #265; follow-up of BUG-087)
**Date:** 2026-11-20

## Problem

Since BUG-087, when `code-conductor --project --opencode` finds a symbolic link at `.opencode/plugin/conductor-guard.js`, `removePluginSymlink` (`lib/installer/deploy.mjs:248-262`) removes the link and warns on stderr:

```
code-conductor: replaced the symlink at .opencode/plugin/conductor-guard.js (it pointed to <linkText>) with the shipped plugin; the file it pointed to was not touched
```

`<linkText>` is the result of `readlinkSync(pluginPath)` (`lib/installer/deploy.mjs:253`), interpolated verbatim at `lib/installer/deploy.mjs:260`. The link text comes from the checkout, so its author controls it. On POSIX a link target is an arbitrary byte string except NUL, so it can carry ANSI escape sequences (`ESC [ 2K`, `ESC [ 1A`, colors), carriage returns or newlines.

Impact, per the entry: the installer's terminal output can be spoofed or partly hidden, for example by erasing the warning line itself or printing a forged success line. It does not execute code or write files, and it needs a crafted checkout plus `--opencode`. The warning exists to tell the user that a link was removed and what it pointed to; a crafted target can make that exact warning disappear.

## Solution

Render the link text with control characters made visible before it is interpolated into the warning. A small module-local function in `lib/installer/deploy.mjs`, `escapeControlChars(text)`, replaces every character in the ranges U+0000–U+001F, U+007F and U+0080–U+009F with a `\xHH` escape (two lowercase hex digits, e.g. ESC becomes the four visible characters `\x1b`, a newline becomes `\x0a`). `removePluginSymlink` passes `linkText` through it at the point of interpolation. All other characters, including printable non-ASCII and backslashes, pass through unchanged, so an ordinary target prints exactly as today.

**Choice the entry leaves open, and the one taken: `\xHH` replacement, not `JSON.stringify(linkText)`.** Reasons:

- An ordinary link target keeps today's exact warning text. The two BUG-087 tests (`tests/installer/deploy.test.js:737` and `:752`) assert the warning with the raw `${linkText}`, and they still pass unchanged; `JSON.stringify` would add surrounding quotes and double every backslash, which changes the message for every user and makes Windows-style targets (`C:\dir\file.js`) harder to read.
- One uniform escape form covers every control character. `JSON.stringify` prints `\n`, `\r`, `\t` for some and `\u001b` for others, and it leaves U+007F and the C1 range raw.
- **C1 (U+0080–U+009F) is included**, beyond the entry's `[\x00-\x1f\x7f]` example. U+009B is the single-character CSI, which some terminals interpret like `ESC [`; leaving it raw would leave the same spoofing open on those terminals. Including it costs nothing for real paths.

**Backslash is not escaped.** The goal is terminal integrity, not a reversible encoding: a target that literally contains the text `\x1b` prints the same as one containing ESC, but neither can move the cursor or hide output. Escaping `\` would change the display of every Windows-style target for no safety gain.

**Why a local function and not a shared helper:** this warning is the only installer message that interpolates checkout-controlled text without quoting (the flow-status message at `lib/installer/deploy.mjs:218` already uses `JSON.stringify`). One call site does not justify a shared module.

## Behavior

### Main path

1. `deployProject(..., { opencode: true })` calls `installOpencodePlugin`, which calls `removePluginSymlink` as today.
2. `lstatSync` reports a symbolic link; `readlinkSync` returns its text, e.g. `x\x1b[2K\rcode-conductor: all good`.
3. `unlinkSync` removes the link as today.
4. The warning is emitted with `escapeControlChars(linkText)`: `… (it pointed to x\x1b[2K\x0dcode-conductor: all good) with the shipped plugin; …`, where every `\x..` is literal visible text. The stderr line contains no raw byte in U+0000–U+001F, U+007F or U+0080–U+009F other than the trailing newline `toStderr` appends.
5. The plugin is installed as today; stdout reports `installed the OpenCode guard plugin`.

### Alternative paths

- **Ordinary target** (no control characters, e.g. `/home/u/dotfiles/guard.js` or `../shared/guard.js`): the warning is byte-for-byte what BUG-087 prints today.
- **Unreadable target** (`readlinkSync` throws, link raced away): the fallback text `an unreadable target` has no control characters and prints unchanged.
- **Printable non-ASCII target** (e.g. `/home/usuario/código.js`): unchanged; only the listed control ranges are escaped.
- **No link at the path, or `--opencode` absent:** no warning is printed; nothing changes.

### Error cases

- **The link cannot be removed** (`unlinkSync` throws): the skip warning at `lib/installer/deploy.mjs:257` does not include the link text and is unchanged; the escaping only applies to the replaced-link warning.
- `escapeControlChars` cannot throw on a string; `readlinkSync` always returns a string here (no `encoding: 'buffer'`).

## Acceptance Criteria

Answering the entry's fix shape ("render the link text with control characters escaped before interpolating it … add a test whose link target contains an escape character and assert the warning has no raw control bytes"):

- [ ] AC1 — With a symlink at `.opencode/plugin/conductor-guard.js` whose target text contains ESC (`\x1b`), a carriage return and a newline, `deployProject(..., { opencode: true })` emits exactly one warning, and that warning contains no character matching `/[\x00-\x1f\x7f-\x9f]/`. (POSIX only: the test is skipped where symlinks with such names cannot be created, as with `CAN_SYMLINK` / `process.platform !== 'win32'`.)
- [ ] AC2 — In the same test, the warning shows the escaped text visibly: it contains `\x1b`, `\x0d` and `\x0a` as literal characters, and otherwise equals the BUG-087 message with the escaped link text in place of the raw one.
- [ ] AC3 — The link is still replaced by a regular file with the shipped bytes and stdout still reports the install (BUG-087 behavior holds for a crafted target).
- [ ] AC4 — The existing BUG-087 tests at `tests/installer/deploy.test.js:723`, `:743` and `:755` pass unchanged: an ordinary target prints exactly as before.
- [ ] AC5 — A unit-level assertion (through the same warning, with a target containing U+009B) shows C1 characters are escaped too (`\x9b`), and a printable non-ASCII character in the target is left as is.
- [ ] AC6 — `npm test` passes.

## Out of Scope

- Escaping other installer messages. The other warnings interpolate installer-owned constants, error codes, or already `JSON.stringify` the host value (`lib/installer/deploy.mjs:218`). Paths the installer prints elsewhere (backup paths, `cwd`) are not covered by this entry.
- Unicode format characters such as bidirectional overrides (U+202A–U+202E, U+2066–U+2069). They can reorder how a line looks but cannot erase lines or move the cursor; the entry asks for control characters.
- Any change to what BUG-087 does with the link (remove, never follow) or to the skip path.
- A shared output-sanitizing helper for the CLI.

## System Impact

- `lib/installer/deploy.mjs` (protected surface: the installer) — add `escapeControlChars` next to `removePluginSymlink` and use it at the interpolation on line 260. No change to exports, flags, files written or exit codes.
- `tests/installer/deploy.test.js` — add one or two `[BUG-088]` cases in the OpenCode plugin `describe` block (around line 723), reusing `PLUGIN_REL`, `PLUGIN_DIR`, `capture()`, `SHIPPED` and `INSTALLED`, guarded like the BUG-087 symlink tests plus a POSIX guard.
- No new dependency, no network, no change to installed permissions or settings.

### Files Requiring Full Read (deferred to /cc-plan)

- `lib/installer/deploy.mjs` — the spec read lines 230-290 around the call site; /cc-plan confirms there is no other interpolation of `linkText`.
- `tests/installer/deploy.test.js` — the plan needs the OpenCode `describe` block's setup (`home`, `asset`, `capture`, `PLUGIN_DIR`, `SHIPPED`, `INSTALLED`) around lines 650-780.

## Complexity Estimate

S — one local pure function, one changed interpolation, and one or two tests in an existing block.
