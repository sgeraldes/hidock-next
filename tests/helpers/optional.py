"""Helpers for gracefully skipping tests when optional dependencies are absent.

Usage pattern (place at very top of a test module BEFORE importing the optional lib):

    from tests.helpers.optional import require
    require('numpy', marker='integration')  # or gui / audio / slow

If the import fails the test module is skipped cleanly (instead of causing a collection error).
"""
from __future__ import annotations

import importlib
import typing as _t

import pytest


_DEFAULT_REASON = "optional dependency missing"


def require(module: str, *, marker: str | None = None, reason: str | None = None) -> None:
    """Attempt to import *module*; skip the whole test module if not installed.

    Parameters
    ----------
    module: str
        Name passed to importlib.import_module.
    marker: str | None
        Optional marker label (e.g. 'integration', 'gui', 'audio'). If provided and test run
        excluded that marker via -m expression, the skip reason still appears but semantics
        remain consistent (explicit is better than implicit).
    reason: str | None
        Custom skip reason; defaults to a generic message including the module name.
    """
    try:
        importlib.import_module(module)
    except ModuleNotFoundError:
        msg = reason or f"{_DEFAULT_REASON}: '{module}'"
        # Mark-specific nuance: we *could* auto-add markers dynamically, but explicit decorators
        # remain clearer; thus we only skip here.
        pytest.skip(msg, allow_module_level=True)


def require_any(modules: _t.Iterable[str], *, reason: str | None = None) -> None:
    """Skip unless at least one module in *modules* can be imported.

    Useful where we can work with alternative backends.
    """
    for name in modules:
        try:
            importlib.import_module(name)
            return
        except ModuleNotFoundError:  # pragma: no cover - simple control flow
            continue
    lst = ", ".join(modules)
    pytest.skip(reason or f"none of the optional dependencies available: {lst}", allow_module_level=True)
