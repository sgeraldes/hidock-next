#!/usr/bin/env python3
"""
Comprehensive Test Contamination Risk Audit

This script analyzes all test files for potential production data contamination risks.
It identifies patterns that could lead to tests affecting real application data.
"""

import os
import re
import sys
from pathlib import Path
from typing import Dict, List, Set, Tuple

# Risk patterns to search for
RISK_PATTERNS = {
    "direct_file_write": [
        r'open\([^)]*["\'][^"\']*\.json["\'][^)]*["\']w["\']',
        r'open\([^)]*["\'][^"\']*\.db["\'][^)]*["\']w["\']',
        r'open\([^)]*["\'][^"\']*\.sqlite["\'][^)]*["\']w["\']',
        r'with\s+open\([^)]*["\'][^"\']*\.json["\'][^)]*["\']w["\']',
    ],
    "config_file_creation": [
        r"hidock_config\.json",
        r"CONFIG_FILE_NAME",
    ],
    "home_directory_access": [
        r"Path\.home\(\)(?!\s*#.*test)",  # Exclude commented test cases
        r'os\.path\.expanduser\(["\']~',
        r'expanduser\(["\']~',
    ],
    "database_creation": [
        r'sqlite3\.connect\([^)]*["\'][^"\']*\.db["\']',
        r'sqlite3\.connect\([^)]*["\'][^"\']*\.sqlite["\']',
        r"\.db_path\s*=",
        r"\.database\s*=",
    ],
    "cache_directory_creation": [
        r"\.hidock.*cache",
        r"cache.*hidock",
        r"mkdir.*cache",
    ],
    "real_path_usage": [
        r'["\'][A-Za-z]:[/\\]',  # Windows absolute paths
        r'["\']\/(?!tmp|var|temp)',  # Unix absolute paths (excluding safe temp dirs)
        r"os\.getcwd\(\)",
        r'Path\(["\'][^"\']*[/\\](?!tmp|temp|test)',
    ],
    "settings_bypass": [
        r"_CONFIG_FILE_PATH\s*=[^=]",  # Direct assignment (not comparison)
        r"_SCRIPT_DIR\s*=[^=]",
        r"constants\.CONFIG_FILE_NAME\s*=[^=]",
    ],
}

# Safe patterns that indicate proper isolation
SAFE_PATTERNS = [
    r"tempfile\.",
    r"tmp_path",
    r"temp_dir",
    r"@patch.*_CONFIG_FILE_PATH",
    r"@patch.*_SCRIPT_DIR",
    r"monkeypatch\.",
    r"with\s+patch\(",
    r"Mock\(",
    r"MagicMock\(",
    r"@pytest\.fixture",
]


