---
id: "014"
title: "Address Library.tsx vs Recordings.tsx duplication"
status: pending
priority: P2
category: architecture
source: pattern-recognition
created: 2025-12-30
files:
  - apps/electron/src/pages/Library.tsx
  - apps/electron/src/pages/Recordings.tsx
---

# Address Library.tsx vs Recordings.tsx duplication

## Problem

`Library.tsx` and `Recordings.tsx` share significant code:
- Similar data fetching patterns
- Same type definitions
- Similar filtering logic
- Same formatBytes utility
- Similar list rendering

This suggests either:
1. One page should replace the other
2. Shared logic should be extracted

## Analysis Needed

1. **What is the difference between Library and Recordings?**
   - Library: New tri-pane design for browsing recordings
   - Recordings: Legacy recordings view?

2. **Are both pages needed?**
   - If Library replaces Recordings, delete Recordings
   - If both needed, document the difference

3. **What can be shared?**
   - Data fetching hooks
   - Type definitions (already in types/index.ts)
   - Utility functions
   - List item components

## Suggested Approach

### If Library replaces Recordings:
```bash
# Delete Recordings.tsx
# Update routing to use Library
# Update any navigation links
```

### If both needed, extract shared code:
```typescript
// hooks/useRecordingsData.ts
export function useRecordingsData() {
  // Shared data fetching logic
}

// components/RecordingsList.tsx
export function RecordingsList({ recordings, viewMode }) {
  // Shared list rendering
}
```

## Impact

- ~400 lines of duplicate code
- Double maintenance burden
- Inconsistent behavior possible
- Confusing for developers

## Acceptance Criteria

- [ ] Determine if both pages are needed
- [ ] If not, delete redundant page
- [ ] If yes, extract shared code to hooks/components
- [ ] Document purpose of each page
