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
];
