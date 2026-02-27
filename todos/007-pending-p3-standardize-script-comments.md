---
status: pending
priority: p3
issue_id: PATTERN-002
tags: [scripts, documentation, consistency, code-review, code-quality]
dependencies: []
---

# Standardize Header Comments Across Shell Scripts

## Problem Statement

Bash scripts have inconsistent header comment styles. Newer scripts include descriptive comments after the shebang, while older scripts lack them. This reduces discoverability and self-documentation.

**Why it matters:**
- Scripts are less discoverable (unclear purpose at a glance)
- Inconsistent documentation patterns
- Harder for new developers to understand script purpose
- Violates "code as documentation" principle

## Findings

**Pattern Analysis:**

**New Scripts (Good Pattern):**
```bash
#!/bin/bash
# HiDock Meeting Intelligence - Build Script  ✅ Descriptive comment
echo "Building HiDock Meeting Intelligence..."
```

**Old Scripts (Missing Pattern):**
```bash
#!/bin/bash
❌ No descriptive comment
echo "Starting HiDock Desktop Application..."
```

**Affected Files:**
- `run-desktop.sh` (missing descriptive comment)
- `run-web.sh` (missing descriptive comment)
- Possibly others in `scripts/` directory

**Unaffected Files (Already Correct):**
- `build-electron.sh` ✅
- `run-electron.sh` ✅

## Proposed Solutions

### Solution 1: Add Descriptive Comments to All Scripts (Recommended)
**Approach:** Add standardized comment format after shebang

**Template:**
```bash
#!/bin/bash
# [App Name] - [Purpose] Script
# [Optional: One-line description if not obvious from title]
```

**Examples:**

**run-desktop.sh:**
```bash
#!/bin/bash
# HiDock Desktop Application - Run Script
echo "Starting HiDock Desktop Application..."
```

**run-web.sh:**
```bash
#!/bin/bash
# HiDock Web Application - Run Script
echo "Starting HiDock Web Application..."
```

**scripts/build/build_desktop.py:**
```python
#!/usr/bin/env python3
# HiDock Desktop Application - Build Script
# Creates platform-specific installers using PyInstaller
```

**Pros:**
- Clear script purpose at a glance
- Consistent documentation across all scripts
- Minimal effort (1 line per script)
- Improves maintainability

**Cons:**
- None (pure documentation improvement)

**Effort:** Small (5 minutes for all affected scripts)
**Risk:** None (comments don't affect execution)

### Solution 2: Extended Header with Metadata
**Approach:** Add multi-line header with usage, author, and date

```bash
#!/bin/bash
#
# HiDock Desktop Application - Run Script
#
# Usage: ./run-desktop.sh
# Author: HiDock Team
# Updated: 2026-01-14
#
echo "Starting..."
```

**Pros:**
- More comprehensive documentation
- Includes usage information
- Professional appearance

**Cons:**
- Verbose (6+ lines instead of 1)
- Maintenance burden (dates go stale)
- Git history already tracks author/date

**Effort:** Medium (15 minutes)
**Risk:** Low (comments can go stale)

### Solution 3: Minimal Inline Comments
**Approach:** Add comments only where code is non-obvious

**Pros:**
- Code remains primary documentation
- No noise from obvious comments

**Cons:**
- Doesn't solve discoverability issue
- Inconsistent with new scripts

**Effort:** Low
**Risk:** None

## Recommended Action

**Solution 1** - Add single-line descriptive comments.

**Rationale:**
- Minimal effort (5 minutes total)
- Aligns with newer scripts
- Improves discoverability
- Doesn't clutter files
- Easy to maintain

**Proposed Standard:**
```bash
#!/bin/bash
# [App Name] - [Run|Build|Test] Script
```

## Technical Details

**Affected Files:**
- `run-desktop.sh` (line 2, add comment)
- `run-web.sh` (line 2, add comment)
- Any other scripts in `scripts/` directory missing comments

**Changes:**
```diff
@@@ run-desktop.sh
 #!/bin/bash
+# HiDock Desktop Application - Run Script
 echo "Starting HiDock Desktop Application..."

@@@ run-web.sh
 #!/bin/bash
+# HiDock Web Application - Run Script
 echo "Starting HiDock Web Application..."
```

**Components:**
- Shell script documentation
- No functional changes
- Only affects code readability

**Documentation Update:**
Consider adding to `CLAUDE.md`:
```markdown
## Shell Script Standards

All shell scripts should include a descriptive comment after the shebang:

```bash
#!/bin/bash
# [App Name] - [Purpose] Script
```
```

**Database Changes:** None

## Acceptance Criteria

- [ ] All root-level `.sh` scripts have descriptive comments
- [ ] Comment format consistent: `# [App Name] - [Purpose] Script`
- [ ] Scripts still execute correctly (comments don't affect behavior)
- [ ] Pattern documented in CLAUDE.md or docs/CONTRIBUTING.md
- [ ] Future scripts follow this pattern (add to pre-commit checklist)

## Work Log

**2026-01-14:** Issue identified during pattern recognition analysis. Newer scripts have good documentation comments, older scripts missing them. Classified as P3 (nice-to-have) - improves maintainability but not urgent. Low effort, high clarity benefit.

## Resources

- **Best Practices:** [Google Shell Style Guide](https://google.github.io/styleguide/shellguide.html#s1.1-which-shell-to-use)
- **Example:** `build-electron.sh` header (correct pattern)
- **Related Issue:** PATTERN-002 from pattern recognition report
