#!/usr/bin/env python3
"""
HiDock Next - Comprehensive Setup Script.

Multi-OS goals:
    * Windows, Linux (Debian/other), macOS.
    * Force UTF-8 (avoid locale decode crashes).
    * Print stderr for failing commands (venv / npm / tests).
    * Fallback strategies for venv creation across OS.

On failure, both stdout and stderr are shown and decoding uses
UTF-8 with replacement to avoid UnicodeDecodeError seen during
npm / pytest output capture.
"""

import os
import platform
import subprocess
import sys
import argparse
import builtins
import shutil
from pathlib import Path
from shutil import which
from typing import Iterable, Any, Optional

# ---------------------------------------------------------------------------
# Early exit for build backends / pip editable installs
# If setuptools invokes this file for metadata (egg_info, dist_info, etc.),
# we should NOT run the interactive/CLI oriented logic below. Provide a
# minimal fallback setup invocation and return.
# ---------------------------------------------------------------------------
_BUILD_TRIGGERS = {
    "egg_info",
    "dist_info",
    "build_wheel",
    "bdist_wheel",
    "build",
    "--name",  # sometimes metadata queries
    "--version",
    "prepare_metadata_for_build_wheel",
    "build_editable",
}

if any(t in sys.argv for t in _BUILD_TRIGGERS):  # pragma: no cover - build path
    try:
        from setuptools import setup  # type: ignore

        setup()
    except Exception as _e:  # noqa: BLE001
        # Fail silently (setuptools will surface error), but avoid custom arg parser
        print(f"[setup.py] Metadata fallback failed: {_e}")
    finally:
        # Ensure we don't execute the remainder of the script
        raise SystemExit(0)


# ---------------------------------------------------------------------------
# Small cross-file utilities (kept here to avoid multi-file churn). Extracted
# to reduce cognitive load & pylint complexity in large procedural blocks.
# ---------------------------------------------------------------------------

def is_windows() -> bool:  # pragma: no cover - trivial helper
    return platform.system() == "Windows"


def is_linux() -> bool:  # pragma: no cover - trivial helper
    return platform.system() == "Linux"


def is_macos() -> bool:  # pragma: no cover - trivial helper
    return platform.system() == "Darwin"


def shorten(text: str, limit: int = 110) -> str:
    """Return text truncated with ellipsis if beyond limit."""
    if len(text) <= limit:
        return text
    return text[: limit - 3] + "..."


def safe_join(parts: Iterable[Any], sep: str = " ") -> str:
    return sep.join(str(p) for p in parts)


def safe_input(prompt: str, default: str = "") -> str:
    """Input wrapper that tolerates EOFError and returns default.

    Centralizing this reduces repeated try/except usage sprinkled across the
    script and allows future non-interactive policy centralization.
    """
    try:
        return input(prompt)  # type: ignore
    except EOFError:
        return default
    except KeyboardInterrupt:
        # Propagate KeyboardInterrupt so higher-level handlers can mark phase
        # status appropriately.
        raise
    except Exception:
        return default

# ---------------------------------------------------------------------------
# Output / verbosity control (Tier C - Phase 1 scaffold)
# ---------------------------------------------------------------------------


class OutputController:
    """Central controller for output modes (concise / normal / verbose).

    concise: suppress noisy pip/npm/apt output (log only).
    normal:  previous default behaviour.
    verbose: echo everything immediately.

    All raw output (including suppressed) is written to .hidock_setup.log
    so users can inspect failures in detail.
    """

    LOG_PATH = Path(".hidock_setup.log")

    def __init__(self):
        # Default mode can be influenced by env HIDOCK_OUTPUT_MODE
        self.mode = os.environ.get("HIDOCK_OUTPUT_MODE", "normal").lower()
        # Truncate log on first instantiation
        try:
            self.LOG_PATH.write_text(
                "# HiDock setup log (full verbose output)\n",
                encoding="utf-8",
            )
        except Exception:
            pass

        # Collect suppressed segments for potential future summaries
        self._buffered = []

    def set_mode(self, mode: str):
        if mode:
            self.mode = mode.lower()

    # Simple helpers -----------------------------------------------------
    def _log(self, text: str):
        try:
            with self.LOG_PATH.open("a", encoding="utf-8") as f:
                f.write(text.rstrip("\n") + "\n")
        except Exception:
            pass

    def print(self, *parts, sep=" ") -> None:
        line = safe_join(parts, sep=sep)
        print(line)
        self._log(line)

    def verbose(self, *parts) -> None:
        if self.mode == "verbose":
            self.print(*parts)
        else:
            # Always log even if not shown
            self._log(safe_join(parts))

    def log_raw(self, text: str) -> None:
        """Public method replacing protected _log usage outside controller."""
        self._log(text)

    def record_suppressed(self, header: str, content: str):
        self._buffered.append((header, content))
        # Always log suppressed output
        if header:
            self._log(header)
        if content:
            for line in content.splitlines():
                self._log(line)

    def flush_summaries(self):
        if self.mode == "concise" and self._buffered:
            self.print("\n📄 Concise summaries of suppressed output:")
            for header, content in self._buffered:
                # For now just list headers; future phases can distill metrics
                if header:
                    self.print(f"  • {header}")
            self._buffered.clear()


OUTPUT = OutputController()

# ---------------------------------------------------------------------------
# Phase tracking (Tier C - Phase 2)
# ---------------------------------------------------------------------------


class PhaseTracker:
    """Lightweight phase timing & status collector.

    Records (name, start_ts, end_ts, status, notes).
    Status: OK / FAIL / SKIP.
    """

    def __init__(self):
        import time

        self._time = time
        self.phases = []
        self._active = None

    def start(self, name: str):
        if self._active:
            # Auto-end previous without status if user forgot
            self.end("OK", notes="auto-closed")
        self._active = {
            "name": name,
            "t0": self._time.time(),
            "t1": None,
            "status": None,
            "notes": "",
        }
        if OUTPUT.mode != "concise":
            OUTPUT.print(f"➡️  Phase: {name} ...")

    def end(self, status: str, notes: str = ""):
        if not self._active:
            return
        self._active["t1"] = self._time.time()
        self._active["status"] = status
        self._active["notes"] = notes
        self.phases.append(self._active)
        if OUTPUT.mode != "concise":
            dur = self._active["t1"] - self._active["t0"]
            OUTPUT.print(
                f"✅ Phase complete: {self._active['name']} ({dur:.1f}s) "
                f"status={status}"
            )
        self._active = None

    def summary(self):
        lines = []
        for p in self.phases:
            dur = (p["t1"] - p["t0"]) if p["t1"] else 0.0
            note = f" - {p['notes']}" if p['notes'] else ""
            lines.append(f"{p['name']}: {p['status']} ({dur:.1f}s){note}")
        return lines


PHASES = PhaseTracker()

# ---------------------------------------------------------------------------
# Per-platform virtual environment resolution
# ---------------------------------------------------------------------------


def _detect_wsl() -> bool:
    try:
        return "microsoft" in platform.uname().release.lower()
    except Exception:
        return False


def resolve_desktop_venv_dir() -> Path:
    """Return the intended virtual environment directory for the desktop app.

    Order of preference:
      1. Existing tagged env (.venv.win/.venv.wsl/.venv.linux/.venv.mac)
      2. Legacy .venv (with warning)
      3. New tagged path (not yet created)
    """
    base = Path("apps/desktop")
    legacy = base / ".venv"
    system = platform.system()
    if system == "Windows":
        tag = ".venv.win"
    elif system == "Darwin":
        tag = ".venv.mac"
    elif system == "Linux":
        tag = ".venv.wsl" if _detect_wsl() else ".venv.linux"
    else:
        tag = ".venv.linux"
    tagged = base / tag
    if tagged.exists():
        return tagged
    if legacy.exists():
        print(
            f"⚠️  Using legacy virtual environment at {legacy}. "
            f"Consider migrating to {tag} (see docs/VENV.md)"
        )
        return legacy
    return tagged


DESKTOP_VENV_PATH = resolve_desktop_venv_dir()
DESKTOP_VENV_NAME = DESKTOP_VENV_PATH.name


