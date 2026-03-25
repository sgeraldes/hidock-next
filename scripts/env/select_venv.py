#!/usr/bin/env python3
"""Resolve or create the platform-specific desktop virtual environment."""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
import venv
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.support import env as env_support


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--print", dest="print_path", action="store_true", help="Print the selected venv path")
    parser.add_argument("--ensure", action="store_true", help="Create the selected venv if it does not exist")
    parser.add_argument(
        "--migrate",
        choices=["copy", "rebuild", "skip"],
        help="Legacy .venv migration mode",
    )
    return parser.parse_args()


def create_venv(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    builder = venv.EnvBuilder(with_pip=True)
    builder.create(path)


def bootstrap_pip(path: Path) -> None:
    python_path = path / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    subprocess.run(
        [str(python_path), "-m", "pip", "install", "--upgrade", "pip", "setuptools", "wheel"],
        cwd=ROOT,
        check=False,
    )


def main() -> int:
    args = parse_args()

    migrate_map = {"copy": "c", "rebuild": "r", "skip": "s"}
    env_support.maybe_offer_legacy_migration(migrate_map.get(args.migrate))

    venv_path = ROOT / env_support.resolve_desktop_venv_dir()
    if args.ensure and not venv_path.exists():
        create_venv(venv_path)
        bootstrap_pip(venv_path)

    if args.print_path:
        print(venv_path)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
