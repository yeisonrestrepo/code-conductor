# Recording script: the deny to adapt to allow arc

**Capture tooling is not available in the environment this script was written in.** `asciinema`, `vhs` and `ttyrec` are all absent, so this is the exact command sequence for you to record locally, with the real output annotated beside each step.

**Every output block below was produced by actually running the step**, against a scaffolded project's own hook rather than this repository's, so what you record is what a user gets.

## Before you start

```bash
brew install asciinema          # or: brew install charmbracelet/tap/vhs
```

`vhs` is the better choice if you want a GIF without a conversion step: it takes a `.tape` file and emits `.gif` directly. `asciinema` produces a `.cast` which is smaller, embeddable and copy-pasteable, and `agg` converts it to GIF if you need one.

Set the terminal to **90 columns** before recording. The deny message wraps badly below that, and the wrap is the first thing a viewer's eye lands on.

## Setup, off camera

Do this **before** you hit record. It is not part of the arc and its output is the known-false-positive warning, which needs a footnote rather than a frame.

```bash
mkdir /tmp/cc-demo && cd /tmp/cc-demo
git init -q
npm init -y >/dev/null
mkdir -p src && printf 'export const x = 1;\n' > src/index.ts
npx @yeison.restrepo.r/code-conductor --project
```

## The arc, on camera

Three scenes, one take, no editing. Type them; do not paste. The pauses matter more than the speed.

### Scene 1: the guard denies, and says what to do instead

```bash
cat *.ts
```

**Real output:**

```
BASH SCAN BLOCKED. The command triggered a mass content-dump pattern. Pattern ids: P4.
Authorized alternatives: 1. Grep for targeted content search with file and pattern scope.
2. Glob for path listing without file content. 3. Read with an explicit offset and limit.
A permanent exception is operator policy, not a self-serve step: entries live in
.claude/memory/bash-scan-allowlist.txt, are reviewed in git, and an agent may propose one
but must not add it to clear its own denial.
```

**What to let land:** the message names the pattern id, names three alternatives, and says the allowlist is operator policy that an agent may propose but must not self-serve. That last clause is the point of the scene. Hold two seconds.

### Scene 2: the decomposed form runs

```bash
grep -n 'export' src/index.ts
```

**Real output:**

```
1:export const x = 1;
```

The hook prints nothing. **That silence is the scene** — the guard is not a mode you fight, it is a boundary you step around once and then forget.

### Scene 3: a heredoc file write with a body full of metacharacters

```bash
cat > probe.mjs <<'SCRIPT'
const RE = /^### \[.\] \[(BUG)-(\d{3,})\]/;
const n = process.argv[2] ?? 0;
for (const line of lines) { rows.forEach((r) => r.id); }
SCRIPT
```

**Real output:** nothing from the hook. The file is written.

**What to let land:** this exact shape, a character class plus a `??` plus a `for...of`, was denied under **P4 P5 P9 at once** in four consecutive working sessions before `1.33.0`. The scene is only meaningful if the viewer knows that, so the caption carries it rather than the terminal.

### Optional scene 4: the guard still says no when it should

If the take has room, this is the strongest closing beat, because it shows the fix did not simply widen the hole.

```bash
cat *.ts; cat > out.txt <<'EOF'
prose
EOF
```

**Real output:** denied, `P4`. A genuine dump beside a heredoc is still a genuine dump.

## Captions to burn in, if the format allows

1. `Guard 3 denies mass content dumps, and names the alternative.`
2. `Decompose once. Then forget it exists.`
3. `Writing a file is not reading one. It took four sessions and a sixth scanner state to teach it that.`
4. `The fix did not widen the hole.`

## Verification before you publish

Re-run the arc against the scaffolded project and confirm the three verdicts, so the recording cannot drift from the shipped behavior:

```bash
node tools/id-ceiling.mjs        # sanity: the repo you recorded from is the repo you ship
npm test                          # 996 passed / 12 skipped at 1.33.0
```

If scene 3 ever denies again, **do not re-record around it.** That is a regression and the corpus row `heredoc: mjs script body with regex class` will have gone red first.