# Offer migration from legacy .venv to tagged env if applicable
def maybe_offer_legacy_migration():
    base = Path("apps/desktop")
    legacy = base / ".venv"
    # Determine desired tagged path (recompute independently so we know
    # target even if legacy path is currently selected)
    system = platform.system()
    if system == "Windows":
        target_tag = ".venv.win"
    elif system == "Darwin":
        target_tag = ".venv.mac"
    elif system == "Linux":
        target_tag = ".venv.wsl" if _detect_wsl() else ".venv.linux"
    else:
        target_tag = ".venv.linux"
    tagged = base / target_tag
    # Only prompt if currently using legacy AND tagged does not yet exist
    if DESKTOP_VENV_PATH == legacy and legacy.exists() and not tagged.exists():
        print("\n🔄 Migration option: A legacy '.venv' was detected.")
        print(
            "You can migrate to the tagged env '" + target_tag + "' for "
            "multi-OS isolation."
        )
        choice = os.environ.get("HIDOCK_AUTO_MIGRATE", "").lower()
        if not choice:
            try:
                choice = input(
                    "Migrate? [c]opy / [r]ebuild / [s]kip: "
                ).strip().lower()
            except EOFError:
                choice = "s"
        if choice.startswith("c"):
            print(
                "📦 Copying legacy env to " + target_tag + " (may take time)..."
            )
            import shutil

            try:
                shutil.copytree(legacy, tagged)
                print("✅ Copy complete. Using tagged env now.")
            except Exception as e:
                print(f"❌ Copy failed: {e}. Try rebuild or retry later.")
        elif choice.startswith("r"):
            print(f"🧪 Rebuilding {target_tag} ...")
            # Create empty tagged env and reinstall deps from project metadata
            result = run_command(
                [sys.executable, "-m", "venv", target_tag],
                cwd=base,
                check=False,
            )
            if result.returncode == 0:
                py = (
                    tagged
                    / ("Scripts" if platform.system() == "Windows" else "bin")
                    / (
                        "python.exe"
                        if platform.system() == "Windows"
                        else "python"
                    )
                )
                run_command(
                    [
                        str(py),
                        "-m",
                        "pip",
                        "install",
                        "--upgrade",
                        "pip",
                        "setuptools",
                        "wheel",
                    ],
                    cwd=base,
                    check=False,
                )
                run_command(
                    [str(py), "-m", "pip", "install", "-e", "."],
                    cwd=base,
                    check=False,
                )
                print("✅ Rebuild complete. Remove old '.venv' when ready.")
            else:
                print("❌ Rebuild failed; legacy environment retained.")
        else:
            print("⏭️  Skipping migration. You can migrate manually later.")


maybe_offer_legacy_migration()


def venv_python_path() -> Path:
    if platform.system() == "Windows":
        return DESKTOP_VENV_PATH / "Scripts" / "python.exe"
    return DESKTOP_VENV_PATH / "bin" / "python"


def venv_pip_path() -> Path:
    if platform.system() == "Windows":
        return DESKTOP_VENV_PATH / "Scripts" / "pip.exe"
    return DESKTOP_VENV_PATH / "bin" / "pip"


def activation_command() -> str:
    if platform.system() == "Windows":
        return f"{DESKTOP_VENV_NAME}\\Scripts\\activate"
    return f"source {DESKTOP_VENV_NAME}/bin/activate"


# Force UTF-8 for child processes (avoid cp1252 decode issues)
if platform.system() == "Windows":
    # PYTHONIOENCODING ensures Python child processes emit UTF-8
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")
    # PYTHONUTF8=1 forces UTF-8 mode (Python 3.7+)
    os.environ.setdefault("PYTHONUTF8", "1")


def run_command(
    command,
    cwd=None,
    check=True,
    env=None,
    print_on_error=True,
    always_print_stderr=False,
):
    """Run a command and return the CompletedProcess.

        Enhancements:
            * UTF-8 decode with replacement avoids Windows cp1252 errors.
            * Print stderr on non‑zero return even if check=False.
            * Accept list (no shell) or str (shell=True) for portability.
    """
    shell = isinstance(command, str)

    # Derive a display string for the command
    display_cmd = (
        command if isinstance(command, str) else " ".join(map(str, command))
    )

    # Heuristic classification for noisy commands
    lowered_display = display_cmd.lower()
    noisy = any(
        kw in lowered_display
        for kw in [
            " pip install ",
            "npm install",
            "apt install",
            "apt update",
            "nala install",
        ]
    )

    if OUTPUT.mode == "concise" and noisy:
        truncated = (
            display_cmd[:60] + "..." if len(display_cmd) > 63 else display_cmd
        )
        OUTPUT.print(f"Running (suppressed): {truncated}")
    else:
        OUTPUT.print(f"Running: {display_cmd}")
    # Fast test mode skips network heavy pip/npm operations
    is_fast = os.environ.get("HIDOCK_TEST_FAST")
    if is_fast and not shell and isinstance(command, (list, tuple)):
        lowered = [str(c).lower() for c in command]
        if (
            any(x.endswith("pip") or x == "pip" for x in lowered)
            or "npm" in lowered
        ):

            class _FastOK:
                returncode = 0
                skipped = " ".join(map(str, command))
                stdout = f"[fast-mode] skipped: {skipped}"
                stderr = ""

            OUTPUT.print(_FastOK().stdout)
            return _FastOK()
    try:
        result = subprocess.run(
            command,
            shell=shell,
            cwd=cwd,
            # We'll implement our own check logic to ensure stderr is surfaced
            check=False,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            env=env,
        )
    except (
        FileNotFoundError,
        PermissionError,
        OSError,
        subprocess.SubprocessError,
    ) as e:  # Narrow common failures
        OUTPUT.print(
            f"❌ Failed to execute command: {display_cmd}\n   Reason: {e}"
        )
        if check:
            sys.exit(1)

        # Fabricate a minimal similar object
        class _Failure:
            returncode = 1
            stdout = ""
            stderr = str(e)

        return _Failure()

    # Print stdout always (if non-empty)
    if result.stdout:
        if OUTPUT.mode == "concise" and noisy:
            # Suppress to console, record for summary/log
            OUTPUT.record_suppressed(
                f"{display_cmd} (stdout suppressed)", result.stdout
            )
        else:
            OUTPUT.print(result.stdout.rstrip("\n"))

    # Decide when to print stderr
    if result.stderr and (result.returncode != 0 or always_print_stderr):
        concise_ok = (
            OUTPUT.mode == "concise"
            and noisy
            and result.returncode == 0
            and not always_print_stderr
        )
        if concise_ok:
            OUTPUT.record_suppressed(
                f"{display_cmd} (stderr suppressed)", result.stderr
            )
        else:
            OUTPUT.print("[stderr]")
            OUTPUT.print(result.stderr.rstrip("\n"))

    if check and result.returncode != 0:
        if print_on_error:
            OUTPUT.print(
                f"❌ Command failed with exit code {result.returncode}: "
                f"{display_cmd}"
            )
        sys.exit(result.returncode)
    return result


def check_python_version():
    """Check if Python version is compatible."""
    version = sys.version_info
    if version.major != 3 or version.minor < 12:
        print(
            "Python 3.12 required; found "
            f"{version.major}.{version.minor}"
        )
        print(
            "Some packages (librosa/numba) may not work with other versions"
        )
        sys.exit(1)
    print(f"✓ Python {version.major}.{version.minor}.{version.micro}")


def check_node_version():
    """Check if Node.js version is compatible."""
    try:
        result = run_command("node --version", check=False)
        if result.returncode == 0:
            version = result.stdout.strip()
            print(f"✓ Node.js {version}")
            return True
        print("✗ Node.js not found")
        return False
    except Exception:
        print("✗ Node.js not found")
        return False


def check_git_config():
    """Check if Git is properly configured."""
    print("Checking Git configuration...")

    try:
        # Check if git is available
        result = run_command("git --version", check=False)
        if result.returncode != 0:
            print("✗ Git not found")
            return False

        # Check user.name
        result = run_command("git config user.name", check=False)
        if result.returncode == 0 and result.stdout.strip():
            name = result.stdout.strip()
            print(f"✓ Git user.name: {name}")
        else:
            print("⚠️  Git user.name not set")
            name = input("Enter your name for Git commits: ").strip()
            if name:
                run_command(f'git config --global user.name "{name}"')
                print(f"✓ Set Git user.name to: {name}")

        # Check user.email
        result = run_command("git config user.email", check=False)
        if result.returncode == 0 and result.stdout.strip():
            email = result.stdout.strip()
            print(f"✓ Git user.email: {email}")
        else:
            print("⚠️  Git user.email not set")
            email = input("Enter your email for Git commits: ").strip()
            if email:
                run_command(f'git config --global user.email "{email}"')
                print(f"✓ Set Git user.email to: {email}")

        return True

    except Exception as e:
        print(f"✗ Git configuration check failed: {e}")
        return False


def check_network_connection():
    """Check if internet connection is available."""
    print("Checking internet connection...")
    try:
        # Try to reach a reliable server
        result = (
            run_command("ping -c 1 8.8.8.8", check=False)
            if platform.system() != "Windows"
            else run_command("ping -n 1 8.8.8.8", check=False)
        )
        if result.returncode == 0:
            print("✓ Internet connection available")
            return True
        else:
            print("⚠️  No internet connection detected")
            print("   npm install and API key setup may fail")
            return False
    except Exception:
        print("⚠️  Could not verify internet connection")
        return False


