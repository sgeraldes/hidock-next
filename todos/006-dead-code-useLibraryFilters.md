---
id: "006"
title: "Remove dead code: useLibraryFilters hook"
status: pending
priority: P1
category: tech-debt
source: feature-code-reviewer, typescript-reviewer
created: 2025-12-30
files:
  - apps/electron/src/features/library/hooks/useLibraryFilters.ts
---

# Remove dead code: useLibraryFilters hook

## Problem

The `useLibraryFilters` hook (242 lines) is completely unused. It was created but never imported or used anywhere. The `Library.tsx` component implements filtering logic locally instead.

## Location

`apps/electron/src/features/library/hooks/useLibraryFilters.ts`

## Evidence

```bash
# No imports found
grep -r "useLibraryFilters" apps/electron/src --include="*.ts" --include="*.tsx"
# Only shows the file itself, no imports
```

## Options

### Option A: Delete the file (Recommended)
If the hook isn't needed, delete it to reduce codebase size and confusion.

### Option B: Migrate Library.tsx to use it
If the abstraction is valuable, update Library.tsx to use this hook instead of local state.

## Recommendation

Delete the file. The filtering logic in Library.tsx is simpler and works. Adding abstraction for one use site violates YAGNI.

## Impact

- 242 lines of dead code to maintain
- Confusion about "correct" way to filter
- Potential for divergent implementations

## Acceptance Criteria

- [ ] Confirm hook is truly unused (grep/search)
- [ ] Delete the file
- [ ] Update any barrel exports that reference it
- [ ] Verify build still passes
