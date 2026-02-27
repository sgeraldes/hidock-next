---
status: pending
priority: p3
issue_id: PATTERN-001
tags: [scripts, consistency, code-review, windows, code-quality]
dependencies: []
---

# Add `setlocal` to Older Windows Batch Scripts

## Problem Statement

Older batch scripts (`run-desktop.bat`, `run-web.bat`) are missing the `setlocal` command, which causes environment variables to leak into the parent shell. This is inconsistent with newer scripts (`build-electron.bat`, `run-electron.bat`) that correctly use `setlocal`.

**Why it matters:**
- Environment variable pollution can cause hard-to-debug issues
- Inconsistent behavior across scripts
- Variables set in script persist after script exits
- Professional best practice for batch files

## Findings

**Pattern Analysis:**

**New Scripts (Correct Pattern):**
```bat
@echo off
setlocal  ✅ Prevents variable leakage
echo Starting HiDock Meeting Intelligence...
```

**Old Scripts (Missing Pattern):**
```bat
@echo off
❌ Missing setlocal
echo Starting HiDock Desktop Application...
```

**Affected Files:**
- `run-desktop.bat` (line 2, missing)
- `run-web.bat` (line 2, missing)

**Unaffected Files (Already Correct):**
- `build-electron.bat` (has setlocal ✅)
- `run-electron.bat` (has setlocal ✅)

**Impact:**
- Any environment variables set in scripts persist in calling shell
- Example: If script sets `VENV_PATH`, it remains after script exits
- Risk: Low (scripts don't set many variables, but violates best practices)

## Proposed Solutions

### Solution 1: Add setlocal to Both Scripts (Recommended)
**Approach:** Simply add `setlocal` at line 2 of both affected scripts

**run-desktop.bat:**
```bat
@echo off
setlocal
echo Starting HiDock Desktop Application...
echo.
# ... rest of script
```

**run-web.bat:**
```bat
@echo off
setlocal
echo Starting HiDock Web Application...
echo.
# ... rest of script
```

**Pros:**
- Trivial change (1 line per file)
- Zero risk (setlocal is always safe)
- Aligns with newer script patterns
- Prevents future issues

**Cons:**
- None (this is pure improvement)

**Effort:** Small (2 minutes)
**Risk:** None (setlocal cannot break anything)

### Solution 2: Add setlocal + endlocal (Explicit)
**Approach:** Add both `setlocal` at start and `endlocal` at end

**Pros:**
- More explicit about variable scoping
- Clearer intent in code

**Cons:**
- Unnecessary (endlocal happens automatically at script exit)
- More lines of code for no benefit

**Effort:** Small (5 minutes)
**Risk:** None

### Solution 3: Do Nothing
**Approach:** Accept inconsistency, fix only if issues arise

**Pros:**
- Zero effort

**Cons:**
- Violates best practices
- Inconsistent with newer scripts
- May confuse future maintainers

**Effort:** None
**Risk:** Low but present (variable leakage)

## Recommended Action

**Solution 1** - Add `setlocal` to both files.

**Rationale:**
- Takes 2 minutes
- Zero risk
- Aligns with established pattern
- Professional best practice
- Prevents potential future issues

## Technical Details

**Affected Files:**
- `run-desktop.bat` (add at line 2)
- `run-web.bat` (add at line 2)

**Changes:**
```diff
@@@ run-desktop.bat
 @echo off
+setlocal
 echo Starting HiDock Desktop Application...

@@@ run-web.bat
 @echo off
+setlocal
 echo Starting HiDock Web Application...
```

**Components:**
- Windows batch file initialization
- No functional changes to script behavior
- Only affects variable scoping

**Database Changes:** None

## Acceptance Criteria

- [ ] `setlocal` added to `run-desktop.bat` at line 2
- [ ] `setlocal` added to `run-web.bat` at line 2
- [ ] Both scripts still execute correctly
- [ ] Desktop app launches successfully after change
- [ ] Web app launches successfully after change
- [ ] Environment variables no longer leak to parent shell
- [ ] Pattern consistency verified across all .bat files

## Work Log

**2026-01-14:** Issue identified during pattern recognition analysis of shell scripts. New scripts correctly use `setlocal`, but two older scripts missing it. Classified as P3 (nice-to-have) - no urgent issues but should fix for consistency and best practices.

## Resources

- **Microsoft Docs:** [setlocal command](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/setlocal)
- **Best Practices:** [Windows Batch Scripting Best Practices](https://ss64.com/nt/syntax.html)
- **Related Scripts:** `build-electron.bat`, `run-electron.bat` (correct pattern examples)
- **Related Issue:** PATTERN-001 from pattern recognition report
