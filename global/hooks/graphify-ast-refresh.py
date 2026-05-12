#!/usr/bin/env python3
"""UserPromptSubmit hook: runs detect + AST extraction in background when graph is stale."""
import os
import sys
import subprocess
import platform
import time
from pathlib import Path

try:
    STALE_MINUTES = int(os.environ.get("GRAPHIFY_STALE_MINUTES", "60"))
except ValueError:
    STALE_MINUTES = 60

AST_SCRIPT = """
import json, sys
from pathlib import Path
from graphify.detect import detect
from graphify.extract import collect_files, extract

out = Path("graphify-out")

try:
    result = detect(Path("."))
    code = result.get("files", {}).get("code", [])
    if not code:
        sys.exit(0)

    out.mkdir(exist_ok=True)
    (out / ".graphify_detect.json").write_text(json.dumps(result))

    code_files = []
    for f in code:
        p = Path(f)
        code_files.extend(collect_files(p) if p.is_dir() else [p])

    if code_files:
        ast_result = extract(code_files)
        (out / ".graphify_ast.json").write_text(json.dumps(ast_result))

    (out / ".graphify_ast_done").write_text("")
except Exception:
    pass
"""


def is_fresh(cwd: Path) -> bool:
    sentinel = cwd / "graphify-out" / ".graphify_ast_done"
    if not sentinel.exists():
        return False
    age_minutes = (time.time() - sentinel.stat().st_mtime) / 60
    return age_minutes < STALE_MINUTES


def main() -> None:
    cwd = Path.cwd()

    if is_fresh(cwd):
        sys.exit(0)

    try:
        import graphify  # noqa: F401
    except ImportError:
        sys.exit(0)

    kwargs: dict = {
        "stdin": subprocess.DEVNULL,
        "stdout": subprocess.DEVNULL,
        "stderr": subprocess.DEVNULL,
        "env": os.environ.copy(),
    }
    if platform.system() == "Windows":
        kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW
    else:
        kwargs["start_new_session"] = True

    subprocess.Popen([sys.executable, "-c", AST_SCRIPT], cwd=str(cwd), **kwargs)


if __name__ == "__main__":
    main()
