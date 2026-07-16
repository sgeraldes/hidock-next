"""Optional-dependency gate for desktop tests.

Test modules call ``require("usb", marker="integration")`` at import time so
the whole module is skipped (not errored) when an optional heavy dependency
is not installed in the current environment.
"""

import pytest


def require(module_name: str, marker: str | None = None):
    """Import an optional dependency or skip the calling test module.

    Args:
        module_name: Importable module name (e.g. ``"usb"``, ``"numpy"``).
        marker: Test-category context included in the skip reason
            (e.g. ``"gui"``, ``"integration"``).

    Returns:
        The imported module when available.
    """
    reason = f"optional dependency '{module_name}' not installed"
    if marker:
        reason += f" ({marker} tests)"
    return pytest.importorskip(module_name, reason=reason)
