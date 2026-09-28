// The Guard 3 corpus, converted once from the inline cases that lived in
// tests/hooks/guard3.test.js. Data only: no assertions, no spawning. Two subjects
// consume it, the frozen bash authority and the shipped .mjs port, and both must
// return the same verdict for every row. Rows are in the order of the original
// describe blocks so a reviewer can diff the conversion against git history.
//
// verdict: 'deny'  the guard must block this command
//          'allow' the guard must let it through
// toolName defaults to 'Bash'; the one 'Read' row proves the guard does not fire
// for another tool. allowlist, when present, is written to
// .claude/memory/bash-scan-allowlist.txt in the spawn's cwd, one entry per line.

export const CORPUS = [
  // sanity
  { label: 'empty command passes', command: '', verdict: 'allow' },
  { label: 'Read tool bypasses Guard 3', command: '', toolName: 'Read', verdict: 'allow' },

  // preprocessing: line continuation
  { label: 'continuation joined: cat over two lines', command: 'cat \\\n*.ts', verdict: 'deny' },
  { label: 'even backslashes: not joined', command: 'ls\\\\\ncat *.ts', verdict: 'deny' },
  { label: 'CRLF continuation normalised', command: 'cat \\\r\n*.ts', verdict: 'deny' },

  // preprocessing: comment stripping
  { label: 'unquoted hash stripped; cat *.ts blocked', command: 'cat *.ts # safe comment', verdict: 'deny' },
  { label: 'hash in double quotes is literal', command: 'grep "#pat" file.txt', verdict: 'allow' },
  { label: 'hash in single quotes is literal', command: "grep '#pat' file.txt", verdict: 'allow' },
  { label: 'backslash-hash in UNQUOTED is literal', command: 'grep \\#pat file.txt', verdict: 'allow' },

  // P1: find without/wrong depth
  { label: 'find . (no depth)', command: 'find .', verdict: 'deny' },
  { label: 'find -maxdepth 2', command: 'find src/ -maxdepth 2', verdict: 'deny' },
  { label: 'find --maxdepth=5', command: 'find / --maxdepth=5', verdict: 'deny' },
  { label: 'find -maxdepth 1 passes', command: 'find . -maxdepth 1', verdict: 'allow' },
  { label: 'find --maxdepth=1 passes', command: 'find . --maxdepth=1', verdict: 'allow' },
  { label: 'find -maxdepth +1 (+ stripped)', command: 'find . -maxdepth +1', verdict: 'allow' },
  { label: 'find -maxdepth +2 blocked', command: 'find . -maxdepth +2', verdict: 'deny' },
  { label: 'findall not triggered (word-boundary)', command: 'findall . -maxdepth 5', verdict: 'allow' },

  // P2: find -exec content dump
  { label: 'find -exec cat', command: 'find . -exec cat {} \\;', verdict: 'deny' },
  { label: 'find -execdir grep', command: 'find . -maxdepth 1 -execdir grep -r . {} \\;', verdict: 'deny' },
  { label: 'find -ok sh -c', command: "find . -ok sh -c 'cat {}' \\;", verdict: 'deny' },
  { label: 'find -exec echo (not a reader)', command: 'find . -maxdepth 1 -exec echo {} \\;', verdict: 'allow' },

  // P3: xargs + viewer
  { label: 'xargs cat', command: 'ls | xargs cat', verdict: 'deny' },
  { label: 'xargs -0 less', command: 'find . | xargs -0 less', verdict: 'deny' },
  { label: 'xargs -I {} cat {}', command: 'xargs -I {} cat {}', verdict: 'deny' },
  { label: 'xargs -d - cat (bare - consumed)', command: 'xargs -d - cat', verdict: 'deny' },
  { label: 'xargs -d -- cat (-- consumed)', command: 'xargs -d -- cat', verdict: 'deny' },
  { label: 'xargs -d -x cat (-x not consumed)', command: 'xargs -d -x cat', verdict: 'deny' },
  { label: 'xargs -i boolean (no extra token)', command: 'xargs -i cat', verdict: 'deny' },
  { label: 'xargs sh (shell interpreter)', command: 'find . | xargs sh -c cat', verdict: 'deny' },
  { label: 'xargs echo (not a reader)', command: 'ls | xargs echo', verdict: 'allow' },

  // P4: cat + glob
  { label: 'cat *.md', command: 'cat *.md', verdict: 'deny' },
  { label: 'cat src/**/*.ts', command: 'cat src/**/*.ts', verdict: 'deny' },
  { label: 'cat dir/??.sh', command: 'cat dir/??.sh', verdict: 'deny' },
  { label: 'cat {a,b}.ts', command: 'cat {a,b}.ts', verdict: 'deny' },
  { label: 'cat [abc].md', command: 'cat [abc].md', verdict: 'deny' },
  { label: "cat '*.md' (quoted passes)", command: "cat '*.md'", verdict: 'allow' },
  { label: 'cat "*.ts" (quoted passes)', command: 'cat "*.ts"', verdict: 'allow' },
  { label: 'cat \\*.ts (escaped passes)', command: 'cat \\*.ts', verdict: 'allow' },
  { label: 'cat \\\\*.ts (double-bs blocks)', command: 'cat \\\\*.ts', verdict: 'deny' },
  { label: '/bin/cat *.md (path-invoked)', command: '/bin/cat *.md', verdict: 'deny' },
  { label: 'concatenate *.md (word boundary)', command: 'concatenate *.md', verdict: 'allow' },

  // P5: cmd-subst + reading
  { label: 'cat $(ls)', command: 'cat $(ls)', verdict: 'deny' },
  { label: 'cat with backtick', command: 'cat `ls`', verdict: 'deny' },
  { label: 'cat src/$(dir)/main.ts (prefix)', command: 'cat src/$(dir)/main.ts', verdict: 'deny' },
  { label: 'cat $(root)/pkg.json (exempt)', command: 'cat "$(git rev-parse --show-toplevel)"/package.json', verdict: 'allow' },

  // P6: grep match-all
  { label: "grep -r '.*' .", command: "grep -r '.*' .", verdict: 'deny' },
  { label: "egrep -R '' .", command: "egrep -R '' .", verdict: 'deny' },
  { label: "git grep '.*'", command: "git grep '.*'", verdict: 'deny' },
  { label: "git grep '' (empty)", command: "git grep ''", verdict: 'deny' },
  { label: "grep -r -F '.*' (fixed-strings)", command: "grep -r -F '.*' .", verdict: 'allow' },
  { label: "grep -r -e foo -e '.*' .", command: "grep -r -e foo -e '.*' .", verdict: 'deny' },
  { label: "grep -r --regexp='.*' .", command: "grep -r --regexp='.*' .", verdict: 'deny' },
  { label: 'grep -r pattern src/ (targeted)', command: 'grep -r pattern src/', verdict: 'allow' },

  // P7: pager + glob
  { label: 'less *.ts', command: 'less *.ts', verdict: 'deny' },
  { label: 'head *.log', command: 'head *.log', verdict: 'deny' },
  { label: "awk '{p}' *.ts", command: "awk '{p}' *.ts", verdict: 'deny' },
  { label: 'sed -n p *.md', command: 'sed -n p *.md', verdict: 'deny' },
  { label: "less 'file.ts' (quoted passes)", command: "less 'file.ts'", verdict: 'allow' },

  // P8: ls -R
  { label: 'ls -R .', command: 'ls -R .', verdict: 'deny' },
  { label: 'ls -laR', command: 'ls -laR', verdict: 'deny' },
  { label: 'ls --recursive src/', command: 'ls --recursive src/', verdict: 'deny' },
  { label: 'ls -l (no R)', command: 'ls -l .', verdict: 'allow' },
  { label: 'rsync -R (not ls)', command: 'rsync -R src/ dest/', verdict: 'allow' },

  // P9: shell loop
  { label: 'for f in *.ts', command: 'for f in *.ts; do cat $f; done', verdict: 'deny' },
  { label: 'while true', command: 'while true; do less $f; done', verdict: 'deny' },
  { label: 'until false', command: 'until false; do grep -r . ; done', verdict: 'deny' },
  { label: 'for loop non-reader body blocked', command: 'for f in *.ts; do wc -l $f; done', verdict: 'deny' },
  { label: 'grep ... while_loop.ts (arg)', command: 'grep -r pat while_loop.ts', verdict: 'allow' },
  { label: 'cat for (literal filename passes)', command: 'cat for', verdict: 'allow' },

  // P10: mapfile / readarray
  { label: 'mapfile -t arr', command: 'mapfile -t arr < src/main.ts', verdict: 'deny' },
  { label: 'readarray lines', command: 'readarray lines < *.log', verdict: 'deny' },

  // P11: eval / source / dot
  { label: 'eval cat', command: 'eval "cat *.ts"', verdict: 'deny' },
  { label: 'source dump.sh', command: 'source dump.sh', verdict: 'deny' },
  { label: '. dump.sh (dot operator)', command: '. dump.sh', verdict: 'deny' },
  { label: './script.sh (path, not dot op)', command: './script.sh', verdict: 'allow' },

  // P12: alias remapping
  { label: 'alias c=cat', command: "alias c='cat'", verdict: 'deny' },
  { label: 'alias g=grep', command: "alias g='grep -r'", verdict: 'deny' },
  { label: 'alias e=echo (not a reader)', command: "alias e='echo'", verdict: 'allow' },

  // obfuscation detection
  { label: '$"cat" prefix blocked', command: '$"cat" *.ts', verdict: 'deny' },
  { label: "c'a't (internal quote)", command: "c'a't *.ts", verdict: 'deny' },

  // multi-line scripts
  { label: 'cat glob on line 2', command: 'echo start\ncat *.ts', verdict: 'deny' },
  { label: 'all safe', command: 'ls -l .\necho done', verdict: 'allow' },
  { label: 'for loop on line 2', command: 'echo prep\nfor f in *.ts; do echo $f; done', verdict: 'deny' },
  { label: 'continuation joins cat', command: 'cat \\\n*.ts', verdict: 'deny' },
  { label: 'find continuation valid', command: 'find . \\\n-maxdepth 1', verdict: 'allow' },

  // nested subshells and process substitution
  { label: 'echo $(cat *.ts)', command: 'echo $(cat *.ts)', verdict: 'deny' },
  { label: 'echo $(git log)', command: 'echo $(git log --oneline)', verdict: 'allow' },
  { label: 'sort < <(cat *.ts)', command: 'sort < <(cat *.ts)', verdict: 'deny' },
  { label: 'x=$((1+2)) safe', command: 'x=$((1+2)); echo $x', verdict: 'allow' },
  { label: "wc -l $(grep -r '.*' .)", command: "wc -l $(grep -r '.*' .)", verdict: 'deny' },

  // edge cases: quote/escape combinations
  { label: 'double-backslash-star glob', command: 'cat \\\\*.ts', verdict: 'deny' },
  { label: 'single-backslash-star safe', command: 'cat \\*.ts', verdict: 'allow' },
  { label: "ansi-c: $'cat' arg is fine", command: "echo $'cat'", verdict: 'allow' },
  { label: 'single-quote: backslash then quote', command: "grep 'can'\\''t' file", verdict: 'allow' },
  { label: 'nested-quote: outer-dq inner-sq', command: "grep \"it'\\''s fine\" file", verdict: 'allow' },
  { label: 'json escape: embedded quote', command: 'echo "hello \\"world\\""', verdict: 'allow' },
  { label: 'regex: grep -r specific-re', command: 'grep -r "fo[o]" src/', verdict: 'allow' },
  { label: 'path-looking: dot in path is allowed', command: 'grep -r pattern src/main.ts', verdict: 'allow' },
  { label: 'length: 8192-char command passes', command: '#'.repeat(8192), verdict: 'allow' },
  { label: 'length: 8193-char command blocked', command: '#'.repeat(8193), verdict: 'deny' },
  { label: 'malformed: unclosed single quote', command: "cat '*.ts", verdict: 'deny' },
  { label: 'malformed: unclosed double quote', command: 'grep -r "pat .', verdict: 'deny' },

  // allowlist
  { label: 'docs/ permits glob in docs/', command: 'cat docs/*.md', allowlist: ['docs/'], verdict: 'allow' },
  { label: 'does NOT permit unrelated path', command: 'cat src/*.ts', allowlist: ['docs/'], verdict: 'deny' },
  { label: 'trailing-comment bypass blocked', command: 'cat *.ts # docs/', allowlist: ['docs/'], verdict: 'deny' },
  { label: 'path-traversal rejected', command: 'cat docs/../../etc/*.conf', allowlist: ['docs/'], verdict: 'deny' },
  { label: 'exact match (no trailing slash)', command: 'cat file.ts', allowlist: ['file.ts'], verdict: 'allow' },
  { label: 'substring not matched (docs vs doc_files)', command: 'cat doc_files/*.ts', allowlist: ['docs/'], verdict: 'deny' },

  // These three are real commands this repository's own agent ran on 2026-09-27 and
  // Guard 3 denied. They were filed as KNOWN-FP rows asserting the verdict of the
  // day, to be flipped only by a refinement that predicted the red state first.
  // [BUG-041] did exactly that, and the first two are now the flip it produced.
  //
  // P7-1 and P7-2 fired with NO glob character present. The walk sliced the
  // after-text by the match LENGTH rather than from the match index, shaving 7
  // characters off the FRONT per iteration until the after-text began inside a
  // quoted region; g3Scan('glob', ...) then ended in DOUBLE_QUOTED / SINGLE_QUOTED
  // and its fail-closed clause reported a glob that was never in the command.
  // P7-1 took 8 leftward iterations to get there, P7-2 took 23. The walk now slices
  // from the end of the match in both subjects, so these two rows pin the CORRECTED
  // contract rather than a tolerated defect. Flipping them was measured before it
  // was written: 24 of 47 real denials moved, and of 118 corpus rows exactly these
  // two. P9-1 below did not move, and says why.
  { label: 'KNOWN-FP P7-1: grep then sed with a quoted echo between', command: 'cd /Users/yeison/Projects/code-conductor && grep -n "seedMemoryFile" -r lib bin tests && echo "=== changelog head ===" && sed -n \'1,30p\' CHANGELOG.md', verdict: 'allow' },
  { label: 'KNOWN-FP P7-2: multi-line cleanup piping into tail', command: 'cd /Users/yeison/Projects/code-conductor\ngit branch -d fix/bug-039-installer-host-owned-state 2>&1 | tail -3\ngit remote prune origin 2>&1 | tail -3\nprintf \'=== status ===\\n\'\ngit status --porcelain\nprintf \'=== suite on merged main ===\\n\'\nnpx vitest run 2>&1 | tail -5', verdict: 'allow' },
  // P9-1 involves no walk at all, which is why [BUG-041] deliberately left it
  // denying. The preprocessor joins physical lines with ';', and ';' is a
  // command-position anchor in G3_POS, so a PROSE line inside a quoted commit
  // message that merely begins with "for" becomes ';for ' and reads as a shell
  // loop. The matched substring is ';for '. The scanner has quote-state machinery
  // but the pattern checks run over the whole preprocessed string without
  // consulting it, so quoted argv text is analyzed as if it were code.
  //
  // That is MECHANISM 2, filed as [BUG-043], and it is a separate defect from the
  // walk: it fires P9, OBF and P5, and it cannot be fixed by one preprocessing
  // change, because a blanket quote mask breaks seven genuine denials (four P6
  // rows, the P6 dialect row, two P12 alias rows). P6 and P12 inspect quoted
  // content BY DESIGN. This row and the three below are that item's pre-written
  // acceptance cases, inherited exactly as P7-1 and P7-2 were inherited by
  // [BUG-041]. Do not "fix" them here.
  { label: 'KNOWN-FP P9-1: commit message body line beginning with for', command: 'cd /Users/yeison/Projects/code-conductor && git commit -q -m "refactor: retire seedMemoryFile and wire the deploy warn channel [BUG-039]\n\nThe table\'s seed policy is now the single write-if-absent mechanism, so\nthe standalone helper and its coverage go with it, classified as coverage\nfor deleted code with a tombstone comment naming where that coverage\nmoved. deployProject gets the CLI\'s stderr emitter, and end-to-end cases\npin the re-run behavior against the real bundled assets, which is the\nonly layer where the old copy-then-merge ordering was observable.\n\nCo-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01HLS5KAHkhpMChyqNTbqrhe"\nprintf \'commit_rc=%s\\n\' "$?"\ngit log --oneline -1', verdict: 'deny' },

  // P4 carried ZERO specimens when [BUG-041] was filed and five by the time its
  // spec was written. Both rows that the walk fix flips are P7, so without this row
  // the corpus would arbitrate the fix on only one of the two patterns the defect
  // broke. This command denied under P4 before the fix and allows after it, measured.
  // The unquoted globs EARLIER in the command are load-bearing: the text after
  // `cat VERSION` has none, so the row pins that `after` begins at the END of the
  // match. A later "fix" that scans the whole command for globs turns this row red,
  // which is the point.
  { label: 'P4 walk: glob before the reader, none after it', command: 'wc -l tests/installer/*.js lib/installer/*.mjs && echo "--- VERSION ---" && cat VERSION && echo "--- node/test runner ---" && node -e \'const p=require("./package.json");console.log(JSON.stringify(p.scripts));console.log(p.version)\'', verdict: 'allow' },

  // CONTROLS, not false positives. Both are genuine shell loops this repository's own
  // agent wrote, and P9 denies them by its own rule working correctly. They are here so
  // that a later refinement which silences either one is recognized as a RECALL
  // regression rather than a precision win. Whether P9 should deny a loop that dumps
  // nothing is a rule question, deliberately not answered by [BUG-041]. Both commands
  // are quoted from the session transcript, not retyped.
  { label: "control P9: genuine for loop over task ids", command: "cd /Users/yeison/Projects/code-conductor\nP=\"docs/superpowers/plans/2026-09-27-bug039-installer-host-owned-state.md\"\nfor id in T-100 T-101 T-102 T-103 T-104 T-105 T-106 T-107; do\n  node scripts/conductor-db.mjs record \"$P\" \"$id\" \"X\" || printf 'FAILED %s\\n' \"$id\"\ndone\nprintf 'batch_rc=%s\\n' \"$?\"", verdict: "deny" },
  { label: "control P9: genuine until loop polling a PR", command: "until [ \"$(gh pr view 32 --json reviewDecision --jq .reviewDecision)\" = \"APPROVED\" ]; do sleep 30; done; echo \"APPROVED\"", verdict: "deny" },

  // MECHANISM 2 specimens, pending [BUG-043]: quoted argv text analyzed as code.
  // Three checks, one root cause. OBF reads a backslash run inside a single-quoted
  // regex as an evasion attempt; P5 reads a backslash-escaped backtick inside a
  // double-quoted pattern as a command substitution; P9 reads a JavaScript for-of
  // inside a quoted program as a shell loop. Each denies today and is expected to
  // keep denying until that item lands, the same footing P7-1 and P7-2 stood on.
  { label: "KNOWN-FP OBF: escape run inside a single-quoted grep pattern, pending [BUG-043]", command: "grep -n -m 3 -E '\\[ \\] \\[T-[0-9]{3,}(-[A-Z0-9]+)*\\]' \"docs/superpowers/plans/2026-09-27-bug038-handoff-contract.md\"", verdict: "deny" },
  { label: "KNOWN-FP P5: escaped backtick inside a double-quoted grep pattern, pending [BUG-043]", command: "grep -n \"Components Affected:\\*\\* \\`.claude/hooks/pre-tool-use.mjs\\`\" \"AGENT-READABLE BACKLOG.md\"", verdict: "deny" },
  { label: "KNOWN-FP P9: for-of inside a quoted node program, pending [BUG-043]", command: "node -e \"\nconst t=require('fs').readFileSync('tests/fixtures/guard3-reference.sh','utf8');\nfor (const fn of ['_g3_p3_xargs_reader','_g3_p8_ls_recursive','_g3_p12_alias']) {\n  const i=t.indexOf(fn+'()');\n  const j=t.indexOf('\\n}\\n', i);\n  console.log('=== '+fn); console.log(t.slice(i, j+2));\n}\"", verdict: "deny" },
];

