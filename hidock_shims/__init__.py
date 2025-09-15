"""Shim package to expose project modules without restructuring.

On import, this adjusts sys.path so that top-level desktop source modules become
importable (e.g. `config_and_logger`, `hidock_device`). This is a transitional
layer until a conventional src/ layout is adopted.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DESKTOP_SRC = PROJECT_ROOT / "apps" / "desktop" / "src"

for p in (PROJECT_ROOT, DESKTOP_SRC):
    sp = str(p)
    if sp not in sys.path:
        sys.path.insert(0, sp)

# Optional: expose a convenience attribute
exposed_paths = [str(PROJECT_ROOT), str(DESKTOP_SRC)]

__all__ = ["exposed_paths"]
