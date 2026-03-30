# Virtual Environment Management

This project supports working across multiple host environments (Windows native, WSL, macOS, Linux). A single shared Python virtual environment often breaks when switching contexts, so we intentionally maintain **separate per-platform environments** inside `apps/desktop`.

## 📁 Directory Naming Convention

| Platform                          | Directory     | Example Python Path                         |
| --------------------------------- | ------------- | ------------------------------------------- |
| Windows (native)                  | `.venv.win`   | `apps/desktop/.venv.win/Scripts/python.exe` |
| WSL (Windows Subsystem for Linux) | `.venv.wsl`   | `apps/desktop/.venv.wsl/bin/python`         |
| Linux (bare metal)                | `.venv.linux` | `apps/desktop/.venv.linux/bin/python`       |
| macOS                             | `.venv.mac`   | `apps/desktop/.venv.mac/bin/python`         |
| CI / Ephemeral                    | `.venv.ci`    | `apps/desktop/.venv.ci/bin/python`          |

The generic `.venv` is considered **legacy**. If it exists, tooling will continue but prompt you to migrate.

## 🔍 Why Not One `.venv`?

- Shebang & path embedding differs per OS.
- Platform wheels (e.g., `pygame`, `psutil`) are not cross‑portable.
- Activation scripts differ (`Scripts/` vs `bin/`).
- WSL + Windows path translation causes import and subprocess issues.

## 🚀 Creating / Recreating an Environment

You rarely need to manually create these; `python setup.py` (after update) or helper scripts will handle it. To force recreation:

### Windows

```powershell
Remove-Item -Recurse -Force apps/desktop/.venv.win
py -3.12 -m venv apps/desktop/.venv.win
apps/desktop/.venv.win/Scripts/python -m pip install -U pip setuptools wheel
apps/desktop/.venv.win/Scripts/pip install -e "apps/desktop[dev]"
```

### WSL / Linux

```bash
rm -rf apps/desktop/.venv.wsl  # or .venv.linux
python3 -m venv apps/desktop/.venv.wsl
apps/desktop/.venv.wsl/bin/python -m pip install -U pip setuptools wheel
apps/desktop/.venv.wsl/bin/pip install -e "apps/desktop[dev]"
```

### macOS

```bash
rm -rf apps/desktop/.venv.mac
python3 -m venv apps/desktop/.venv.mac
apps/desktop/.venv.mac/bin/python -m pip install -U pip setuptools wheel
apps/desktop/.venv.mac/bin/pip install -e "apps/desktop[dev]"
```

## 🧪 Verifying Environment Health

```bash
python -c "import pygame, customtkinter, psutil; print('OK')"
```

If this fails, rebuild the platform’s venv.

## 🔁 Upgrading Dependencies

After pulling updates that modify `pyproject.toml`:

```bash
# Inside the appropriate activated env
pip install -e ".[dev]" --upgrade
```

Optional: export lock snapshots per platform:

```bash
pip freeze > requirements.lock.win.txt  # adapt per platform tag
```

(The project intentionally avoids a single cross-platform lock file due to binary wheel divergence.)

## 🧹 Cleaning

```bash
# Remove all platform envs (CAREFUL)
rm -rf apps/desktop/.venv.*  # bash / zsh
# or PowerShell
Get-ChildItem apps/desktop -Filter .venv.* -Directory | Remove-Item -Recurse -Force
```

## 🧭 Automatic Selection

A helper script (`scripts/env/select_venv.py`) resolves the appropriate environment based on:

1. WSL detection (`microsoft` in `platform.uname().release`)
2. `platform.system()` mapping
3. Fallback: `.venv` if legacy present

## 🤖 Using the Selector

```bash
python scripts/env/select_venv.py --ensure --print
# Outputs path and creates env if missing
```

## 🐞 Troubleshooting

| Symptom                                                              | Cause                         | Fix                                             |
| -------------------------------------------------------------------- | ----------------------------- | ----------------------------------------------- |
| `OSError: [WinError 193] %1 is not a valid Win32 application` in WSL | Using Windows venv inside WSL | Activate correct `.venv.wsl`                    |
| `ImportError: DLL load failed`                                       | Mixed platform wheels         | Recreate both envs cleanly                      |
| `pytest` missing                                                     | Dev extras not installed      | `pip install -e ".[dev]"`                       |
| Unicode console glitches                                             | Code page mismatch (Windows)  | Ensure `PYTHONUTF8=1` or use updated `setup.py` |

## 🔄 Migration From Legacy `.venv`

1. Activate legacy env.
2. Export installed packages (optional): `pip freeze > legacy.freeze.txt`.
3. Deactivate, remove legacy: `rm -rf apps/desktop/.venv`.
4. Run selector with ensure: `python scripts/env/select_venv.py --ensure`.
5. Reinstall: `pip install -e "apps/desktop[dev]"`.

### Automated Migration via Setup Flags

You can run the unified setup with non-interactive migration controls:

```bash
python setup.py --non-interactive --migrate=copy
# or rebuild instead of copying:
python setup.py --non-interactive --migrate=rebuild
```

Flags overview:

| Flag | Purpose |
| ---- | ------- |
| `--migrate=copy\|rebuild\|skip` | Decide how to handle legacy `.venv` automatically |
| `--force-new-env` | Delete and recreate the tagged env even if it exists |
| `--non-interactive` | Auto-answer prompts with safe defaults (developer mode) |
| `--mode=end-user\|developer` | Explicitly choose setup mode without prompt |

Environment variable alternative:

| Variable | Values | Effect |
| -------- | ------ | ------ |
| `HIDOCK_AUTO_MIGRATE` | `c`, `r`, `s` | Copy, rebuild or skip migration when legacy is detected |

## ✅ Summary

Use **one environment per platform**. Avoid reusing an environment across Windows ↔ WSL ↔ macOS. Let automation pick the right directory. This prevents subtle, time‑wasting dependency and path issues.
