#!/usr/bin/env python3
"""HiDock Next - minimal setup wrapper (clean).

Side-effect free so PEP 517/518 build hooks (wheel / editable / metadata)
execute without triggering legacy interactive provisioning logic.

Real bootstrap logic now lives in ``hidock_bootstrap``.
Forward usage:
    python -m hidock_bootstrap [options]

Legacy flags are preserved only so that ``python setup.py --help`` still shows
expected options for older docs/tests. Behaviour is implemented in
``hidock_bootstrap``.
"""
from __future__ import annotations

import argparse
import sys

_BUILD_TRIGGERS = {
    "egg_info",
    "dist_info",
    "build_wheel",
    "bdist_wheel",
    "build",
    "prepare_metadata_for_build_wheel",
    "prepare_metadata_for_build_editable",
    "build_editable",
    "--name",
    "--version",
}
_BUILD_SUBSTRING_TRIGGERS = ["editable_wheel", "--editable"]


def _is_backend_invocation(argv: list[str]) -> bool:
    return any(t in argv for t in _BUILD_TRIGGERS) or any(
        any(sub in arg for sub in _BUILD_SUBSTRING_TRIGGERS) for arg in argv
    )


if _is_backend_invocation(sys.argv):  # pragma: no cover
    try:
        from setuptools import setup  # type: ignore
        setup()
    except Exception as exc:  # noqa: BLE001
        print(f"[setup.py] Metadata fallback failed: {exc}")
    finally:
        raise SystemExit(0)


def _arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="HiDock unified setup (wrapper)")
    add = p.add_argument
    add("--non-interactive", action="store_true", help="Run without interactive prompts where possible")
    add("--migrate", choices=["copy", "rebuild", "skip"], help="Legacy .venv migration strategy")
    add("--force-new-env", action="store_true", help="Recreate the tagged virtual environment if present")
    add("--mode", choices=["end-user", "developer"], help="Explicit setup mode (skip interactive choice)")
    add("--skip-tests", action="store_true", help="Skip running test suites")
    add("--skip-web", action="store_true", help="Skip web app dependency installation & tests")
    add("--skip-audio", action="store_true", help="Skip audio insights dependency installation & tests")
    add("--diagnose-venv", action="store_true", help="Run only virtual environment diagnostics and exit")
    add("--auto-install-missing", action="store_true", help="Auto-install missing Linux system deps (Debian/Ubuntu)")
    add("--concise", action="store_true", help="Concise output (suppress noisy command output; still logged)")
    add("--verbose", action="store_true", help="Verbose output (echo all command output immediately)")
    return p


def _delegate():  # pragma: no cover
    try:
        import hidock_bootstrap as _bootstrap  # type: ignore
    except Exception:
        _arg_parser().parse_args()  # ensure --help works
        print("hidock_bootstrap not available. Install dev deps or run bootstrap module directly.")
        return
    _bootstrap.main()


def main():  # pragma: no cover
    if any(a in ("-h", "--help") for a in sys.argv[1:]):
        _arg_parser().parse_args(["--help"])  # prints help & exits
        return
    _delegate()


if __name__ == "__main__":  # pragma: no cover
    main()