// Rows that exist because the translation could have gone wrong in a specific way.
// The first three fail the moment anyone replaces an explicit class with \s: in
// JavaScript \s matches U+00A0 and U+2028, in the C locale [[:space:]] does not, so
// the guard would see a command separator where the authority sees an ordinary
// character. The separators are written as \u escapes so this file stays ASCII and
// the character under test cannot be lost to a copy. The last four pin the checks
// that consume a match extent, where POSIX leftmost-longest and JavaScript
// leftmost-first could have disagreed.
export const DIALECT = [
  { label: 'dialect: U+00A0 after cat is not a separator', command: 'cat *.ts', verdict: 'allow' },
  { label: 'dialect: U+2028 after cat is not a separator', command: 'cat *.ts', verdict: 'allow' },
  { label: 'dialect: U+00A0 after ls is not a separator', command: 'ls -R .', verdict: 'allow' },
  { label: 'dialect extent P4: command cat x', command: 'command cat *.ts', verdict: 'deny' },
  { label: 'dialect extent P5: env assignment then reader', command: 'env A=1 B=2 cat $(ls)', verdict: 'deny' },
  { label: 'dialect extent P6: git grep after a semicolon', command: "echo x; git grep '.*'", verdict: 'deny' },
  { label: 'dialect extent P7: path-invoked pager', command: '/usr/bin/less *.ts', verdict: 'deny' },
];

// The ONE sanctioned divergence between the two subjects, recorded in
// docs/superpowers/specs/2026-09-25-bug037-guard3-port-and-first-ship-design.md.
// The authority interpolates allowlist entries raw into an ERE, so entry file.ts
// matches fileXts as well. The port escapes entries and matches them literally,
// which is the fix, and therefore denies where the authority allows. This is an
// inequality by design, not a port defect. Adding a second member to this list
// without amending the spec is what the length assertion exists to stop.
//
// The glob is load-bearing. The allowlist is consulted only after a check fires, so
// `cat fileXts` on its own is allowed by both subjects and would prove nothing. The
// trailing *.md fires P4, and the verdict then turns entirely on whether entry
// file.ts covers the fileXts token: raw ERE says yes, literal matching says no.
export const EXCEPTIONS = [
  {
    label: 'allowlist entry file.ts does not match fileXts in the port',
    command: 'cat fileXts *.md',
    allowlist: ['file.ts'],
    fixtureVerdict: 'allow',
    portVerdict: 'deny',
  },
];
