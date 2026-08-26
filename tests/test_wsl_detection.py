import importlib
import shutil
import sys
import types
from pathlib import Path

# The venv-selection surface lives in scripts.support.env (moved there from
# the monolithic setup.py / setup_support during the repo reorganization).
MODULE_PATH = "scripts.support.env"

BASE = Path("apps/desktop")


def _reset():
    active_root = Path(sys.executable).parent.parent
    for tag in [".venv", ".venv.win", ".venv.wsl", ".venv.linux", ".venv.mac"]:
        p = BASE / tag
        if not p.exists() or not p.is_dir():
            continue
        try:
            if p.resolve() == active_root.resolve():
                continue
        except (OSError, RuntimeError):
            if str(p) in str(active_root):
                continue
        shutil.rmtree(p, ignore_errors=True)


def test_wsl_detection(monkeypatch):
    monkeypatch.setenv("HIDOCK_TEST_FAST", "1")
    monkeypatch.setattr("platform.system", lambda: "Linux")
    monkeypatch.setattr("platform.uname", lambda: types.SimpleNamespace(release="6.1.0-microsoft-standard"))
    _reset()
    if MODULE_PATH in sys.modules:
        del sys.modules[MODULE_PATH]
    m = importlib.import_module(MODULE_PATH)

    assert m.DESKTOP_VENV_NAME in {".venv.wsl", ".venv"}, "Expected WSL-tagged venv name when in WSL kernel"
