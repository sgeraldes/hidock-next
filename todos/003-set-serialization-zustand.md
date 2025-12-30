---
id: "003"
title: "Fix Set serialization in Zustand persist"
status: skipped
skipped: 2025-12-30
reason: "Validation found selectedIds is correctly excluded from persist via partialize"
priority: P1
category: bug
source: data-integrity-guardian
created: 2025-12-30
files:
  - apps/electron/src/store/useLibraryStore.ts
---

# Fix Set serialization in Zustand persist

## Problem

The `useLibraryStore` uses Zustand's persist middleware with `Set<string>` for `selectedIds`. JavaScript Sets don't serialize to JSON properly - they become empty objects `{}`, causing data loss on page refresh.

## Location

`apps/electron/src/store/useLibraryStore.ts`

## Current Code

```typescript
interface LibraryState {
  selectedIds: Set<string>  // Won't survive serialization
  // ...
}

export const useLibraryStore = create<LibraryState>()(
  persist(
    (set) => ({
      selectedIds: new Set(),
      // ...
    }),
    {
      name: 'library-storage',
      // No custom serialization
    }
  )
)
```

## Suggested Fix

```typescript
export const useLibraryStore = create<LibraryState>()(
  persist(
    (set) => ({
      selectedIds: new Set(),
      // ...
    }),
    {
      name: 'library-storage',
      storage: {
        getItem: (name) => {
          const str = localStorage.getItem(name)
          if (!str) return null
          const parsed = JSON.parse(str)
          // Convert array back to Set
          if (parsed.state?.selectedIds) {
            parsed.state.selectedIds = new Set(parsed.state.selectedIds)
          }
          return parsed
        },
        setItem: (name, value) => {
          // Convert Set to array for serialization
          const serialized = {
            ...value,
            state: {
              ...value.state,
              selectedIds: Array.from(value.state.selectedIds || [])
            }
          }
          localStorage.setItem(name, JSON.stringify(serialized))
        },
        removeItem: (name) => localStorage.removeItem(name)
      }
    }
  )
)
```

## Impact

- User's multi-selection lost on page refresh
- Potential runtime errors when Set methods called on deserialized object
- Silent data corruption

## Acceptance Criteria

- [ ] Custom serialization handles Set→Array→Set conversion
- [ ] Selection state survives page refresh
- [ ] No runtime errors from Set method calls
- [ ] Unit test for serialization roundtrip