class ContaminationAuditor:
    """Audits test files for contamination risks."""

    def __init__(self, test_dir: str = "tests"):
        self.test_dir = Path(test_dir)
        self.risks: Dict[str, List[Tuple[str, int, str, str]]] = {}
        self.safe_files: Set[str] = set()
        self.risky_files: Set[str] = set()

    def audit_all_files(self) -> Dict[str, List[Tuple[str, int, str, str]]]:
        """Audit all test files for contamination risks."""
        test_files = list(self.test_dir.glob("test_*.py"))

        print(f"🔍 Auditing {len(test_files)} test files for contamination risks...")
        print("=" * 70)

        for test_file in test_files:
            if test_file.name in ["conftest.py", "__init__.py"]:
                continue

            risks = self.audit_file(test_file)
            if risks:
                self.risks[str(test_file)] = risks
                self.risky_files.add(str(test_file))
            else:
                self.safe_files.add(str(test_file))

        return self.risks

    def audit_file(self, file_path: Path) -> List[Tuple[int, str, str]]:
        """Audit a single file for contamination risks."""
        try:
            with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()
        except Exception as e:
            print(f"❌ Error reading {file_path}: {e}")
            return []

        lines = content.split("\n")
        risks = []

        # Check each risk pattern
        for risk_type, patterns in RISK_PATTERNS.items():
            for pattern in patterns:
                for line_num, line in enumerate(lines, 1):
                    if re.search(pattern, line, re.IGNORECASE):
                        # Check if this is mitigated by safe patterns
                        is_safe = False
                        for safe_pattern in SAFE_PATTERNS:
                            if re.search(safe_pattern, line, re.IGNORECASE):
                                is_safe = True
                                break

                        # Check surrounding context for safety
                        if not is_safe:
                            context_start = max(0, line_num - 3)
                            context_end = min(len(lines), line_num + 3)
                            context = "\n".join(lines[context_start:context_end])

                            for safe_pattern in SAFE_PATTERNS:
                                if re.search(safe_pattern, context, re.IGNORECASE):
                                    is_safe = True
                                    break

                        if not is_safe:
                            risks.append((line_num, risk_type, line.strip(), pattern))

        return risks

    def generate_report(self) -> str:
        """Generate a comprehensive contamination risk report."""
        report = []
        report.append("🛡️  TEST CONTAMINATION RISK AUDIT REPORT")
        report.append("=" * 70)

        if not self.risks:
            report.append("✅ NO CONTAMINATION RISKS DETECTED!")
            report.append(f"✅ {len(self.safe_files)} files audited - all appear safe")
            report.append("")
            report.append("🎉 Your test suite is properly isolated!")
            return "\n".join(report)

        # Summary
        report.append(f"📊 SUMMARY:")
        report.append(f"   🔴 Risky files: {len(self.risky_files)}")
        report.append(f"   ✅ Safe files: {len(self.safe_files)}")
        report.append(f"   📝 Total risks found: {sum(len(risks) for risks in self.risks.values())}")
        report.append("")

        # Risk breakdown by type
        risk_counts = {}
        for file_risks in self.risks.values():
            for _, risk_type, _, _ in file_risks:
                risk_counts[risk_type] = risk_counts.get(risk_type, 0) + 1

        report.append("📈 RISK BREAKDOWN:")
        for risk_type, count in sorted(risk_counts.items(), key=lambda x: x[1], reverse=True):
            report.append(f"   🔸 {risk_type}: {count} instances")
        report.append("")

        # Detailed risks by file
        report.append("🔍 DETAILED RISKS BY FILE:")
        report.append("")

        for file_path, file_risks in sorted(self.risks.items()):
            rel_path = os.path.relpath(file_path)
            report.append(f"📁 {rel_path}")
            report.append("-" * (len(rel_path) + 3))

            for line_num, risk_type, line_content, pattern in file_risks:
                report.append(f"   🔴 Line {line_num}: {risk_type}")
                report.append(f"       Pattern: {pattern}")
                report.append(f"       Code: {line_content}")
                report.append("")

        # Recommendations
        report.append("💡 RECOMMENDATIONS:")
        report.append("")
        report.append("For each risk found above:")
        report.append("1. 🔒 Use temporary files/directories (tempfile module)")
        report.append("2. 🧪 Mock file operations instead of real I/O")
        report.append("3. 🎭 Patch config paths to use test directories")
        report.append("4. 🛡️  Use pytest fixtures for isolation")
        report.append("5. 🧹 Ensure proper cleanup in teardown methods")
        report.append("")
        report.append("🚨 HIGH PRIORITY: Fix any 'direct_file_write' or 'config_file_creation' risks!")

        return "\n".join(report)

    def print_report(self):
        """Print the contamination risk report."""
        print(self.generate_report())

    def save_report(self, output_file: str = "contamination_audit_report.txt"):
        """Save the report to a file."""
        with open(output_file, "w") as f:
            f.write(self.generate_report())
        print(f"📄 Report saved to: {output_file}")


def main():
    """Main audit function."""
    if len(sys.argv) > 1:
        test_dir = sys.argv[1]
    else:
        test_dir = "tests"

    if not os.path.exists(test_dir):
        print(f"❌ Test directory '{test_dir}' not found!")
        sys.exit(1)

    auditor = ContaminationAuditor(test_dir)
    risks = auditor.audit_all_files()

    auditor.print_report()

    # Save report
    auditor.save_report()

    # Exit with error code if risks found
    if risks:
        print(f"\n❌ AUDIT FAILED: {len(risks)} files have contamination risks!")
        print("Review the report above and fix the identified issues.")
        sys.exit(1)
    else:
        print(f"\n✅ AUDIT PASSED: All {len(auditor.safe_files)} test files appear safe!")
        sys.exit(0)


if __name__ == "__main__":
    main()
