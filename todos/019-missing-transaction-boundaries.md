---
id: "019"
title: "Add transaction boundaries to store updates"
status: pending
priority: P3
category: reliability
source: data-integrity-guardian
created: 2025-12-30
files:
  - apps/electron/src/store/useLibraryStore.ts
---

# Add transaction boundaries to store updates

## Problem

Multi-step store updates are not atomic. If an update fails midway, the store can be left in an inconsistent state.

## Example Scenario

```typescript
// What if this fails after step 1 but before step 2?
const deleteRecordings = async (ids: string[]) => {
  // Step 1: Remove from store
  set(state => ({
    sources: state.sources.filter(s => !ids.includes(s.id))
  }))

  // Step 2: Delete from database (fails!)
  await window.api.recordings.deleteMany(ids)  // <-- Network error

  // Store now out of sync with database
}
```

## Suggested Fix

### Option A: Optimistic with rollback

```typescript
const deleteRecordings = async (ids: string[]) => {
  const previousSources = get().sources  // Save for rollback

  // Optimistic update
  set(state => ({
    sources: state.sources.filter(s => !ids.includes(s.id))
  }))

  try {
    await window.api.recordings.deleteMany(ids)
  } catch (e) {
    // Rollback on failure
    set({ sources: previousSources })
    throw e
  }
}
```

### Option B: Pessimistic (server-first)

```typescript
const deleteRecordings = async (ids: string[]) => {
  // Update server first
  await window.api.recordings.deleteMany(ids)

  // Then update store
  set(state => ({
    sources: state.sources.filter(s => !ids.includes(s.id))
  }))
}
```

### Option C: Immer transactions

```typescript
import { produce } from 'immer'

const deleteRecordings = async (ids: string[]) => {
  const result = await window.api.recordings.deleteMany(ids)

  if (result.success) {
    set(produce(state => {
      state.sources = state.sources.filter(s => !ids.includes(s.id))
      state.selectedIds = new Set(
        [...state.selectedIds].filter(id => !ids.includes(id))
      )
    }))
  }
}
```

## Impact

- UI shows deleted items that still exist
- UI missing items that weren't deleted
- Confusing user experience
- Data sync issues

## Acceptance Criteria

- [ ] Identify all multi-step store operations
- [ ] Add rollback for optimistic updates
- [ ] Or switch to pessimistic (server-first) updates
- [ ] Document the chosen pattern
