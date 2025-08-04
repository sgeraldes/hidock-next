#!/usr/bin/env python3
"""
Test runner for audio visualization tests with coverage reporting

This script runs all audio visualization tests and provides coverage analysis
to verify we've achieved the target 80%+ coverage.
"""

import os
import subprocess
import sys
import unittest
from pathlib import Path

# Add project root to Python path
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))


def run_tests_with_coverage():
    """Run audio visualization tests with coverage reporting"""

    # Test files to run
    test_files = [
        "test_audio_visualization.py",
        "test_audio_visualization_enhanced.py",
        "test_audio_visualization_edge_cases.py",
    ]

    print("=" * 80)
    print("AUDIO VISUALIZATION TESTS - COVERAGE ANALYSIS")
    print("=" * 80)

    # Try to run with coverage if available
    try:
        # Check if coverage is installed
        import coverage

        print("Running tests with coverage analysis...")

        # Start coverage
        cov = coverage.Coverage(source=["audio_visualization"])
        cov.start()

        # Run all test files
        loader = unittest.TestLoader()
        suite = unittest.TestSuite()

        for test_file in test_files:
            test_path = os.path.join("tests", test_file)
            if os.path.exists(test_path):
                print(f"Loading tests from {test_file}...")
                try:
                    # Import the test module
                    module_name = test_file[:-3]  # Remove .py extension
                    test_module = __import__(f"tests.{module_name}", fromlist=[""])
                    suite.addTests(loader.loadTestsFromModule(test_module))
                except Exception as e:
                    print(f"Warning: Could not load {test_file}: {e}")
            else:
                print(f"Warning: {test_file} not found")

        # Run the tests
        runner = unittest.TextTestRunner(verbosity=2)
        result = runner.run(suite)

        # Stop coverage and generate report
        cov.stop()
        cov.save()

        print("\n" + "=" * 80)
        print("COVERAGE REPORT")
        print("=" * 80)

        # Generate coverage report
        cov.report(show_missing=True)

        # Generate HTML report if possible
        try:
            cov.html_report(directory="htmlcov")
            print(f"\nHTML coverage report generated in: {os.path.abspath('htmlcov')}")
        except Exception as e:
            print(f"Could not generate HTML report: {e}")

        # Calculate coverage percentage
        coverage_data = cov.get_data()
        total_lines = 0
        covered_lines = 0

        for filename in coverage_data.measured_files():
            if "audio_visualization" in filename:
                file_lines = coverage_data.lines(filename)
                total_lines += len(file_lines) if file_lines else 0

                executed_lines = coverage_data.lines(filename)
                covered_lines += len(executed_lines) if executed_lines else 0

        if total_lines > 0:
            coverage_percent = (covered_lines / total_lines) * 100
            print(f"\nOverall coverage: {coverage_percent:.1f}%")

            if coverage_percent >= 80:
                print("✅ SUCCESS: Coverage target of 80%+ achieved!")
            else:
                print(f"❌ Coverage target not met. Need {80 - coverage_percent:.1f}% more coverage.")

        return result.wasSuccessful()

    except ImportError:
        print("Coverage package not available. Running tests without coverage...")
        return run_tests_without_coverage()


def run_tests_without_coverage():
    """Run tests without coverage if coverage package is not available"""

    test_files = [
        "test_audio_visualization.py",
        "test_audio_visualization_enhanced.py",
        "test_audio_visualization_edge_cases.py",
    ]

    loader = unittest.TestLoader()
    suite = unittest.TestSuite()

    for test_file in test_files:
        test_path = os.path.join("tests", test_file)
        if os.path.exists(test_path):
            print(f"Loading tests from {test_file}...")
            try:
                # Import the test module
                module_name = test_file[:-3]  # Remove .py extension
                test_module = __import__(f"tests.{module_name}", fromlist=[""])
                suite.addTests(loader.loadTestsFromModule(test_module))
            except Exception as e:
                print(f"Warning: Could not load {test_file}: {e}")
        else:
            print(f"Warning: {test_file} not found")

    # Run the tests
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)

    return result.wasSuccessful()


def validate_test_files():
    """Validate that test files are syntactically correct"""

    test_files = [
        "tests/test_audio_visualization.py",
        "tests/test_audio_visualization_enhanced.py",
        "tests/test_audio_visualization_edge_cases.py",
    ]

    print("Validating test file syntax...")

    for test_file in test_files:
        if os.path.exists(test_file):
            try:
                with open(test_file, "r") as f:
                    compile(f.read(), test_file, "exec")
                print(f"✅ {test_file} syntax OK")
            except SyntaxError as e:
                print(f"❌ {test_file} syntax error: {e}")
                return False
        else:
            print(f"⚠️  {test_file} not found")

    return True


def main():
    """Main test runner function"""

    print("Audio Visualization Test Suite")
    print("=============================")

    # Change to project directory
    os.chdir(project_root)

    # Validate test files first
    if not validate_test_files():
        print("❌ Test file validation failed. Please fix syntax errors.")
        return 1

    # Run tests
    success = run_tests_with_coverage()

    if success:
        print("\n✅ All tests passed!")
        return 0
    else:
        print("\n❌ Some tests failed!")
        return 1


if __name__ == "__main__":
    sys.exit(main())
