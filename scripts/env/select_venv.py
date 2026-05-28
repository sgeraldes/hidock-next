#!/usr/bin/env python3
"""
Resolve / create the per-platform virtual environment for hidock-next.
Restores the missing scripts/env/select_venv.py that setup-windows.bat and
setup-unix.sh expect (issue #41).

Contract:
  --print           Print the absolute venv path if it exists; otherwise no output.
  --ensure          Create the venv at the platform-appropriate path if missing.
  --ensure --print  Create (if missing) and print the absolute path.
"""

import argparse
import os
import sys
import venv
from pathlib import Path


def venv_dir_name() -> str:
    if sys.platform.startswith("win"):
        return ".venv.win"
    if sys.platform == "darwin":
        return ".venv.mac"
    return ".venv.nix"


def repo_root() -> Path:
    return Path(__file__).resolve().parent.parent.parent


def venv_path() -> Path:
    return repo_root() / venv_dir_name()


def venv_python(path: Path) -> Path:
    if sys.platform.startswith("win"):
        return path / "Scripts" / "python.exe"
    return path / "bin" / "python"


def ensure(path: Path) -> None:
    if venv_python(path).exists():
        return
    path.mkdir(parents=True, exist_ok=True)
    builder = venv.EnvBuilder(with_pip=True, clear=False, upgrade=False, symlinks=(os.name != "nt"))
    builder.create(str(path))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--ensure", action="store_true")
    parser.add_argument("--print", dest="do_print", action="store_true")
    args = parser.parse_args()

    path = venv_path()

    if args.ensure:
        try:
            ensure(path)
        except Exception as exc:
            print(f"ERROR: failed to create venv at {path}: {exc}", file=sys.stderr)
            return 1

    if args.do_print and venv_python(path).exists():
        print(str(path))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
