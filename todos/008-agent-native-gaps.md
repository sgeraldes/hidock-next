---
id: "008"
title: "Expose Library capabilities via IPC for agent-native architecture"
status: pending
priority: P1
category: architecture
source: agent-native-reviewer
created: 2025-12-30
files:
  - apps/electron/electron/main/ipc-handlers.ts
  - apps/electron/src/pages/Library.tsx
---

# Expose Library capabilities via IPC for agent-native architecture

## Problem

70.8% of Library capabilities are UI-only with no IPC/agent access. This violates agent-native architecture principles: any action a user can take, an agent should also be able to take.

## Missing IPC Handlers

### Critical (Required for agent parity)
1. **Filter state** - No way to get/set filters programmatically
2. **Selection state** - No way to select items via IPC
3. **View preferences** - No way to get/set view mode
4. **Search** - No way to search via IPC

### Important (For full automation)
5. **Bulk operations** - Require client-side selection first
6. **Sort state** - Not exposed

## Current vs Required

| Capability | UI Access | IPC Access | Gap |
|------------|-----------|------------|-----|
| View recordings | ✅ | ✅ | None |
| Filter by type | ✅ | ❌ | Missing |
| Filter by date | ✅ | ❌ | Missing |
| Search | ✅ | ❌ | Missing |
| Select items | ✅ | ❌ | Missing |
| Bulk delete | ✅ | ❌ | Missing |
| Change view mode | ✅ | ❌ | Missing |

## Suggested IPC Handlers

```typescript
// ipc-handlers.ts
ipcMain.handle('library:getFilters', async () => {
  return store.get('library.filters')
})

ipcMain.handle('library:setFilters', async (_, filters: LibraryFilters) => {
  store.set('library.filters', filters)
  // Notify renderer to update
})

ipcMain.handle('library:search', async (_, query: string) => {
  return db.recordings.search(query)
})

ipcMain.handle('library:bulkDelete', async (_, ids: string[]) => {
  return db.recordings.deleteMany(ids)
})
```

## Impact

- Agents cannot automate Library workflows
- MCP tools cannot interact with Library
- Automated testing limited to IPC-exposed features

## Acceptance Criteria

- [ ] Filter state readable/writable via IPC
- [ ] Selection state manageable via IPC
- [ ] Search available via IPC
- [ ] Bulk operations available via IPC (without UI selection)
- [ ] Document all Library IPC handlers
