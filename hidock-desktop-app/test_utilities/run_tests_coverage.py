#!/usr/bin/env python3
"""
Custom test runner to bypass pytest configuration issues and get coverage data.
This script directly imports and runs tests while collecting coverage information.
"""

import os
import sys
import subprocess
import tempfile
from pathlib import Path

def main():
    """Run tests with coverage bypassing pytest configuration issues."""
    
    # Add current directory to Python path
    sys.path.insert(0, os.getcwd())
    
    print("🧪 CUSTOM TEST RUNNER WITH COVERAGE")
    print("=" * 60)
    
    # List of test modules to run (based on what we found in tests directory)
    test_modules = [
        "tests.test_config_and_logger",
        "tests.test_constants", 
        "tests.test_desktop_device_adapter",
        "tests.test_audio_player_mixin",
        "tests.test_file_operations_manager",
        "tests.test_device_interface",
    ]
    
    # Run coverage collection
    coverage_cmd = [
        sys.executable, "-m", "coverage", "run",
        "--source=.",
        "--omit=tests/*,*.temp,__pycache__/*,.venv/*,test_*.py,*_test.py",
        "--append",
        "-m", "unittest", "discover", "-s", "tests", "-p", "test_*.py", "-v"
    ]
    
    print("📊 Running tests with coverage collection...")
    try:
        # Create a temporary directory for coverage data to avoid path issues
        with tempfile.TemporaryDirectory() as temp_dir:
            env = os.environ.copy()
            env['COVERAGE_FILE'] = os.path.join(temp_dir, '.coverage')
            
            result = subprocess.run(coverage_cmd, capture_output=True, text=True, env=env)
            
            if result.returncode != 0:
                print("❌ Test execution failed:")
                print(result.stderr)
                print(result.stdout)
                return False
            else:
                print("✅ Tests completed successfully!")
                print(result.stdout)
            
            # Generate coverage report
            report_cmd = [sys.executable, "-m", "coverage", "report", "--skip-covered"]
            env['COVERAGE_FILE'] = os.path.join(temp_dir, '.coverage')
            
            print("\n📈 COVERAGE REPORT:")
            print("=" * 60)
            
            report_result = subprocess.run(report_cmd, capture_output=True, text=True, env=env)
            
            if report_result.returncode == 0:
                print(report_result.stdout)
                
                # Parse coverage percentage
                lines = report_result.stdout.split('\n')
                total_line = [line for line in lines if 'TOTAL' in line]
                if total_line:
                    coverage_percent = total_line[0].split()[-1].rstrip('%')
                    try:
                        coverage_float = float(coverage_percent)
                        print(f"\n🎯 TOTAL COVERAGE: {coverage_percent}%")
                        
                        if coverage_float >= 80:
                            print("✅ Coverage target of 80% achieved!")
                            return True
                        else:
                            print(f"⚠️ Coverage {coverage_percent}% is below 80% target")
                            
                            # Generate detailed HTML report for analysis
                            html_cmd = [sys.executable, "-m", "coverage", "html", 
                                       "--directory=htmlcov", "--skip-covered"]
                            subprocess.run(html_cmd, env=env)
                            print("📄 Detailed HTML coverage report generated in htmlcov/")
                            return False
                    except ValueError:
                        print("Could not parse coverage percentage")
                        return False
            else:
                print("Error generating coverage report:")
                print(report_result.stderr)
                return False
                
    except Exception as e:
        print(f"❌ Error running tests: {e}")
        return False

def analyze_uncovered_areas():
    """Analyze which areas need more test coverage."""
    
    print("\n🔍 ANALYZING UNCOVERED AREAS...")
    print("=" * 60)
    
    # Find Python files in the current directory (excluding certain patterns)
    python_files = []
    exclude_patterns = {
        'test_', '__pycache__', '.venv', 'htmlcov', 'build', 'dist',
        '.git', '.pytest_cache', 'gui_', 'settings_window', 'main.py'
    }
    
    for file_path in Path('.').rglob('*.py'):
        if not any(pattern in str(file_path) for pattern in exclude_patterns):
            python_files.append(file_path)
    
    print(f"Found {len(python_files)} Python files for potential testing:")
    for file_path in sorted(python_files):
        print(f"  📄 {file_path}")
    
    # Check which files have corresponding tests
    test_files = list(Path('tests').glob('test_*.py'))
    tested_modules = set()
    
    for test_file in test_files:
        # Extract module name from test filename (test_module_name.py -> module_name)
        module_name = test_file.stem.replace('test_', '')
        tested_modules.add(module_name)
    
    print(f"\n📋 Found {len(test_files)} test files covering these modules:")
    for module in sorted(tested_modules):
        print(f"  ✅ {module}")
    
    # Find untested modules
    source_modules = set()
    for py_file in python_files:
        if py_file.stem not in {'__init__', 'conftest'}:
            source_modules.add(py_file.stem)
    
    untested_modules = source_modules - tested_modules
    
    print(f"\n⚠️ Modules without dedicated tests ({len(untested_modules)}):")
    for module in sorted(untested_modules):
        print(f"  ❌ {module}.py")
    
    return untested_modules

if __name__ == "__main__":
    print("🚀 HIDOCK DESKTOP APP - CUSTOM TEST & COVERAGE RUNNER")
    print("=" * 60)
    
    # First, analyze the testing landscape
    untested_modules = analyze_uncovered_areas()
    
    # Run tests with coverage
    success = main()
    
    if not success and untested_modules:
        print(f"\n💡 SUGGESTIONS TO REACH 80% COVERAGE:")
        print("=" * 60)
        print("Consider adding tests for these high-value modules:")
        
        priority_modules = []
        for module in untested_modules:
            # Prioritize core functionality modules
            if any(keyword in module.lower() for keyword in [
                'config', 'device', 'file', 'audio', 'transcription', 
                'calendar', 'service', 'manager', 'interface'
            ]):
                priority_modules.append(module)
        
        for module in sorted(priority_modules)[:5]:  # Top 5 priorities
            print(f"  🎯 {module}.py - High impact on coverage")
    
    sys.exit(0 if success else 1)
