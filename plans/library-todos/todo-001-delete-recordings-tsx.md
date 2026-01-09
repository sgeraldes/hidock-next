# TODO-001: Delete Legacy Recordings.tsx

## Status: PENDING

## Phase: 1 (Foundation)

## Priority: HIGH

## Summary
Delete the legacy `Recordings.tsx` file that was superseded by `Library.tsx`. The old file creates code duplication and maintenance confusion.

## Problem
- Old `Recordings.tsx` (51,463 bytes) still exists at `apps/electron/src/pages/Recordings.tsx`
- New `Library.tsx` (28,868 bytes) exists and is the active implementation
- Both files contain similar functionality, creating maintenance burden
- The old file is not referenced in routing (App.tsx uses Library)

## Acceptance Criteria
- [ ] `apps/electron/src/pages/Recordings.tsx` is deleted
- [ ] No imports reference the deleted file
- [ ] Application builds successfully
- [ ] Application runs without errors
- [ ] Tests pass (after test file updates)

## Files to Modify
- DELETE: `apps/electron/src/pages/Recordings.tsx`

## Dependencies
- **Depends on**: TODO-002 (Update tests first)

## Risks
- Low risk: File is not in active use
- Verify no dynamic imports reference this file

---

## Pre-Implementation Checklist

Before starting this task, verify:

- [ ] TODO-002 is completed (test file updated/removed)
- [ ] You are on the correct branch: `library/phase1-filters`
- [ ] Working directory is clean or changes are stashed
- [ ] You have read and understand the current `Recordings.tsx` file
- [ ] You have verified `Library.tsx` is the active replacement

Run this verification command:
```bash
cd G:\Code\hidock-next\apps\electron
git status
npm run test -- --run
```

---

## Detailed Implementation Steps

### Step 1: Verify No References Exist

Run these commands to confirm no code references the file:

```bash
# From G:\Code\hidock-next

# Check for any imports of Recordings page (should only show test file if TODO-002 not done)
grep -r "from.*pages/Recordings" apps/electron/src/
grep -r "import.*Recordings.*from" apps/electron/src/

# Check for dynamic imports
grep -r "import\(.*Recordings" apps/electron/src/
grep -r "lazy.*Recordings" apps/electron/src/

# Check App.tsx routing (should show Library, not Recordings)
grep -n "Recordings\|Library" apps/electron/src/App.tsx
```

**Expected Results**:
- First two commands: Only `__tests__/Recordings.test.tsx` (if TODO-002 incomplete)
- Dynamic imports: No matches
- App.tsx: Shows `import { Library }` and `<Library />` route

### Step 2: Delete the File

```bash
cd G:\Code\hidock-next\apps\electron

# Delete the legacy file
rm src/pages/Recordings.tsx

# Verify deletion
ls src/pages/ | grep -i recording
# Expected: No output (file is gone)
```

### Step 3: Verify Build Success

```bash
cd G:\Code\hidock-next\apps\electron

# Run TypeScript type checking
npm run typecheck

# Run the build
npm run build
```

**Expected Results**:
- `typecheck`: Exit code 0, no errors mentioning Recordings
- `build`: Exit code 0, successful compilation

### Step 4: Run Tests

```bash
cd G:\Code\hidock-next\apps\electron

# Run all tests
npm run test -- --run
```

**Expected Results**:
- All tests pass
- No test references missing Recordings component

### Step 5: Manual Smoke Test

```bash
cd G:\Code\hidock-next\apps\electron

# Start the development server
npm run dev
```

Then verify:
1. [ ] Application starts without console errors
2. [ ] Navigate to Library page (default route `/` or `/library`)
3. [ ] Library page renders correctly with filters and recording list
4. [ ] View toggle (compact/expanded) works
5. [ ] No "Recordings" references appear in navigation

### Step 6: Commit Changes

```bash
cd G:\Code\hidock-next

# Stage the deletion
git add -A

# Verify staged changes
git status
# Should show: deleted: apps/electron/src/pages/Recordings.tsx

# Commit
git commit -m "chore(library): delete legacy Recordings.tsx superseded by Library.tsx

The Recordings.tsx page (51KB) has been replaced by the refactored
Library.tsx (29KB) which uses feature-based component architecture.

- Routing already uses Library component
- No imports reference the deleted file
- Tests updated in prior commit (TODO-002)

Part of library phase 1 cleanup."
```

---

## Verification Commands Summary

| Step | Command | Expected Result |
|------|---------|-----------------|
| Pre-check imports | `grep -r "from.*Recordings" src/` | No matches (or only test file) |
| Delete file | `rm src/pages/Recordings.tsx` | File removed |
| Type check | `npm run typecheck` | Exit 0, no errors |
| Build | `npm run build` | Exit 0, successful |
| Test | `npm run test -- --run` | All tests pass |
| Dev server | `npm run dev` | App starts, Library works |

---

## Rollback Plan

If issues are discovered after deletion:

### Option 1: Git Restore (Recommended)

```bash
cd G:\Code\hidock-next

# If not yet committed:
git checkout -- apps/electron/src/pages/Recordings.tsx

# If already committed:
git revert HEAD  # Creates new commit undoing the deletion
```

### Option 2: Recreate from Git History

```bash
cd G:\Code\hidock-next

# Find the last commit that had the file
git log --oneline -- apps/electron/src/pages/Recordings.tsx

# Restore from that commit
git checkout <commit-hash> -- apps/electron/src/pages/Recordings.tsx
```

---

## Post-Completion Checklist

After completing this task:

- [ ] File `Recordings.tsx` no longer exists in `src/pages/`
- [ ] `git status` shows the deletion
- [ ] `npm run build` succeeds
- [ ] `npm run test -- --run` passes
- [ ] Application runs and Library page works
- [ ] Commit created with descriptive message
- [ ] TODO-001 status updated to COMPLETED
