"""Global pytest configuration.

Default policy: only run core tests under `tests/` directory. Desktop/device/research suites
are excluded from default discovery via `pytest.ini` testpaths. They can be invoked explicitly
(e.g. `pytest apps/desktop/tests -m 'integration'`).

Also registers custom markers to silence warnings.
"""
from __future__ import annotations

import pytest

# Ensure project module importability (desktop src, root) via shim package.
try:  # pragma: no cover - defensive
    import hidock_shims  # noqa: F401
except Exception as _e:  # noqa: BLE001
    print(f"[conftest] shim import failed: {_e}")


def pytest_configure(config: pytest.Config) -> None:  # noqa: D401 - concise hook
    config.addinivalue_line("markers", "asyncio: async test requiring event loop")
    config.addinivalue_line("markers", "optional: requires optional heavy dependency stack")
    # (Markers already declared in pytest.ini; this is defensive if users invoke pytest directly with -c flag omitted.)
