import platform
import tempfile
from pathlib import Path
import sys
from typing import TYPE_CHECKING

if TYPE_CHECKING:  # pragma: no cover
    import setup  # noqa: F401


def _write_dummy_py(path: Path):
    (path / 'bin').mkdir(parents=True, exist_ok=True)
    (path / 'bin' / 'python').touch()


def test_legacy_copy_migration(monkeypatch):
    # Skip on Windows for simplicity of path creation (bin/ vs Scripts/)
    if platform.system() == 'Windows':
        return

    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        desktop = root / 'apps' / 'desktop'
        desktop.mkdir(parents=True)
        legacy = desktop / '.venv'
        _write_dummy_py(legacy)

        # Simulate running setup module from this temp root
        monkeypatch.chdir(root)

        # Force migration choice to copy
        monkeypatch.setenv('HIDOCK_AUTO_MIGRATE', 'c')

        # Import the setup module fresh (clear prior module for re-exec)
        if 'setup' in sys.modules:
            del sys.modules['setup']
        import setup  # noqa: F401  # pylint: disable=import-outside-toplevel,unused-import
        assert hasattr(setup, 'DESKTOP_VENV_PATH')

        system = platform.system()
        if system == 'Linux':
            tagged_name = '.venv.linux'
        elif system == 'Darwin':
            tagged_name = '.venv.mac'
        else:
            tagged_name = '.venv.linux'

        tagged = desktop / tagged_name
        assert tagged.exists(), (
            f"Tagged env {tagged_name} should be created via copy migration"
        )
        assert legacy.exists(), "Legacy env should remain after copy migration"


def test_no_migration_when_tag_exists(monkeypatch):
    if platform.system() == 'Windows':
        return

    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        desktop = root / 'apps' / 'desktop'
        desktop.mkdir(parents=True)
        legacy = desktop / '.venv'
        tagged = desktop / '.venv.linux'
        _write_dummy_py(legacy)
        _write_dummy_py(tagged)
        monkeypatch.chdir(root)
        monkeypatch.setenv('HIDOCK_AUTO_MIGRATE', 'c')

        if 'setup' in sys.modules:
            del sys.modules['setup']
        import setup  # noqa: F401  # pylint: disable=import-outside-toplevel,unused-import
        assert hasattr(setup, 'DESKTOP_VENV_PATH')

        # Tagged existed beforehand; migration should not modify existing dirs
        assert tagged.exists()
        assert legacy.exists()
