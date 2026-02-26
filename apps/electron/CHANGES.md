# CHANGES.md - SPEC-004: Fix Null vs Undefined Inconsistency in Types

**Date:** 2026-01-30
**Spec:** spec-004-null-undefined-types.md
**Status:** Complete

## Summary

Established and enforced a consistent convention for nullable types throughout the Electron app codebase. This change improves type safety by clearly distinguishing between "missing" (undefined) and "explicitly empty" (null) values.

## Convention Applied

| Context | Pattern | Rationale |
|---------|---------|-----------|
| Database types | `field: T \| null` | SQLite returns `null` for missing column values |
| UI component props | `field?: T` | TypeScript optional syntax for optional props |
| Derived types | Match the source | Preserve semantics from origin type |

## Files Modified

### 1. `apps/electron/src/lib/calendar-utils.ts`

**Changes:**
- Line 29: Changed `location?: string | null` to `location: string | null`
- Line 30: Changed `organizer?: string | null` to `organizer: string | null`
- Line 40: Changed `location?: string | null` to `location: string | null`
- Line 41: Changed `organizer?: string | null` to `organizer: string | null`

**Rationale:** These fields come from database Meeting records where SQLite returns `null` for missing values. The `?:` optional marker was redundant since the parent `linkedMeeting` object is already optional.

### 2. `apps/electron/src/store/features/useDeviceSyncStore.ts`

**Changes:**
- Lines 49-50: Changed `model?: string | null, serial?: string | null` to `model: string | null, serial: string | null`

**Rationale:** The `setConnectionStatus` function always receives these values (possibly as `null`), so the optional marker was misleading. The function body already handles `null` correctly with nullish coalescing (`model ?? null`).

### 3. `apps/electron/src/features/library/components/AssistantPanel.tsx`

**Changes:**
- Line 23: Simplified `{ question_suggestions?: string | null } | null` to `{ question_suggestions: string | null } | null`

**Rationale:** The `question_suggestions` field comes from a Transcript database record where SQLite returns `null`. The outer `| null` for the transcript prop remains because it's a UI component prop that may not be provided.

### 4. `apps/electron/src/types/index.ts`

**Changes:**
- Added JSDoc documentation at the top of the file explaining the null/undefined convention

**Rationale:** Provides clear guidance for future development, ensuring new types follow the established pattern.

## Verification

- [x] TypeScript compiles without errors (`npm run typecheck`)
- [x] All existing tests pass (`npm test`)
- [x] No breaking changes to runtime behavior (type-level refactoring only)

## Impact

- **Type Safety:** Clearer distinction between missing and null values
- **Developer Experience:** Reduced ambiguity when working with nullable fields
- **Consistency:** Established pattern for future type definitions