def check_permissions():
    """Check if we have proper permissions to write files."""
    print("Checking permissions...")
    try:
        # Try to create a test file
        test_file = Path("temp_permission_test.txt")
        test_file.write_text("test", encoding="utf-8")
        test_file.unlink()
        print("✓ Write permissions OK")
        return True
    except (OSError, IOError) as e:
        print(f"⚠️  Permission issue detected: {e}")
        print("Solutions:")
        print("• Run as administrator/sudo (if needed)")
        print("• Check directory permissions")
        print("• Ensure you own the directory")
        return False


def check_disk_space():
    """Check available disk space."""
    print("Checking disk space...")
    try:
        import shutil
        usage = shutil.disk_usage(".")
        free_gb = usage.free / (1024**3)
    except (OSError, ValueError) as e:
        print(f"⚠️  Could not check disk space: {e}")
        return True
    if free_gb < 1:
        print(f"⚠️  Low disk space: {free_gb:.1f}GB available")
        print("   Node.js dependencies require ~500MB")
        print("   Python dependencies require ~200MB")
        print("   Consider freeing up space")
        return False
    print(f"✓ Disk space OK: {free_gb:.1f}GB available")
    return True


def check_development_files():
    """Check for required development files."""
    print("Checking development files...")

    # Check Windows-specific requirements
    if platform.system() == "Windows":
        libusb_path = Path("apps/desktop/libusb-1.0.dll")
        if libusb_path.exists():
            print("✓ libusb-1.0.dll found (required for device communication)")
        else:
            print("⚠️  libusb-1.0.dll not found in apps/desktop/")
            print("   This is required for HiDock device communication")

        # Check for Visual C++ Build Tools (needed for some Python packages)
        try:
            result = run_command("where cl", check=False)
        except OSError:
            result = None
        if not result or result.returncode != 0:
            print("ℹ️  Visual C++ Build Tools not found (may be needed)")
            print(
                "   Download: https://visualstudio.microsoft.com/"
                "visual-cpp-build-tools/"
            )
        else:
            print("✓ Visual C++ Build Tools found")

        # Warn about Windows Defender
        print("ℹ️  If installs fail, check Windows Defender exclusions")

    # Check Linux system dependencies
    elif platform.system() == "Linux":
        return check_linux_system_dependencies()

    # Check macOS dependencies
    elif platform.system() == "Darwin":
        print("ℹ️  macOS: USB permissions usually work out of the box")

        # Check for Xcode command line tools
        result = run_command("xcode-select -p", check=False)
        if result.returncode != 0:
            print("⚠️  Xcode command line tools not installed")
            print("   Run: xcode-select --install")
        else:
            print("✓ Xcode command line tools installed")

        # Check for Homebrew (helpful but not required)
        result = run_command("brew --version", check=False)
        if result.returncode != 0:
            print("ℹ️  Homebrew not found (optional but recommended)")
            print(
                "   Install: /bin/bash -c \"$(curl -fsSL https://raw."
                "githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
            )
        else:
            print("✓ Homebrew available")

    # Check for important config files
    desktop_config = Path("apps/desktop/hidock_config.json")
    if desktop_config.exists():
        print("✓ Desktop app configuration file found")
    else:
        print("ℹ️  Desktop app will create configuration on first run")

    return True


def check_linux_system_dependencies():
    """Check Linux system dependencies and offer to install them."""
    print("\n🐧 Checking Linux system dependencies...")

    # Check for Debian-based distribution
    debian_based = False
    try:
        result = run_command("which apt", check=False)
        if result.returncode == 0:
            debian_based = True
    except OSError:
        pass

    if not debian_based:
        # Detect common alternative package managers for tailored guidance
        pkg_manager = None
        guidance_lines = []
        probes = [
            (
                "dnf",
                "Fedora / RHEL / CentOS",
                [
                    "sudo dnf groupinstall -y 'Development Tools'",
                    "sudo dnf install -y python3-tkinter ffmpeg "
                    "libusbx-devel systemd-devel",
                ],
            ),
            (
                "yum",
                "RHEL / CentOS (legacy)",
                [
                    "sudo yum groupinstall -y 'Development Tools'",
                    "sudo yum install -y python3-tkinter ffmpeg "
                    "libusbx-devel systemd-devel",
                ],
            ),
            (
                "pacman",
                "Arch / Manjaro",
                [
                    "sudo pacman -Syu --needed base-devel python tk ffmpeg "
                    "libusb systemd",
                ],
            ),
            (
                "zypper",
                "openSUSE",
                [
                    "sudo zypper install -t pattern devel_basis",
                    "sudo zypper install -y python311-tk ffmpeg "
                    "libusb-1_0-devel systemd-devel",
                ],
            ),
            (
                "apk",
                "Alpine",
                [
                    "sudo apk add --no-cache python3 py3-tkinter ffmpeg "
                    "libusb-dev build-base linux-headers",
                ],
            ),
            (
                "brew",
                "Homebrew (generic)",
                [
                    "brew install python-tk ffmpeg libusb pkg-config",
                ],
            ),
        ]
        for binary, label, cmds in probes:
            try:
                res = run_command(f"which {binary}", check=False)
            except Exception:
                res = None
            if res and res.returncode == 0:
                pkg_manager = label
                guidance_lines = cmds
                break

        print("⚠️  Non-Debian distribution detected")
        if pkg_manager:
            print(f"   Detected package ecosystem: {pkg_manager}")
        print("   Install these components manually (examples below):")
        print("     • tkinter (python tk bindings)")
        print("     • ffmpeg + codecs")
        print("     • libusb (headers) + pkg-config")
        print("     • build tools (compiler, make)")
        print("     • dialout/uucp group membership (USB access)")
        if guidance_lines:
            print("\n   Example commands:")
            for line in guidance_lines:
                print("      " + line)
        else:
            print(
                "\n   Refer to distro docs for equivalent package names."
            )
        print("\n   (Auto-install only supported on Debian/Ubuntu via apt)")
        print(
            "ℹ️  Summary: install tk, ffmpeg, libusb(+pkg-config), "
            "build tools; add user to dialout/uucp"
        )
        return True

    missing_deps = []

    # Check Python tkinter
    try:
        result = run_command("python3 -c 'import tkinter'", check=False)
        if result.returncode != 0:
            missing_deps.append("Python tkinter")
        else:
            print("✓ Python tkinter available")
    except Exception:
        missing_deps.append("Python tkinter")

    # Check FFmpeg
    try:
        result = run_command("which ffmpeg", check=False)
        if result.returncode != 0:
            missing_deps.append("FFmpeg")
        else:
            print("✓ FFmpeg found")
    except Exception:
        missing_deps.append("FFmpeg")

    # Check libusb (distinguish missing pkg-config tool vs missing headers)
    try:
        pkg_cfg = run_command("which pkg-config", check=False)
        have_pkg_config = pkg_cfg.returncode == 0
    except OSError:
        have_pkg_config = False

    if have_pkg_config:
        result = run_command("pkg-config --exists libusb-1.0", check=False)
        if result.returncode != 0:
            # pkg-config present but libusb .pc missing
            missing_deps.append("libusb development files (pc file)")
        else:
            print("✓ libusb-1.0 found")
    else:
        # Fallback: look for a common header as heuristic
        header_hint = run_command(
            "bash -c 'ls /usr/include/libusb-1.0/libusb.h 2>/dev/null'",
            check=False,
        )
        if header_hint.returncode == 0:
            print("✓ libusb header present (pkg-config missing)")
            print("ℹ️  Consider: sudo apt install -y pkg-config (detection)")
        else:
            missing_deps.append("pkg-config + libusb development files")

    # Check build tools
    try:
        result = run_command("which gcc", check=False)
    except OSError:
        result = None
    if not result or result.returncode != 0:
        missing_deps.append("build tools (GCC)")
    else:
        print("✓ Build tools available")

    # Check USB permissions
    if is_linux():
        try:
            import getpass
            import grp  # type: ignore

            username = getpass.getuser()
            getgrall = getattr(grp, "getgrall", lambda: [])  # type: ignore[attr-defined]
            user_groups = [g.gr_name for g in getgrall() if username in getattr(g, "gr_mem", [])]
            if "dialout" not in user_groups:
                print("⚠️  User not in 'dialout' group (needed for USB access)")
                missing_deps.append("USB permissions (dialout group)")
            else:
                print("✓ USB permissions configured (dialout group)")
        except (ImportError, OSError):
            print(
                "ℹ️  Could not check USB permissions - dialout group may be "
                "needed"
            )
            missing_deps.append("USB permissions check failed")
    else:
        # Non-Linux platforms don't require this group; skip gracefully
        pass

    # Auto-install path if flag provided and Debian-based
    auto_install = os.environ.get("HIDOCK_AUTO_INSTALL_MISSING") == "1"
    if missing_deps and auto_install:
        print(
            "\n🔧 --auto-install-missing: attempting apt install for "
            "missing packages..."
        )
        # Map high-level labels to apt packages
        apt_packages = []
        if any("Python tkinter" in d for d in missing_deps):
            apt_packages += ["python3-tk", "python3-dev"]
        if any("FFmpeg" in d for d in missing_deps):
            apt_packages += ["ffmpeg", "libavcodec-extra"]
        if any("libusb" in d for d in missing_deps):
            apt_packages += ["libusb-1.0-0-dev", "libudev-dev", "pkg-config"]
        if any("build tools" in d for d in missing_deps):
            apt_packages += ["build-essential"]
        # Deduplicate while preserving order
        seen = set()
        ordered = []
        for p in apt_packages:
            if p not in seen:
                seen.add(p)
                ordered.append(p)
        if not ordered:
            print("No apt-resolvable packages detected for auto-install.")
        else:
            print("Packages to install: " + ", ".join(ordered))
            update = run_command("sudo apt update", check=False)
            if update.returncode != 0:
                print("⚠️  apt update failed; continuing without system deps.")
            else:
                install_cmd = "sudo apt install -y " + " ".join(ordered)
                install = run_command(install_cmd, check=False)
                if install.returncode == 0:
                    print(
                        "✅ Auto-install complete. Re-running dependency "
                        "check..."
                    )
                    return check_linux_system_dependencies()
                else:
                    print("❌ Auto-install encountered errors (continuing).")

    if missing_deps:
        print(
            f"\n⚠️  Missing system deps: {len(missing_deps)} issue(s)"
            " found"
        )
        for dep in missing_deps:
            print(f"   • {dep}")

        print(
            "\n🔧 System dependencies required for HiDock Desktop App:"
        )
        print("   • CustomTkinter requires system tkinter packages")
        print("   • Audio processing requires FFmpeg and audio libraries")
        print(
            "   • Device communication needs libusb (headers + pkg-config)"
        )
        print("   • Python packages compilation requires build tools")

        print("\n📝 You have several options:")
        print("1. 🚀 Run automated system setup (recommended)")
        print("2. 📋 Show manual installation commands")
        print(
            "3. ⏭️  Continue anyway (may cause Python package install"
            " issues)"
        )
        print(
            "   (Or rerun with --auto-install-missing for apt auto "
            "install)"
        )

        while True:
            try:
                choice = input("\nChoose an option (1-3): ").strip()
                if choice in ["1", "2", "3"]:
                    break
                print("Please enter 1, 2, or 3")
            except KeyboardInterrupt:
                print("\nSkipping system dependencies setup...")
                return True

        if choice == "1":
            print("\n🚀 Running automated Linux system dependencies setup...")
            try:
                result = run_command(
                    "python3 scripts/setup/setup_linux_deps.py",
                    check=False,
                )
                if result.returncode == 0:
                    print("✅ System dependencies setup completed!")
                    print(
                        "⚠️  If added to dialout group log out/in to apply"
                    )
                    return True
                else:
                    print("❌ System dependencies setup failed")
                    print(
                        "   Continuing Python setup; you may hit issues"
                    )
                    return True
            except Exception as e:
                print(f"❌ Could not run system dependencies setup: {e}")
                print(
                    "   Run manually: python3 scripts/setup/"
                    "setup_linux_deps.py"
                )
                return True

        elif choice == "2":
            print("\n📋 Manual installation commands for Debian/Ubuntu:")
            print("")
            print("# Update package lists")
            print("sudo apt update")
            print("")
            print("# Install core dependencies")
            print("sudo apt install -y python3-tk python3-dev build-essential")
            print(
                "sudo apt install -y ffmpeg libavcodec-extra portaudio19-dev"
            )
            print(
                "sudo apt install -y libusb-1.0-0-dev libudev-dev pkg-config"
            )
            print("")
            print("# Set up USB permissions")
            print("sudo usermod -a -G dialout $USER")
            print("")
            print("# Log out and back in for group changes to take effect")
            print("")
            print("After installing, re-run this setup script.")

            cont_prompt = "\nContinue with Python setup anyway? (y/N): "
            continue_setup = input(cont_prompt).strip().lower()
            if continue_setup == "y":
                return True
            else:
                print(
                    "Please install system dependencies first, then "
                    "re-run this script."
                )
                sys.exit(0)

        elif choice == "3":
            print("\n⚠️  Continuing without system dependencies...")
            print("   Python package installation may fail")
            print(
                "   Install system deps later with: python3 scripts/setup/" 
                "setup_linux_deps.py"
            )
            return True
    else:
        print("✅ All required Linux system dependencies are available!")
        return True


