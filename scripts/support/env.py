"""Environment resolution and migration helpers for HiDock setup.

Separated from monolithic `setup.py` to allow reuse by scripts/tests.
"""
from __future__ import annotations

import os
import platform
import shutil
import sys
import subprocess
from pathlib import Path
from typing import Optional

__all__ = [
    "DESKTOP_VENV_PATH",
    "DESKTOP_VENV_NAME",
    "activation_command",
    "resolve_desktop_venv_dir",
    "venv_python_path",
    "venv_pip_path",
    "maybe_offer_legacy_migration",
]


def _detect_wsl() -> bool:
    try:
        rel = platform.uname().release  # type: ignore[attr-defined]
        return isinstance(rel, str) and "microsoft" in rel.lower()
    except (AttributeError, OSError):  # narrow: platform info access issues
        return False


def resolve_desktop_venv_dir() -> Path:
    base = Path("apps/desktop")
    legacy = base / ".venv"
    system = platform.system()
    if system == "Windows":
        tag = ".venv.win"
    elif system == "Darwin":
        tag = ".venv.mac"
    elif system == "Linux":
        tag = ".venv.wsl" if _detect_wsl() else ".venv.linux"
    else:
        tag = ".venv.linux"
    tagged = base / tag
    if tagged.exists():
        return tagged
    if legacy.exists():
        print(
            f"⚠️  Using legacy virtual environment at {legacy}. "
            f"Consider migrating to {tag} (see docs/VENV.md)"
        )
        return legacy
    return tagged


DESKTOP_VENV_PATH = resolve_desktop_venv_dir()
DESKTOP_VENV_NAME = DESKTOP_VENV_PATH.name


def venv_python_path() -> Path:
    if platform.system() == "Windows":
        return DESKTOP_VENV_PATH / "Scripts" / "python.exe"
    return DESKTOP_VENV_PATH / "bin" / "python"


def venv_pip_path() -> Path:
    if platform.system() == "Windows":
        return DESKTOP_VENV_PATH / "Scripts" / "pip.exe"
    return DESKTOP_VENV_PATH / "bin" / "pip"


def activation_command() -> str:
    if platform.system() == "Windows":
        return f"{DESKTOP_VENV_NAME}\\Scripts\\activate"
    return f"source {DESKTOP_VENV_NAME}/bin/activate"


def maybe_offer_legacy_migration(auto: Optional[str] = None) -> None:
    """Interactively (or via auto flag) migrate legacy `.venv` to tagged env.

    auto: one of None (prompt), 'c' copy, 'r' rebuild, 's' skip
    """
    base = Path("apps/desktop")
    legacy = base / ".venv"
    if not legacy.exists():  # nothing to do
        return

    # Determine intended tag
    system = platform.system()
    if system == "Windows":
        target_tag = ".venv.win"
    elif system == "Darwin":
        target_tag = ".venv.mac"
    elif system == "Linux":
        target_tag = ".venv.wsl" if _detect_wsl() else ".venv.linux"
    else:
        target_tag = ".venv.linux"
    tagged = base / target_tag
    if tagged.exists():  # already migrated
        return

    print("\n🔄 Legacy virtual environment detected: .venv")
    print(
        f"You can migrate to the platform-tagged environment '{target_tag}' "
        "for cleaner multi-OS isolation."
    )

    if auto is None:
        auto = os.environ.get("HIDOCK_AUTO_MIGRATE")
    if auto is None:
        try:
            auto = input(
                "Migrate now? [c]opy packages / [r]ebuild / [s]kip: "
            ).strip().lower()
        except EOFError:
            auto = "s"
    if auto not in {"c", "r", "s"}:
        print("Skipping (invalid choice)")
        return

    if auto == "c":
        print(
            f"📦 Copying legacy environment to {target_tag} "
            "(this may take a moment)..."
        )
        try:
            shutil.copytree(legacy, tagged)
            print(
                "✅ Copy complete. Future commands will use the tagged env."
            )
        except (OSError, shutil.Error) as e:  # best-effort copy failures
            print(f"❌ Copy failed: {e}. You can retry or choose rebuild later.")
    elif auto == "r":
        print(f"🛠️  Rebuilding environment at {target_tag} ...")
        result = subprocess.run(
            [sys.executable, "-m", "venv", target_tag], cwd=base, check=False
        )
        if result.returncode != 0:
            print("❌ Rebuild failed. You can retry later.")
            return
        py = (
            tagged
            / ("Scripts" if platform.system() == "Windows" else "bin")
            / ("python.exe" if platform.system() == "Windows" else "python")
        )
        os.system(
            f"{py} -m pip install --upgrade pip setuptools wheel >NUL 2>&1"
        )  # quick bootstrap
        os.system(f"{py} -m pip install -e apps/desktop >NUL 2>&1")
        print(
            "✅ Rebuild complete. You can remove the old '.venv' when "
            "satisfied."
        )
    else:
        print(
            "⏭️  Skipping migration for now. You can migrate later manually."
        )
