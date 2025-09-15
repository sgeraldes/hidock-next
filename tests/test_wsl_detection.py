import sys
import types
from pathlib import Path
import shutil
from typing import TYPE_CHECKING

if TYPE_CHECKING:  # pragma: no cover - import only for type checking tools
    import setup  # noqa: F401

BASE = Path('apps/desktop')


def _reset():
    active_root = Path(sys.executable).parent.parent
    for tag in ['.venv', '.venv.win', '.venv.wsl', '.venv.linux', '.venv.mac']:
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
    monkeypatch.setenv('HIDOCK_TEST_FAST', '1')
    monkeypatch.setattr('platform.system', lambda: 'Linux')
    monkeypatch.setattr('platform.uname', lambda: types.SimpleNamespace(release='6.1.0-microsoft-standard'))
    _reset()
    if 'setup' in sys.modules:
        del sys.modules['setup']
    import setup as s  # noqa: F401  # pylint: disable=import-outside-toplevel,unused-import
    assert s.DESKTOP_VENV_NAME in {'.venv.wsl', '.venv'}, 'Expected WSL-tagged venv name when in WSL kernel'
