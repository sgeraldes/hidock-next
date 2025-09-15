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


def test_legacy_rebuild_migration(monkeypatch):
    if platform.system() == 'Windows':
        return
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        desktop = root / 'apps' / 'desktop'
        desktop.mkdir(parents=True)
        legacy = desktop / '.venv'
        _write_dummy_py(legacy)
        monkeypatch.chdir(root)
        # Force rebuild
        monkeypatch.setenv('HIDOCK_AUTO_MIGRATE', 'r')

        # Stub run_command to simulate successful rebuild without heavy work
        class DummyResult:
            def __init__(self):
                self.returncode = 0
                self.stdout = ''
                self.stderr = ''

        def fake_run_command(cmd, cwd=None, check=True, env=None, print_on_error=True, always_print_stderr=False):
            # If creating venv, simulate by making tagged structure
            if isinstance(cmd, (list, tuple)) and '-m' in cmd and 'venv' in cmd:
                system = platform.system()
                if system == 'Linux':
                    tag = '.venv.linux'
                elif system == 'Darwin':
                    tag = '.venv.mac'
                else:
                    tag = '.venv.linux'
                tgt = desktop / tag
                (tgt / 'bin').mkdir(parents=True, exist_ok=True)
                (tgt / 'bin' / 'python').touch()
            return DummyResult()

        monkeypatch.setenv('HIDOCK_TEST_FAST', '1')
        # Fresh import with monkeypatched run_command in module namespace
        if 'setup' in sys.modules:
            del sys.modules['setup']
        import setup  # noqa: F401  # pylint: disable=import-outside-toplevel,unused-import
        import setup as s  # pylint: disable=import-outside-toplevel
        s.run_command = fake_run_command  # type: ignore[attr-defined]
        s.maybe_offer_legacy_migration()
        system = platform.system()
        if system == 'Linux':
            tagged_name = '.venv.linux'
        elif system == 'Darwin':
            tagged_name = '.venv.mac'
        else:
            tagged_name = '.venv.linux'
        tagged = desktop / tagged_name
        assert tagged.exists(), 'Tagged env should exist after rebuild migration'
        assert legacy.exists(), 'Legacy env retained after rebuild'
