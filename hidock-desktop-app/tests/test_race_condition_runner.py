#!/usr/bin/env python3
"""
Test runner to verify race condition fixes work properly.

This script runs the problematic tests multiple times to ensure
they don't fail due to race conditions.
"""

import subprocess
import sys
import time


def run_test(test_name, iterations=3):
    """Run a test multiple times to check for race conditions."""
    print(f"\n{'='*60}")
    print(f"Testing: {test_name}")
    print(f"Running {iterations} iterations...")
    print(f"{'='*60}")

    success_count = 0
    failure_count = 0

    for i in range(iterations):
        print(f"\nIteration {i+1}/{iterations}:")

        try:
            # Run the test with minimal output
            result = subprocess.run(
                [
                    sys.executable,
                    "-m",
                    "pytest",
                    f"tests/{test_name}",
                    "-v",
                    "--tb=short",
                    "--disable-warnings",
                    "--cov-report=",
                    "--cov-fail-under=0",  # Disable coverage for this test
                ],
                capture_output=True,
                text=True,
                timeout=60,
            )

            if result.returncode == 0:
                print(f"  ✓ PASSED")
                success_count += 1
            else:
                print(f"  ✗ FAILED")
                print(f"  Error: {result.stderr.strip()}")
                failure_count += 1

        except subprocess.TimeoutExpired:
            print(f"  ✗ TIMEOUT")
            failure_count += 1
        except Exception as e:
            print(f"  ✗ ERROR: {e}")
            failure_count += 1

        # Small delay between iterations
        time.sleep(0.5)

    print(f"\nResults for {test_name}:")
    print(f"  Successes: {success_count}/{iterations}")
    print(f"  Failures:  {failure_count}/{iterations}")

    if failure_count == 0:
        print(f"  🎉 All iterations passed! Race condition likely fixed.")
        return True
    else:
        print(f"  ⚠️  {failure_count} failures detected. Race condition may still exist.")
        return False


def main():
    """Run race condition tests."""
    print("HiDock Race Condition Test Runner")
    print("=" * 60)

    # List of tests that were failing due to race conditions
    problematic_tests = [
        "test_connection_recovery_integration.py::test_connection_recovery_after_error",
        "test_connection_recovery_integration.py::test_gui_connection_retry_logic",
        "test_device_reset.py::test_device_reset_functionality",
        "test_device_reset.py::test_connection_timeout_recovery",
    ]

    all_passed = True

    for test in problematic_tests:
        success = run_test(test, iterations=3)
        if not success:
            all_passed = False

    print(f"\n{'='*60}")
    print("FINAL RESULTS:")
    print(f"{'='*60}")

    if all_passed:
        print("🎉 All tests passed consistently! Race conditions appear to be fixed.")
        return 0
    else:
        print("⚠️  Some tests still failing. Race conditions may need more work.")
        return 1


if __name__ == "__main__":
    sys.exit(main())