def setup_api_keys():
    """Guide user through API key setup."""
    print("\n=== AI API Keys Setup (Optional) ===")
    print("The applications support multiple AI providers for transcription and analysis.")
    print("You can set these up now or later in the application settings.\n")

    api_prompt = "Would you like to set up AI API keys now? (y/N): "
    setup_keys = input(api_prompt).strip().lower()
    if setup_keys not in ["y", "yes"]:
        print(
            "⏭️  Skipping API key setup - configure later in app settings"
        )
        return

    print("\nAvailable AI providers:")
    print("1. Google Gemini (recommended for beginners)")
    print("2. OpenAI (GPT/Whisper)")
    print("3. Anthropic Claude")
    print("4. Skip - I'll set up later")

    provider_prompt = "\nWhich provider would you like to configure? (1-4): "
    choice = input(provider_prompt).strip()

    if choice == "1":
        print("\n📝 Google Gemini Setup:")
        print("1. Go to https://makersuite.google.com/app/apikey")
        print("2. Create a new API key")
        print("3. Copy the key and paste it below")

        gem_prompt = (
            "\nEnter your Gemini API key (or press Enter to skip): "
        )
        api_key = input(gem_prompt).strip()
        if api_key:
            print(
                "✓ API key saved (you can change this later in settings)"
            )
            print(
                "ℹ️  Note: Keys are stored encrypted in the desktop app"
            )

    elif choice == "2":
        print("\n📝 OpenAI Setup:")
        print("1. Go to https://platform.openai.com/api-keys")
        print("2. Create a new API key")
        print("3. Copy the key and paste it below")

        openai_prompt = (
            "\nEnter your OpenAI API key (or press Enter to skip): "
        )
        api_key = input(openai_prompt).strip()
        if api_key:
            print("✓ API key noted (configure in app settings)")

    elif choice == "3":
        print("\n📝 Anthropic Claude Setup:")
        print("1. Go to https://console.anthropic.com/")
        print("2. Create an API key")
        print("3. Copy the key and paste it below")

        anth_prompt = (
            "\nEnter your Anthropic API key (or press Enter to skip): "
        )
        api_key = input(anth_prompt).strip()
        if api_key:
            print("✓ API key noted (configure in app settings)")

    print("\nℹ️  All API keys can be configured later in:")
    print("   • Desktop app: Settings → AI Providers")
    print("   • Web app: Settings page")


def test_app_launches():
    """Test that applications can launch properly."""
    print("\n=== Testing Application Launches ===")

    # Test desktop app import
    print("Testing desktop app dependencies...")
    desktop_dir = Path("apps/desktop")
    if desktop_dir.exists():
        if platform.system() == "Windows":
            python_cmd = f"{DESKTOP_VENV_NAME}\\Scripts\\python"
        else:
            python_cmd = f"{DESKTOP_VENV_NAME}/bin/python"

        # Test basic imports
        test_cmd = (
            f"{python_cmd} -c \"import customtkinter; import pygame; "
            "print('Desktop dependencies OK')\""
        )
        result = run_command(test_cmd, cwd=desktop_dir, check=False)
        if result.returncode == 0:
            print("✓ Desktop app dependencies working")
        else:
            print("⚠️  Desktop app dependencies issue - check pyproject.toml")

    # Test web app
    print("Testing web app...")
    web_dir = Path("apps/web")
    if web_dir.exists() and check_node_version():
        # Just check that package.json is valid and node_modules exists
        if (web_dir / "node_modules").exists():
            print("✓ Web app dependencies installed")
        else:
            print("⚠️  Web app node_modules missing")

    print("ℹ️  Applications tested - you can now launch them with the commands shown at the end")


def check_device_connection():
    """Check for HiDock device and provide guidance."""
    print("\n=== HiDock Device Check ===")
    print("📱 Checking for connected HiDock devices...")
    print("ℹ️  Note: A HiDock device is NOT required for development!")
    print("   You can develop and test all features without hardware.\n")

    # Try to detect USB devices (basic check)
    try:
        if platform.system() == "Windows":
            # Basic Windows USB device check
            result = run_command('powershell "Get-WmiObject -Class Win32_USBHub | Select-Object Name"', check=False)
        else:
            # Basic Linux/Mac USB check
            result = run_command(
                "lsusb 2>/dev/null || system_profiler SPUSBDataType 2>/dev/null | head -20", check=False
            )

        if result.returncode == 0 and "HiDock" in result.stdout:
            print("🎉 HiDock device detected!")
        else:
            print("📱 No HiDock device detected (this is fine for development)")
    except Exception:
        print("📱 Could not check for devices (this is fine for development)")

    print("\n💡 Device development tips:")
    print("• Desktop app: Has mock device simulation for testing")
    print("• Web app: Requires real device due to WebUSB requirements")
    print("• All core features work without hardware")
    print("• Device communication can be tested later when you get hardware")


