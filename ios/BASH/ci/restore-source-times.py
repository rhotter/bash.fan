"""Give unchanged tracked inputs stable mtimes across fresh CI checkouts.

DerivedData retains compiler dependencies with timestamps. Use each file's last
Git change, rather than checkout time; changed source still invalidates normally.
The workflow fetches full history before running this helper.
"""
import os
from pathlib import Path
import subprocess

root = Path(subprocess.check_output(["git", "rev-parse", "--show-toplevel"], text=True).strip())
paths = subprocess.check_output(
    ["git", "ls-files", "-z", "ios/BASH", "ios/BASHCapture/Sources"], cwd=root
).decode().split("\0")
for relative in filter(None, paths):
    path = root / relative
    if not path.is_file() or path.is_symlink():
        continue
    # Never normalize locally modified inputs to their previous revision.
    if subprocess.check_output(["git", "status", "--porcelain", "--", relative], cwd=root):
        continue
    timestamp = int(subprocess.check_output(
        ["git", "log", "-1", "--format=%ct", "--", relative], cwd=root, text=True
    ).strip())
    os.utime(path, (timestamp, timestamp))
