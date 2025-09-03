#!/usr/bin/env python3
"""
CI Skip Configuration for Device Tests

This module provides utilities to skip device tests when running in CI environments
while allowing them to run locally.
"""

import os

import pytest


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


# Pytest marker for device tests that should be skipped in CI
device_test_ci_skip = pytest.mark.skipif(
    is_ci_environment(), reason="Device tests require physical hardware not available in CI"
)