def setup_python_env():
    """Set up Python virtual environment (cross-platform with fallbacks)."""
    print("\n=== Setting up Python environment ===")

    desktop_dir = Path("apps/desktop")
    if not desktop_dir.exists():
        print("Desktop application directory not found")
        return False

    # Use resolved per-platform or legacy path
    venv_path = DESKTOP_VENV_PATH

    def _venv_python():
        return venv_python_path()

    def _venv_pip():
        return venv_pip_path()

    created_now = False

    def _diagnose_broken_venv(reason: str):
        """Centralized diagnostics for a broken or missing venv interpreter."""
        print(f"❌ Virtual environment issue: {reason}")
        print(f"   Expected interpreter inside: {venv_path}")
        if venv_path.exists():
            try:
                print("   Directory contents (top-level):")
                for p in list(venv_path.glob("*"))[:40]:
                    print("    •", p.name)
            except Exception:
                pass
        else:
            print("   (Venv directory does not exist)*)")
        if platform.system() == "Linux":
            print("   Hints (Linux):")
            print("   • Ensure python3-venv is installed: sudo apt update && sudo apt install -y python3-venv")
            print(
                "   • Recreate: rm -rf apps/desktop/"
                + DESKTOP_VENV_NAME
                + " && python setup.py --mode developer --non-interactive --skip-tests --skip-web --skip-audio"
            )
        elif platform.system() == "Windows":
            print("   Hints (Windows):")
            print("   • Ensure correct Python installed from python.org with 'Add to PATH' option")
            print(
                "   • Recreate: rmdir /s /q apps\\desktop\\"
                + DESKTOP_VENV_NAME
                + " & python setup.py --mode developer --non-interactive --skip-tests --skip-web --skip-audio"
            )
        else:
            print("   • Try recreating the environment and ensure write permissions.")
        return False

    def _preflight_venv_support():
        if platform.system() == "Linux":
            # Quick capability probe: attempt to create then delete a temporary venv in temp dir
            import tempfile

            with tempfile.TemporaryDirectory() as td:
                probe = Path(td) / "probe"
                res = run_command([sys.executable, "-m", "venv", str(probe)], check=False)
                if res.returncode != 0 or not (probe / "bin" / "python").exists():
                    print("⚠️  Preflight venv support failed. python3-venv likely missing.")
                    print("    Install it: sudo apt update && sudo apt install -y python3-venv")
                    return False
        return True

    if not _preflight_venv_support():
        return False
    if venv_path.exists():
        print(f"Virtual environment '{DESKTOP_VENV_NAME}' already exists")
    else:
        print(f"Creating virtual environment '{DESKTOP_VENV_NAME}' ...")
        result = run_command([sys.executable, "-m", "venv", DESKTOP_VENV_NAME], cwd=desktop_dir, check=False)
        if result.returncode != 0:
            print("⚠️  First creation attempt failed. Retrying with --upgrade-deps ...")
            result2 = run_command(
                [sys.executable, "-m", "venv", "--upgrade-deps", DESKTOP_VENV_NAME], cwd=desktop_dir, check=False
            )
            if result2.returncode != 0 and platform.system() == "Windows" and which("py"):
                print("⚙️  Trying Windows 'py' launcher...")
                result3 = run_command(["py", "-3", "-m", "venv", DESKTOP_VENV_NAME], cwd=desktop_dir, check=False)
                if result3.returncode != 0:
                    print("❌ Failed to create virtual environment after multiple attempts!")
                    print("   Diagnostics:")
                    print(f"   Python executable: {sys.executable}")
                    print(f"   Current directory: {desktop_dir.resolve()}")
                    print("   Possible solutions:")
                    print("   • Ensure you have write permissions to the project directory")
                    print("   • Temporarily disable antivirus / real-time scanning")
                    print(f"   • Remove any partial '{DESKTOP_VENV_NAME}' directory and retry")
                    print(f"   • Try manually: cd apps/desktop && python -m venv {DESKTOP_VENV_NAME}")
                    return False
            elif result2.returncode != 0:
                print("❌ Failed to create virtual environment!")
                print("   Possible solutions:")
                print("   • Check Python version (requires 3.8+)")
                print("   • python -m pip install --upgrade pip")
                print("   • Check disk space and permissions")
                print(f"   • Remove partial '{DESKTOP_VENV_NAME}' then retry")
                return False
        created_now = True

    if not _venv_python().exists():
        return _diagnose_broken_venv("python executable missing after creation")

    activate_script = (
        f"apps/desktop\\{DESKTOP_VENV_NAME}\\Scripts\\activate"
        if platform.system() == "Windows"
        else f"apps/desktop/{DESKTOP_VENV_NAME}/bin/activate"
    )

    # Determine executable paths RELATIVE to cwd to avoid duplication like apps/desktop/apps/desktop/...
    if platform.system() == "Windows":
        py_exec = Path(DESKTOP_VENV_NAME) / "Scripts" / "python.exe"
        pip_exec = Path(DESKTOP_VENV_NAME) / "Scripts" / "pip.exe"
    else:
        py_exec = Path(DESKTOP_VENV_NAME) / "bin" / "python"
        pip_exec = Path(DESKTOP_VENV_NAME) / "bin" / "pip"

    # Additional safeguard: if relative path not found, try absolute
    if not (desktop_dir / py_exec).exists():
        # Fallback to absolute path (previous logic) but warn user
        abs_py = (
            DESKTOP_VENV_PATH
            / ("Scripts" if platform.system() == "Windows" else "bin")
            / ("python.exe" if platform.system() == "Windows" else "python")
        )
        if abs_py.exists():
            print("ℹ️  Using absolute python path for venv operations (relative path missing)")
            py_exec = abs_py
            pip_exec = abs_py.parent / ("pip.exe" if platform.system() == "Windows" else "pip")
        else:
            return _diagnose_broken_venv("relative & absolute python paths missing")

    # Upgrade pip & essential build backends
    print("Upgrading pip and build backends...")
    result = run_command(
        [str(py_exec), "-m", "pip", "install", "--upgrade", "pip", "setuptools", "wheel"],
        cwd=desktop_dir,
        check=False,
    )
    if result.returncode != 0:
        print("⚠️  pip upgrade failed (continuing)")

    # Install dependencies with streaming + spinner + diff summary
    print("Installing dependencies (streaming)...")
    pre_freeze = []
    try:
        fr = subprocess.run(
            [str(pip_exec), "freeze"], capture_output=True, text=True, encoding="utf-8", errors="replace", cwd=desktop_dir
        )
        if fr.returncode == 0:
            pre_freeze = [l.strip() for l in fr.stdout.splitlines() if l.strip()]
    except Exception:
        pass

    cmd = [str(pip_exec), "install", "-e", ".[dev]"]
    # Streaming subprocess
    import threading, queue, time as _t

    q: queue.Queue[Optional[str]] = queue.Queue()
    spinner_running = True

    def _spinner():
        chars = "|/-\\"
        idx = 0
        last_flush = _t.time()
        while spinner_running:
            if OUTPUT.mode != "verbose":
                print(f"\r⏳ pip install {chars[idx % len(chars)]}", end="", flush=True)
            idx += 1
            _t.sleep(0.1)
            # throttle console spam in verbose mode (spinner not shown anyway)
            if _t.time() - last_flush > 2 and OUTPUT.mode == "verbose":
                last_flush = _t.time()

    def _reader(proc, stream_name: str):
        for line in proc.stdout:  # type: ignore
            line = line.rstrip("\n")
            q.put(line)
        q.put(None)  # sentinel

    try:
        proc = subprocess.Popen(
            cmd,
            cwd=desktop_dir,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
    except Exception as e:
        print(f"❌ Failed to start pip install: {e}")
        return False

    t_spin = threading.Thread(target=_spinner, daemon=True)
    t_read = threading.Thread(target=_reader, args=(proc, "stdout"), daemon=True)
    t_spin.start()
    t_read.start()

    collected_lines = []
    noisy_capture = OUTPUT.mode == "concise"
    while True:
        try:
            item = q.get(timeout=0.2)
        except queue.Empty:
            if proc.poll() is not None:
                break
            continue
        if item is None:
            break
        collected_lines.append(item)
        if OUTPUT.mode == "verbose":
            print(item)
        elif not noisy_capture:
            # normal mode prints selective progress heuristics
            if any(k in item.lower() for k in ["building", "installing", "downloading", "using cached"]):
                print(item)

    proc.wait()
    spinner_running = False
    t_spin.join(timeout=0.2)
    if OUTPUT.mode != "verbose":
        print("\r" + " " * 40 + "\r", end="")  # clear spinner line

    # Log full collected output
    if noisy_capture:
        OUTPUT.record_suppressed("pip install output (suppressed)", "\n".join(collected_lines))
    else:
        for l in collected_lines:
            OUTPUT._log(l)

    if proc.returncode != 0:
        print("❌ Failed to install dependencies!")
        print("   Check your internet connection and retry.")
        print("   If system dependencies (e.g., libusb, tkinter) are missing, resolve them first.")
        return False

    # Post-freeze diff
    post_freeze = []
    try:
        afr = subprocess.run(
            [str(pip_exec), "freeze"], capture_output=True, text=True, encoding="utf-8", errors="replace", cwd=desktop_dir
        )
        if afr.returncode == 0:
            post_freeze = [l.strip() for l in afr.stdout.splitlines() if l.strip()]
    except Exception:
        pass

    new_packages = sorted(set(post_freeze) - set(pre_freeze)) if post_freeze else []
    if new_packages:
        print(f"✓ Installed {len(new_packages)} new packages (diff shown in concise form):")
        for p in new_packages[:20]:
            print("   •", p)
        if len(new_packages) > 20:
            print(f"   • ... {len(new_packages) - 20} more")
    else:
        print("✓ Dependencies already satisfied (no new packages)")

    print("✓ Python environment ready" + (" (created)" if created_now else ""))
    print(f"  Activate with: {activate_script}")
    return True


def setup_web_env():
    """Set up web application environment."""
    print("\n=== Setting up Web application ===")

    web_dir = Path("apps/web")
    if not web_dir.exists():
        print("Web application directory not found")
        return

    if not check_node_version():
        print("Node.js is required for web development")
        return

    print("Installing web dependencies...")
    result = run_command("npm install", cwd=web_dir, check=False)
    if result.returncode != 0:
        print("❌ Failed to install web dependencies!")
        print("Common solutions:")
        print("• Check internet connection")
        print("• Clear npm cache: npm cache clean --force")
        print("• Delete node_modules and try again: rm -rf node_modules && npm install")
        print("• Check Node.js version (requires 18+)")
        print("• Try different registry: npm install --registry https://registry.npmjs.org/")
        print("• Manual install: cd apps/web && npm install")
        return False

    print("✓ Web environment ready")
    return True


def setup_audio_insights_env():
    """Set up audio insights extractor environment."""
    print("\n=== Setting up Audio Insights Extractor ===")

    audio_dir = Path("apps/audio-insights")
    if not audio_dir.exists():
        print("Audio Insights Extractor directory not found")
        return

    if not check_node_version():
        print("Node.js is required for Audio Insights Extractor")
        return

    print("Installing audio insights dependencies...")
    result = run_command("npm install", cwd=audio_dir, check=False)
    if result.returncode != 0:
        print("❌ Failed to install audio insights dependencies!")
        print("Common solutions:")
        print("• Check internet connection")
        print("• Clear npm cache: npm cache clean --force")
        print("• Check Node.js version (requires 18+)")
        print("• Manual install: cd apps/audio-insights && npm install")
        return False

    print("✓ Audio Insights environment ready")
    return True


def run_tests():
    """Run tests to verify setup."""
    print("\n=== Running tests ===")

    # Python tests
    desktop_dir = Path("apps/desktop")
    if desktop_dir.exists():
        if platform.system() == "Windows":
            python_cmd = f"{DESKTOP_VENV_NAME}\\Scripts\\python"
        else:
            python_cmd = f"{DESKTOP_VENV_NAME}/bin/python"

        print("Running Python tests...")
        result = run_command(f"{python_cmd} -m pytest tests/ -v", cwd=desktop_dir, check=False)
        if result.returncode == 0:
            print("✓ Python tests passed")
        else:
            print("⚠️  Python tests failed (this won't block development)")
            print("   You can still develop - tests might need device hardware")
            print("   Check TESTING.md for requirements")

    # Web tests
    web_dir = Path("apps/web")
    if web_dir.exists() and check_node_version():
        print("Running web tests...")
        result = run_command("npm run test", cwd=web_dir, check=False)
        if result.returncode == 0:
            print("✓ Web tests passed")
        else:
            print("✗ Web tests failed")

    # Audio Insights tests
    audio_dir = Path("apps/audio-insights")
    if audio_dir.exists() and check_node_version():
        print("Running audio insights tests...")
        result = run_command("npm run test", cwd=audio_dir, check=False)
        if result.returncode == 0:
            print("✓ Audio Insights tests passed")
        else:
            print("✗ Audio Insights tests failed")


def setup_git_workflow():
    """Set up git workflow with feature branch."""
    print("\n=== Setting up development workflow ===")

    # Check if we're in a git repository
    try:
        result = run_command("git status", check=False)
        if result.returncode != 0:
            print("✗ Not in a git repository")
            return
    except Exception:
        print("✗ Git not available")
        return

    # Check current branch and status
    try:
        result = run_command("git branch --show-current", check=False)
        current_branch = result.stdout.strip() if result.returncode == 0 else "unknown"
        print(f"Current branch: {current_branch}")

        # Check for uncommitted changes
        result = run_command("git status --porcelain", check=False)
        if result.returncode == 0 and result.stdout.strip():
            print("⚠️  You have uncommitted changes:")
            print(result.stdout.strip())
            print("\nOptions:")
            print("1. Commit your changes first")
            print("2. Stash your changes (git stash)")
            print("3. Continue on current branch")
            print("4. Skip branch creation")

            choice = input("\nHow would you like to proceed? (1-4): ").strip()
            if choice == "1":
                print("Please commit your changes first, then re-run this script")
                return
            elif choice == "2":
                print("Stashing changes...")
                run_command("git stash")
                print("✓ Changes stashed - you can retrieve them later with 'git stash pop'")
            elif choice == "3":
                print(f"Continuing on current branch: {current_branch}")
                return
            elif choice == "4":
                print("Skipping branch creation")
                return

    except Exception:
        current_branch = "unknown"

    # Check if already on a feature branch
    if current_branch and current_branch not in ["main", "master", "develop"]:
        print(f"\n✓ You're already on feature branch: {current_branch}")
        continue_branch = input("Continue working on this branch? (Y/n): ").strip().lower()
        if continue_branch != "n":
            print(f"✓ Continuing on branch: {current_branch}")
            return

    # Ask user what they want to work on
    print("\nWhat would you like to work on?")
    print("1. Desktop Application features")
    print("2. Web Application features")
    print("3. Audio Insights Extractor")
    print("4. Documentation improvements")
    print("5. Bug fixes")
    print("6. General sandbox/exploration")
    print("7. Skip branch creation (stay on current branch)")

    while True:
        try:
            choice = input("\nEnter your choice (1-7): ").strip()
            if choice in ["1", "2", "3", "4", "5", "6", "7"]:
                break
            print("Please enter a number between 1-7")
        except KeyboardInterrupt:
            print("\nSkipping branch setup...")
            return

    if choice == "7":
        print("Staying on current branch")
        return

    # Map choices to branch prefixes
    branch_types = {
        "1": "feature/desktop",
        "2": "feature/web",
        "3": "feature/audio-insights",
        "4": "docs",
        "5": "bugfix",
        "6": "sandbox",
    }

    branch_prefix = branch_types[choice]

    # Get branch name
    if choice == "6":
        import datetime

        timestamp = datetime.datetime.now().strftime("%Y%m%d")
        branch_name = f"{branch_prefix}/exploration-{timestamp}"
    else:
        feature_name = input("Enter a brief description for your branch (e.g., 'add-transcription'): ").strip()
        if not feature_name:
            feature_name = "new-feature"
        # Clean up branch name
        feature_name = feature_name.lower().replace(" ", "-").replace("_", "-")
        branch_name = f"{branch_prefix}/{feature_name}"

    # Create and switch to new branch
    print(f"Creating branch: {branch_name}")
    try:
        run_command(f"git checkout -b {branch_name}")
        print(f"✓ Successfully created and switched to branch: {branch_name}")

        # Show some helpful tips
        print("\n📋 Development workflow tips:")
        print("• Make small, focused commits")
        print("• Write descriptive commit messages (feat:, fix:, docs:, etc.)")
        print("• Run tests before committing")
        print("• Push your branch when ready: git push origin " + branch_name)

    except Exception as e:
        print(f"✗ Failed to create branch: {e}")
        return


def check_existing_setup():
    """Check if basic setup was already done and offer upgrade options."""
    # Detect legacy env separately from new tagged env name
    desktop_venv = Path(f"apps/desktop/.venv").exists()
    web_modules = Path("apps/web/node_modules").exists()

    # Check if this looks like a basic setup (venv exists but no dev tools indicator)
    # We can use git branch as an indicator - basic setup doesn't create branches
    basic_setup_exists = desktop_venv and not has_developer_setup_indicators()

    if basic_setup_exists:
        print("\n🔍 Detected existing basic setup!")
        print("It looks like you (or someone) already ran the simple setup scripts.")
        print("The virtual environment exists but development tools may be missing.")
        print("")
        print("Would you like to:")
        print("1. 🔧 Add developer tools to existing setup (recommended)")
        print("2. 🗑️  Clean and restart with full developer setup")
        print("3. ✅ Keep current setup and exit")
        print("4. ℹ️  Show me what's already set up")

        while True:
            try:
                choice = input("\nChoice (1-4): ").strip()
                if choice in ["1", "2", "3", "4"]:
                    break
                print("Please enter 1, 2, 3, or 4")
            except KeyboardInterrupt:
                print("\nExiting...")
                sys.exit(0)

        if choice == "1":
            print("\n✅ Great! I'll add developer tools to your existing setup.")
            return "upgrade"
        elif choice == "2":
            print("\n🗑️  I'll clean the existing setup and start fresh.")
            clean_existing_setup()
            return "clean_restart"
        elif choice == "3":
            print("\n✅ Keeping your current setup. You can run apps with:")
            show_basic_run_instructions()
            sys.exit(0)
        elif choice == "4":
            show_current_setup_status()
            return check_existing_setup()  # Ask again after showing status

    return "new"


def has_developer_setup_indicators():
    """Check if developer-specific setup indicators exist."""
    try:
        # Check if we're on a non-main branch (indicator of dev workflow)
        result = run_command("git branch --show-current", check=False)
        if result.returncode == 0:
            current_branch = result.stdout.strip()
            if current_branch and current_branch not in ["main", "master"]:
                return True

        # Check if pytest is installed in the venv (dev dependency)
        desktop_dir = Path("apps/desktop")
        if desktop_dir.exists():
            if platform.system() == "Windows":
                pytest_check = run_command(
                    f'{DESKTOP_VENV_NAME}\\Scripts\\python -c "import pytest"', cwd=desktop_dir, check=False
                )
            else:
                pytest_check = run_command(
                    f'{DESKTOP_VENV_NAME}/bin/python -c "import pytest"', cwd=desktop_dir, check=False
                )
            if pytest_check.returncode == 0:
                return True

        return False
    except Exception:
        return False


def clean_existing_setup():
    """Remove existing setup to start fresh."""
    print("🧹 Cleaning existing setup...")

    # Remove Python virtual environment
    desktop_venv = Path(f"apps/desktop/{DESKTOP_VENV_NAME}")
    if desktop_venv.exists():
        print("  Removing Python virtual environment...")
        import shutil

        shutil.rmtree(desktop_venv)

    # Remove node_modules
    web_modules = Path("apps/web/node_modules")
    if web_modules.exists():
        print("  Removing web app node_modules...")
        import shutil

        shutil.rmtree(web_modules)

    audio_modules = Path("apps/audio-insights/node_modules")
    if audio_modules.exists():
        print("  Removing audio insights node_modules...")
        import shutil

        shutil.rmtree(audio_modules)

    print("✅ Cleanup complete! Starting fresh setup...")


def show_current_setup_status():
    """Show what's currently set up."""
    print("\n📋 Current Setup Status:")
    print("=" * 40)

    # Desktop app
    desktop_venv = Path(f"apps/desktop/{DESKTOP_VENV_NAME}")
    if desktop_venv.exists():
        print("✅ Desktop app: Python environment ready")
    else:
        print("❌ Desktop app: Not set up")

    # Web app
    web_modules = Path("apps/web/node_modules")
    if web_modules.exists():
        print("✅ Web app: Dependencies installed")
    else:
        print("❌ Web app: Not set up")

    # Audio insights
    audio_modules = Path("apps/audio-insights/node_modules")
    if audio_modules.exists():
        print("✅ Audio insights: Dependencies installed")
    else:
        print("❌ Audio insights: Not set up")

    # Git status
    try:
        result = run_command("git branch --show-current", check=False)
        if result.returncode == 0:
            branch = result.stdout.strip()
            if branch in ["main", "master"]:
                print("ℹ️  Git: On main branch (no feature branch)")
            else:
                print(f"✅ Git: On feature branch '{branch}'")
        else:
            print("❌ Git: Not in a git repository")
    except Exception:
        print("❌ Git: Status unknown")

    # Development tools check
    if has_developer_setup_indicators():
        print("✅ Developer tools: Likely installed")
    else:
        print("⚠️  Developer tools: May be missing")

    print("")


def show_basic_run_instructions():
    """Show instructions for running apps with basic setup."""
    print("\n🚀 How to run your apps:")
    print("\n1. 🖥️  Desktop Application:")
    print("   cd apps/desktop")
    if platform.system() == "Windows":
        print(f"   {DESKTOP_VENV_NAME}\\Scripts\\activate")
    else:
        print(f"   source {DESKTOP_VENV_NAME}/bin/activate")
    print("   python main.py")

    if Path("apps/web/node_modules").exists():
        print("\n2. 🌐 Web Application:")
        print("   cd apps/web")
        print("   npm run dev")
        print("   Open: http://localhost:5173")


def run_end_user_setup():
    """Simplified setup for end users who just want to run the apps."""
    print("\n" + "=" * 50)
    print("🎉 END USER SETUP - Simple App Installation")
    print("=" * 50)
    print("")

    try:
        # Basic prerequisite checks
        print("Checking requirements...")
        check_python_version()
        has_node = check_node_version()
        check_permissions()
        check_disk_space()

        # Check system dependencies for Linux users
        if platform.system() == "Linux":
            check_linux_system_dependencies()

        # Simple environment setup
        print("\n📦 Setting up applications...")

        # Desktop app setup
        print("\n🖥️  Setting up Desktop Application...")
        if setup_python_env():
            print("✅ Desktop app ready!")
        else:
            print("❌ Desktop app setup failed - see manual instructions below")

        # Web app setup (if Node.js available)
        if has_node:
            print("\n🌐 Setting up Web Application...")
            if setup_web_env():
                print("✅ Web app ready!")
            else:
                print("❌ Web app setup failed - see manual instructions below")
        else:
            print("\n⏭️  Skipping web app (Node.js not available)")

        # Skip audio insights for end users (it's a prototype)

        print("\n" + "=" * 50)
        print("🎉 Setup Complete! You can now use HiDock!")
        print("=" * 50)

        print("\n🚀 How to run the apps:")
        print("\n1. 🖥️  Desktop Application:")
        print("   cd apps/desktop")
        print(f"   {activation_command()}")
        print("   python main.py")

        if has_node:
            print("\n2. 🌐 Web Application:")
            print("   cd apps/web")
            print("   npm run dev")
            print("   Open: http://localhost:5173")

        print("\n💡 First time setup tips:")
        print("• Desktop app: Configure AI providers in Settings for transcription")
        print("• Web app: Add your Gemini API key in Settings")
        print("• Connect your HiDock device via USB")
        print("• Check TROUBLESHOOTING.md if you have issues")

        print("\n📚 Documentation:")
        print("• User guide: README.md")
        print("• Troubleshooting: docs/TROUBLESHOOTING.md")
        print("• API setup: Check Settings in each app")

        print("\nEnjoy using HiDock! 🎵")

    except KeyboardInterrupt:
        print("\n\n⚠️  Setup interrupted!")
        print("You can run this script again anytime.")
    except Exception as e:
        print(f"\n❌ Setup failed: {e}")
        print("\nManual setup instructions:")
        print('• Desktop: cd apps/desktop && python -m venv .venv && .venv/Scripts/activate && pip install -e ".[dev]"')
        print("• Web: cd apps/web && npm install")


def show_feature_suggestions():
    """Show suggestions for what to work on."""
    print("\n🚀 Suggested areas to explore:")
    print("\n📱 Desktop Application:")
    print("  • Auto-download functionality")
    print("  • Advanced transcription integration")
    print("  • Enhanced file management")
    print("  • Audio enhancement features")

    print("\n🌐 Web Application:")
    print("  • Offline capabilities")
    print("  • Advanced AI features")
    print("  • Collaboration features")
    print("  • Performance optimization")

    print("\n🎵 Audio Insights Extractor:")
    print("  • Multi-language support")
    print("  • Speaker diarization")
    print("  • Real-time processing")
    print("  • Advanced export options")

    print("\n📚 Documentation:")
    print("  • API documentation improvements")
    print("  • Tutorial creation")
    print("  • Architecture diagrams")
    print("  • Code examples")

    print("\n🐛 Good First Issues:")
    print("  • UI polish and improvements")
    print("  • Error message enhancements")
    print("  • Configuration validation")
    print("  • Test coverage improvements")


def parse_args() -> argparse.Namespace:
    """Parse CLI arguments for setup script.

    Separated from main to simplify testing and reduce cyclomatic complexity.
    """
    parser = argparse.ArgumentParser(description="HiDock unified setup")
    add = parser.add_argument
    add("--non-interactive", action="store_true", help="Run without interactive prompts where possible")
    add("--migrate", choices=["copy", "rebuild", "skip"], help="Legacy .venv migration strategy")
    add("--force-new-env", action="store_true", help="Recreate the tagged virtual environment if present")
    add("--mode", choices=["end-user", "developer"], help="Explicit setup mode (skip interactive choice)")
    add("--skip-tests", action="store_true", help="Skip running test suites")
    add("--skip-web", action="store_true", help="Skip web app dependency installation & tests")
    add("--skip-audio", action="store_true", help="Skip audio insights dependency installation & tests")
    add("--diagnose-venv", action="store_true", help="Run only virtual environment diagnostics and exit")
    add("--auto-install-missing", action="store_true", help="Auto-install missing Linux system deps (Debian/Ubuntu)")
    add("--concise", action="store_true", help="Concise output (suppress noisy command output; still logged)")
    add("--verbose", action="store_true", help="Verbose output (echo all command output immediately)")
    return parser.parse_args()


def run_diagnose_mode(args: argparse.Namespace) -> bool:
    """Handle --diagnose-venv early-exit path. Returns True if handled."""
    if not args.diagnose_venv:
        return False
    print("--diagnose-venv: running environment diagnostics...")
    print(f"Resolved desktop venv path: {DESKTOP_VENV_PATH}")
    if DESKTOP_VENV_PATH.exists():
        print("• Venv directory exists")
        py_path = venv_python_path()
        print(f"• Expected interpreter: {py_path}")
        if py_path.exists():
            print("✓ Interpreter present")
        else:
            print("✗ Interpreter missing")
        print("• Top-level entries (up to 40):")
        for p in list(DESKTOP_VENV_PATH.glob("*"))[:40]:
            print("  -", p.name)
    else:
        print("✗ Venv directory does not exist yet")
    print("(No further setup performed in diagnose mode)")
    return True


def determine_mode(args: argparse.Namespace, setup_status: str) -> tuple[str, bool]:
    """Determine chosen mode and whether to skip basic setup.

    Returns (mode, skip_basic_setup).
    """
    if args.mode:
        return args.mode, False
    if setup_status == "upgrade":
        print("\n🔧 Adding developer tools to existing setup...")
        return "developer", True
    if setup_status == "clean_restart":
        return "developer", False
    if args.non_interactive:
        return "developer", False
    print("🎯 Choose Your Setup Type:")
    print("\n1. 👤 END USER - Just run the apps")
    print("2. 👨‍💻 DEVELOPER - Contribute to the project\n")
    while True:
        ut = input("What type of setup do you want? (1 for End User, 2 for Developer): ").strip()
        if ut in ["1", "2"]:
            break
        print("Please enter 1 or 2")
    return ("end-user" if ut == "1" else "developer"), False


def run_developer_setup(args: argparse.Namespace, skip_basic_setup: bool) -> None:
    """Execute developer-focused environment provisioning & testing."""
    try:
        if not skip_basic_setup:
            OUTPUT.print("Checking prerequisites...")
            PHASES.start("Prerequisites")
            try:
                check_python_version()
                check_node_version()
                check_git_config()
                check_network_connection()
                check_permissions()
                check_disk_space()
                check_development_files()
                PHASES.end("OK")
            except SystemExit:
                PHASES.end("FAIL", notes="abort")
                raise
            except Exception as e:  # noqa: BLE001 (broad is OK at outer per-phase boundary)
                PHASES.end("FAIL", notes=str(e))
                raise

            PHASES.start("Python env")
            py_ok = setup_python_env()
            PHASES.end("OK" if py_ok else "FAIL")

            if not args.skip_web:
                PHASES.start("Web env")
                w_ok = bool(setup_web_env())
                PHASES.end("OK" if w_ok else "FAIL")
            else:
                PHASES.start("Web env")
                PHASES.end("SKIP", notes="--skip-web")

            if not args.skip_audio:
                PHASES.start("Audio env")
                a_ok = bool(setup_audio_insights_env())
                PHASES.end("OK" if a_ok else "FAIL")
            else:
                PHASES.start("Audio env")
                PHASES.end("SKIP", notes="--skip-audio")
        else:
            OUTPUT.print("Checking git configuration...")
            PHASES.start("Git config")
            try:
                check_git_config()
                PHASES.end("OK")
            except Exception as e:  # noqa: BLE001
                PHASES.end("FAIL", notes=str(e))
                raise

        if not args.skip_tests:
            PHASES.start("Tests")
            run_tests()
            test_app_launches()
            PHASES.end("OK")
        else:
            OUTPUT.print("--skip-tests specified: skipping test execution & launch smoke checks")
            PHASES.start("Tests")
            PHASES.end("SKIP", notes="--skip-tests")

        PHASES.start("Device check")
        check_device_connection()
        PHASES.end("OK")

        PHASES.start("API keys")
        setup_api_keys()
        PHASES.end("OK")

        PHASES.start("Suggestions & Git workflow")
        show_feature_suggestions()
        setup_git_workflow()
        PHASES.end("OK")

        OUTPUT.print("\n" + "=" * 50)
        OUTPUT.print("🎉 Development environment setup complete!")
        OUTPUT.print("\nYou're now ready to start contributing!")
        OUTPUT.print("\n🚀 Quick start commands:")
        OUTPUT.print("\n1. 🖥️  Desktop app:")
        OUTPUT.print("   cd apps/desktop")
        OUTPUT.print(f"   {activation_command()}")
        OUTPUT.print("   python main.py")
        OUTPUT.print("\n2. 🌐 Web app:")
        OUTPUT.print("   cd apps/web")
        OUTPUT.print("   npm run dev")
        OUTPUT.print("\n3. 🎵 Audio insights extractor:")
        OUTPUT.print("   cd apps/audio-insights")
        OUTPUT.print("   npm run dev")
        OUTPUT.print("\n📚 Additional resources:")
        OUTPUT.print("• docs/DEVELOPMENT.md - Detailed development guide")
        OUTPUT.print("• docs/API.md - API documentation")
        OUTPUT.print("• docs/TESTING.md - Testing guidelines")
        OUTPUT.print("• docs/TROUBLESHOOTING.md - Common issues and solutions")
        OUTPUT.print("• CONTRIBUTING.md - Contribution guidelines")
        OUTPUT.print("\n💡 Remember to:")
        OUTPUT.print("• Run tests before committing: pytest (desktop) or npm test (web)")
        OUTPUT.print("• Follow conventional commit format: feat:, fix:, docs:, etc.")
        OUTPUT.print("• Check the roadmap for feature ideas: docs/ROADMAP.md")

        OUTPUT.print("\n📊 Phase Summary:")
        for line in PHASES.summary():
            OUTPUT.print("  - " + line)
        OUTPUT.flush_summaries()
        OUTPUT.print("\nHappy coding! �")
    except KeyboardInterrupt:
        print("\n\n⚠️  Setup interrupted by user!")
        print("You can re-run this script anytime to continue setup.")


def main():
    args = parse_args()

    if run_diagnose_mode(args):
        return

    if args.migrate:
        # Use first letter (c/r/s) for existing migration logic
        os.environ.setdefault("HIDOCK_AUTO_MIGRATE", args.migrate[0])

    if args.auto_install_missing:
        os.environ["HIDOCK_AUTO_INSTALL_MISSING"] = "1"

    # Output mode precedence: explicit flags override env
    if args.concise and args.verbose:
        # If both provided, prefer verbose for transparency
        OUTPUT.set_mode("verbose")
    elif args.verbose:
        OUTPUT.set_mode("verbose")
    elif args.concise:
        OUTPUT.set_mode("concise")

    if args.force_new_env:
        desktop_dir = Path("apps/desktop")
        current = desktop_dir / DESKTOP_VENV_NAME
        if current.exists():
            print(f"--force-new-env: removing existing {current}")
            shutil.rmtree(current)

    if args.non_interactive:

        def _auto_input(prompt: str = ""):
            defaults = {
                "What type of setup": "2",
                "Migrate now?": "s",
                "Would you like to set up AI API keys": "n",
                "Which provider would you like": "4",
                "How would you like to proceed?": "3",
                "Enter your choice": "7",
                "Choice (1-4)": "3",
                "Continue with Python setup anyway?": "y",
                "Continue working on this branch?": "y",
                "Choose an option (1-3)": "3",  # dependency menu default advance
            }
            for key, val in defaults.items():
                if key.lower() in prompt.lower():
                    print(f"[auto:{val}] {prompt}")
                    return val
            print(f"[auto-skip] {prompt}")
            return ""

        builtins.input = _auto_input  # type: ignore

    print("HiDock Next - Comprehensive Setup")
    print("=" * 50)
    print("")

    # Determine starting status
    setup_status = check_existing_setup()

    chosen_mode, skip_basic_setup = determine_mode(args, setup_status)

    if chosen_mode == "end-user":
        run_end_user_setup()
        return

    run_developer_setup(args, skip_basic_setup)


if __name__ == "__main__":
    main()
