# Active Stores After Dead Code Removal

**Date:** 2026-02-27
**Context:** After removing W1-HS-04 through W1-HS-14 (15 files, ~2,330 lines)

---

## Store Inventory

### Domain Stores (1 store)
- `useConfigStore` — Application configuration (transcription settings, API keys, UI preferences)

### Feature Stores (1 store)
- `useTranscriptionStore` — Transcription queue management (pending, processing, failed items)

### UI Stores (2 stores)
- `useUIStore` — General UI state (sidebar, playback, sentiment)
- `useLibraryStore` — Library-specific UI state (filters, sort, selection, view mode)

### Legacy Store (1 store)
- `useAppStore` — Monolithic store being phased out (downloads, meetings, calendar, recordings)

**Total Active Stores:** 5 stores (down from 15)

---

## Re-export Pattern

Root-level files (`src/store/useUIStore.ts`) are simple re-exports from subdirectories:

```typescript
// src/store/useUIStore.ts
export { useUIStore } from './ui/useUIStore'
```

This prevents dual Zustand instances (see FIX-007 in STABILITY_FIXES.md).

---

## Store Taxonomy (Cleaned Up)

### Before Dead Code Removal

```
store/
├── domain/          (5 stores: Config, Knowledge, Meetings, Contacts, Projects)
├── features/        (5 stores: Transcription, DeviceSync, Quality, Calendar, Filter)
├── ui/              (3 stores: Layout, CalendarUI, UI)
└── (root)           (2 stores: AppStore, LibraryStore)
Total: 15 stores
```

### After Dead Code Removal

```
store/
├── domain/          (1 store: Config)
├── features/        (1 store: Transcription)
├── ui/              (1 store: UI)
└── (root)           (2 stores: AppStore, LibraryStore)
Total: 5 stores
```

**Reduction:** 10 stores removed (67% reduction)

---

## Usage Patterns

### Domain Stores

**useConfigStore** — Consumed by:
- Settings.tsx (transcription provider, API keys)
- Layout.tsx (config loading)
- Various services (read-only config access)

### Feature Stores

**useTranscriptionStore** — Consumed by:
- OperationsPanel.tsx (queue display, cancel/retry)
- Library.tsx (transcription status)
- useOperations.ts (queue management)
- useTranscriptionSync.ts (5s polling for updates)

### UI Stores

**useUIStore** — Consumed by:
- Layout.tsx (sidebar state, playback controls)
- OperationsPanel.tsx (sidebar content switching)
- Library.tsx (view mode, compact view)
- Various components (UI state sharing)

**useLibraryStore** — Consumed by:
- Library.tsx (filters, sort, selection, expansion state)
- LibraryFilters.tsx (filter UI)
- LibraryHeader.tsx (header actions)

### Legacy Store

**useAppStore** — Consumed by:
- Multiple pages (Calendar, Library, Device, etc.)
- Download orchestration (useDownloadOrchestrator.ts)
- Device subscriptions (useDeviceSubscriptions.ts)

**Deprecation Plan:** Gradually migrate functionality to granular stores above.

---

## Dead Stores Removed (Reference)

| Store | Reason for Removal |
|-------|-------------------|
| useMeetingsStore | Never consumed by any component |
| useKnowledgeStore | Never consumed by any component |
| useCalendarStore | Never consumed by any component |
| useDeviceSyncStore | Never consumed by any component |
| useQualityStore | Never consumed by any component |
| useLayoutStore | Never consumed by any component |
| useCalendarUIStore | Never consumed by any component |
| useFilterStore | Only consumed by dead FilterBar component |
| useContactsStore | People page uses local useState instead |
| useProjectsStore | Projects page uses local useState instead |

See `DEAD_CODE_REMOVAL_REPORT.md` for full details.

---

## Store Creation Guidelines (Lessons Learned)

### When to Create a Store

1. **Multiple components need shared state** — If only one component needs it, use local state
2. **State persists across navigation** — If ephemeral, use local state
3. **Cross-cutting concerns** — E.g., transcription queue affects multiple pages

### When NOT to Create a Store

1. **Premature abstraction** — Create when needed, not "in case we need it"
2. **Single-page state** — Use local useState/useReducer
3. **Derived state** — Compute from existing stores, don't duplicate

### Before Creating a Store, Ask:

- Is there an existing store that could handle this?
- Will this state be consumed by multiple components?
- Can this be derived from existing state?
- Is this truly application state, or just UI state?

---

## Verification

All remaining stores are actively consumed:

```bash
# Verify useConfigStore is used
grep -r "useConfigStore" src/ | wc -l
# Result: 8+ files import and use it

# Verify useTranscriptionStore is used
grep -r "useTranscriptionStore" src/ | wc -l
# Result: 5+ files import and use it

# Verify useUIStore is used
grep -r "useUIStore" src/ | wc -l
# Result: 10+ files import and use it

# Verify useLibraryStore is used
grep -r "useLibraryStore" src/ | wc -l
# Result: 4+ files import and use it

# Verify useAppStore is used
grep -r "useAppStore" src/ | wc -l
# Result: 20+ files import and use it
```

---

## Next Steps

1. Continue phasing out `useAppStore` by migrating functionality to domain/feature stores
2. Create new stores only when multiple components need shared state
3. Regular audits (quarterly) to identify unused exports

---

*Generated: 2026-02-27*
*See: DEAD_CODE_REMOVAL_REPORT.md*
