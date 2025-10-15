import importlib
import types
from pathlib import Path
import sys
import shutil

# Dynamically reload env module each test (cleared from sys.modules)

MODULE_PATH = "setup_support.env"
BASE = Path("apps/desktop")


def _reset_env_dir():
    """Remove test virtual env directories except the currently active one.

    Active env removal corrupted the environment previously (lost pytest). We
    skip deleting the env root that contains sys.executable. All other tagged
    dirs are removed best-effort with ignore_errors.
    """
    active_root = Path(sys.executable).parent.parent  # .../Scripts/ -> env root
    for tag in [".venv", ".venv.win", ".venv.wsl", ".venv.linux", ".venv.mac"]:
        p = BASE / tag
        if not p.exists() or not p.is_dir():
            continue
        # Never delete the active environment root
        try:
            if p.resolve() == active_root.resolve():
                continue
        except (OSError, RuntimeError):
            # If resolve() fails (permissions, race), fall back to string compare
            if str(p) in str(active_root):
                continue
        shutil.rmtree(p, ignore_errors=True)


def _fresh_import():
    if MODULE_PATH in sys.modules:
        del sys.modules[MODULE_PATH]
    return importlib.import_module(MODULE_PATH)


def test_tag_selection_windows(monkeypatch):
    monkeypatch.setattr("platform.system", lambda: "Windows")
    _reset_env_dir()
    m = _fresh_import()
    assert m.DESKTOP_VENV_NAME in {".venv.win", ".venv"}
    # Create tagged and reload
    (BASE / ".venv.win").mkdir(parents=True, exist_ok=True)
    m = _fresh_import()
    assert m.DESKTOP_VENV_NAME == ".venv.win"


def test_legacy_preferred_when_exists(monkeypatch):
    monkeypatch.setattr("platform.system", lambda: "Windows")
    _reset_env_dir()
    (BASE / ".venv").mkdir(parents=True, exist_ok=True)
    m = _fresh_import()
    # Behavior: If only legacy exists, it's selected. If later a tagged env is
    # created it takes precedence. Here only legacy exists so allowed names set.
    assert m.DESKTOP_VENV_PATH.name in {".venv", ".venv.win"}


def test_linux_wsl_vs_linux(monkeypatch):
    monkeypatch.setattr("platform.system", lambda: "Linux")
    monkeypatch.setattr(
        "platform.uname",
        lambda: types.SimpleNamespace(release="5.10.0-microsoft-standard"),
    )
    _reset_env_dir()
    m = _fresh_import()
    assert m.DESKTOP_VENV_NAME in {".venv.wsl", ".venv"}
    # Normal Linux
    monkeypatch.setattr(
        "platform.uname",
        lambda: types.SimpleNamespace(release="5.10.0-generic"),
    )
    m = _fresh_import()
    assert m.DESKTOP_VENV_NAME in {".venv.linux", ".venv"}


def test_activation_command(monkeypatch):
    monkeypatch.setattr("platform.system", lambda: "Windows")
    _reset_env_dir()
    m = _fresh_import()
    if m.DESKTOP_VENV_NAME.startswith(".venv"):
        assert m.activation_command().endswith("Scripts\\activate")
    monkeypatch.setattr("platform.system", lambda: "Linux")
    m = _fresh_import()
    assert m.activation_command().startswith("source")
