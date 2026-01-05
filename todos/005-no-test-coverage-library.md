---
id: "005"
title: "Add test coverage for Library feature"
status: pending
priority: P1
category: testing
source: feature-code-reviewer
created: 2025-12-30
files:
  - apps/electron/src/pages/Library.tsx
  - apps/electron/src/features/library/**/*
  - apps/electron/src/store/useLibraryStore.ts
  - apps/electron/src/store/ui/useLibraryUIStore.ts
---

# Add test coverage for Library feature

## Problem

The entire Library feature (~2500 lines of code across 19 files) has zero test coverage. This is a critical gap for a core application feature.

## Files Needing Tests

### High Priority (Core Logic)
1. `apps/electron/src/store/useLibraryStore.ts` - State management
2. `apps/electron/src/store/ui/useLibraryUIStore.ts` - UI state
3. `apps/electron/src/pages/Library.tsx` - Main component

### Medium Priority (Hooks)
4. `apps/electron/src/features/library/hooks/useSourceSelection.ts`
5. `apps/electron/src/features/library/hooks/useKeyboardNavigation.ts`
6. `apps/electron/src/features/library/hooks/useLibraryData.ts`

### Lower Priority (Components)
7. `apps/electron/src/features/library/components/SourceCard.tsx`
8. `apps/electron/src/features/library/components/SourceRow.tsx`
9. `apps/electron/src/features/library/components/SourceDetailDrawer.tsx`

## Suggested Test Cases

### Store Tests
```typescript
describe('useLibraryStore', () => {
  it('should initialize with default state')
  it('should toggle selection correctly')
  it('should handle bulk selection')
  it('should clear selection')
  it('should serialize/deserialize Set correctly')
})
```

### Hook Tests
```typescript
describe('useSourceSelection', () => {
  it('should handle single click selection')
  it('should handle shift+click range selection')
  it('should handle ctrl+click toggle selection')
  it('should clear selection on escape')
})

describe('useKeyboardNavigation', () => {
  it('should navigate with arrow keys')
  it('should handle home/end keys')
  it('should support type-ahead search')
})
```

### Component Tests
```typescript
describe('Library', () => {
  it('should render loading state')
  it('should render empty state')
  it('should render source list')
  it('should filter by search term')
  it('should filter by type')
  it('should handle source selection')
})
```

## Impact

- No regression protection for critical feature
- Refactoring is risky without tests
- Bugs discovered only in production

## Acceptance Criteria

- [ ] Store tests with 90%+ coverage
- [ ] Hook tests with 80%+ coverage
- [ ] Component integration tests
- [ ] At least 70% overall coverage for Library feature
