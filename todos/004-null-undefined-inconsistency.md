---
id: "004"
title: "Fix null vs undefined inconsistency in types"
status: pending
priority: P1
category: tech-debt
source: data-integrity-guardian
created: 2025-12-30
files:
  - apps/electron/src/types/index.ts
  - apps/electron/src/types/stores.ts
---

# Fix null vs undefined inconsistency in types

## Problem

The codebase uses both `| null` and `?` (optional/undefined) inconsistently for nullable fields. This creates ambiguity about whether a field is "not set" vs "explicitly empty".

## Location

`apps/electron/src/types/index.ts`

## Current Code

```typescript
export interface Meeting {
  location?: string | null        // Both ? AND | null - redundant/confusing
  organizer_name?: string | null
  organizer_email?: string | null
  attendees?: string | null
  description?: string | null
  // ...
}
```

## Problem Details

1. `field?: string | null` means field can be:
   - `undefined` (property not present)
   - `null` (property present but null)
   - `string` (property present with value)

2. This creates three states instead of two, making null checks verbose:
   ```typescript
   if (meeting.location !== null && meeting.location !== undefined)
   ```

## Suggested Fix

Pick one convention based on data source:

**Option A: Use `| null` for database fields (SQLite returns null)**
```typescript
export interface Meeting {
  location: string | null
  organizer_name: string | null
  organizer_email: string | null
  // ...
}
```

**Option B: Use `?` for optional UI props**
```typescript
interface ComponentProps {
  title?: string
  subtitle?: string
}
```

## Impact

- Inconsistent null checks throughout codebase
- Type safety gaps when checking nullable fields
- Confusion about expected runtime values

## Acceptance Criteria

- [ ] Document convention: `| null` for DB fields, `?` for optional props
- [ ] Update Meeting interface to use consistent pattern
- [ ] Update related interfaces (Recording, Transcript, etc.)
- [ ] Fix null checks in components using these types
