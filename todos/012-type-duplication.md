---
id: "012"
title: "Remove duplicate type definitions"
status: completed
completed: 2025-12-30
priority: P2
category: tech-debt
source: pattern-recognition
created: 2025-12-30
files:
  - apps/electron/src/pages/Library.tsx
  - apps/electron/src/pages/Recordings.tsx
  - apps/electron/src/features/library/components/SourceCard.tsx
  - apps/electron/src/features/library/components/SourceDetailDrawer.tsx
  - apps/electron/src/features/library/components/SourceRow.tsx
  - apps/electron/src/types/index.ts
---

# Remove duplicate type definitions

## Problem

Type definitions are duplicated across multiple files instead of importing from `types/index.ts`:

| Type | Duplications | Locations |
|------|--------------|-----------|
| `Transcript` | 5 | Library.tsx, Recordings.tsx, SourceCard.tsx, SourceDetailDrawer.tsx, SourceRow.tsx |
| `Meeting` | 5 | Same files |
| `formatBytes` | 6 | Multiple component files |

## Example Duplication

```typescript
// In Library.tsx
interface Transcript {
  id: string
  full_text: string
  summary?: string
  // ...
}

// In SourceCard.tsx
interface Transcript {
  id: string
  full_text: string
  summary?: string
  // ... (same definition)
}

// In types/index.ts (canonical)
export interface Transcript {
  id: string
  recording_id: string
  full_text: string
  // ...
}
```

## Suggested Fix

1. Import types from central location:

```typescript
// SourceCard.tsx
import { Transcript, Meeting, Recording } from '@/types'

// Remove local interface definitions
```

2. Move `formatBytes` to utilities:

```typescript
// src/utils/format.ts
export function formatBytes(bytes: number): string {
  // implementation
}

// Import everywhere
import { formatBytes } from '@/utils/format'
```

## Impact

- Types can drift between files
- Harder to update types consistently
- Larger bundle from duplicate code
- Confusion about canonical type

## Acceptance Criteria

- [ ] All components import from `@/types`
- [ ] No local Transcript/Meeting interfaces
- [ ] formatBytes in single utility file
- [ ] Build passes with no type errors
