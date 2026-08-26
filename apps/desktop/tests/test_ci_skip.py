#!/usr/bin/env python3
"""
Opt-in gate for device tests that require real HiDock hardware.

Device tests drive a physical HiDock over USB (backend init, connect, reset). Running
them unattended is unsafe: repeated connect/reset cycles are the known cause of the
device's USB interface getting stuck in the "active" state, after which every program
is refused with LIBUSB_ERROR_ACCESS until the device is drained or power-cycled. They
also cannot pass in CI, where no device exists.

So they are skipped unless BOTH hold:
  * not running in CI, and
  * ``HIDOCK_HARDWARE_TESTS`` is set to a truthy value ("1"/"true"/"yes").

Run them deliberately, with a device attached:
    HIDOCK_HARDWARE_TESTS=1 pytest -m device
"""

import os

import pytest

#: Environment variable that opts in to running real-hardware device tests.
HARDWARE_TESTS_ENV_VAR = "HIDOCK_HARDWARE_TESTS"


def hardware_tests_enabled():
    """
    Check whether real-hardware device tests were explicitly requested.

    Returns:
        bool: True only if HIDOCK_HARDWARE_TESTS is set to a truthy value.
    """
    return os.getenv(HARDWARE_TESTS_ENV_VAR, "").strip().lower() in ("1", "true", "yes", "on")


def is_ci_environment():
    """
    Check if we're running in a CI environment.

    Returns:
        bool: True if running in CI, False otherwise
    """
    ci_indicators = [
        "CI",  # Generic CI indicator
        "GITHUB_ACTIONS",  # GitHub Actions
        "TRAVIS",  # Travis CI
        "JENKINS_URL",  # Jenkins
        "BUILDKITE",  # Buildkite
        "CIRCLECI",  # CircleCI
        "GITLAB_CI",  # GitLab CI
        "APPVEYOR",  # AppVeyor
        "TF_BUILD",  # Azure DevOps
    ]

    return any(os.getenv(indicator) for indicator in ci_indicators)


def skip_if_ci(reason="Test requires local hardware"):
    """
    Decorator to skip tests in CI environments.

    Args:
        reason (str): Reason for skipping the test

    Returns:
        pytest.mark.skipif: Skip marker for CI environments
    """
    return pytest.mark.skipif(is_ci_environment(), reason=f"Skipped in CI: {reason}")


def skip_device_test_if_ci():
    """
    Decorator specifically for device tests that require hardware.

    Returns:
        pytest.mark.skipif: Skip marker for device tests in CI
    """
    return skip_if_ci("Device tests require physical HiDock hardware")


# Pytest marker for device tests. These drive real USB hardware, so they are opt-in:
# skipped in CI (no device) and skipped locally unless HIDOCK_HARDWARE_TESTS is set.
device_test_ci_skip = pytest.mark.skipif(
    is_ci_environment() or not hardware_tests_enabled(),
    reason=(
        "Device tests drive real HiDock USB hardware; "
        f"set {HARDWARE_TESTS_ENV_VAR}=1 (with a device attached) to run them"
    ),
)
