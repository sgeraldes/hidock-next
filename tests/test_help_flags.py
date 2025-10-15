import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def test_help_includes_auto_install_flag():
    """--auto-install-missing should appear in setup.py --help output."""
    env = os.environ.copy()
    # Fast mode: avoid heavy operations if any code path runs unexpectedly
    env["HIDOCK_TEST_FAST"] = "1"
    cmd = [sys.executable, "setup.py", "--help"]
    result = subprocess.run(
        cmd,
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
        env=env,
    )
    assert result.returncode == 0, (
        "setup.py --help failed: stdout="
        + result.stdout[:400]
        + " stderr="
        + result.stderr[:400]
    )
    help_text = result.stdout
    assert "--auto-install-missing" in help_text, (
        "--auto-install-missing flag not found in help output"
    )
    # Sanity check a few existing flags to ensure help structure still intact
    expected_flags = [
        "--non-interactive",
        "--migrate",
        "--force-new-env",
        "--diagnose-venv",
    ]
    for flag in expected_flags:
        assert flag in help_text, (
            f"Expected flag {flag} missing from help output"
        )
