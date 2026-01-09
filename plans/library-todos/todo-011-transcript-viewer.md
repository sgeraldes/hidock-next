# TODO-011: Create TranscriptViewer Component

## Status: PENDING

## Phase: 7 (Detail Drawer & Tri-Pane Layout)

## Priority: LOW

## Summary
Extract transcript display logic into a reusable TranscriptViewer component with time anchor support and synchronized highlighting.

## Problem
- Transcript rendering is embedded in SourceDetailDrawer
- No reusable component for future tri-pane layout
- No synchronized highlighting with audio playback

## Acceptance Criteria
- [ ] TranscriptViewer is standalone component
- [ ] Parses transcript for timestamps
- [ ] Renders TimeAnchor components for timestamps
- [ ] Highlights currently playing segment
- [ ] Auto-scrolls to current position during playback
- [ ] Supports collapsible sections (summary, action items, full transcript)

## Proposed Component

```tsx
interface TranscriptViewerProps {
  transcript: string
  currentTimeMs?: number
  onSeek: (startMs: number, endMs?: number) => void
  showSummary?: boolean
  showActionItems?: boolean
}
```

## Files to Create
- `apps/electron/src/features/library/components/TranscriptViewer.tsx`

## Files to Modify
- `apps/electron/src/features/library/components/index.ts`
- `apps/electron/src/features/library/components/SourceDetailDrawer.tsx`

## Dependencies
- TODO-010 (TimeAnchor component)
