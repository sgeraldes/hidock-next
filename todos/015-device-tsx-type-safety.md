---
id: "015"
title: "Fix type safety in Device.tsx"
status: pending
priority: P2
category: tech-debt
source: typescript-reviewer
created: 2025-12-30
files:
  - apps/electron/src/pages/Device.tsx
---

# Fix type safety in Device.tsx

## Problem

`Device.tsx` uses unsafe type casting that bypasses TypeScript's type checking:

```typescript
const { ... } = useAppStore() as any
```

This defeats the purpose of TypeScript and can hide runtime errors.

## Location

`apps/electron/src/pages/Device.tsx`

## Current Code

```typescript
const {
  deviceInfo,
  storageInfo,
  settings,
  // ... many more properties
} = useAppStore() as any  // UNSAFE
```

## Suggested Fix

### Option A: Define proper types for store

```typescript
// types/stores.ts
interface AppStoreState {
  deviceInfo: DeviceInfo | null
  storageInfo: StorageInfo | null
  settings: DeviceSettings | null
  // ... all properties with correct types
}

// Device.tsx
const {
  deviceInfo,
  storageInfo,
  settings,
} = useAppStore()  // No cast needed
```

### Option B: Type the destructured properties

```typescript
const {
  deviceInfo,
  storageInfo,
  settings,
}: {
  deviceInfo: DeviceInfo | null
  storageInfo: StorageInfo | null
  settings: DeviceSettings | null
} = useAppStore()
```

### Option C: Use selectors

```typescript
const deviceInfo = useAppStore(state => state.deviceInfo)
const storageInfo = useAppStore(state => state.storageInfo)
const settings = useAppStore(state => state.settings)
```

## Impact

- Type errors not caught at compile time
- Autocomplete doesn't work
- Refactoring is dangerous
- Runtime errors instead of compile errors

## Acceptance Criteria

- [ ] Remove `as any` cast
- [ ] Store properly typed
- [ ] All property accesses type-safe
- [ ] No TypeScript errors
