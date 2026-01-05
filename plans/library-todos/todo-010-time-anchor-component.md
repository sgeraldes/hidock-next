# TODO-010: Create TimeAnchor Component for Transcript

## Status: PENDING

## Phase: 7 (Detail Drawer & Tri-Pane Layout)

## Priority: MEDIUM

## Summary
Create a clickable timestamp component for transcripts that seeks the audio player to that position when clicked.

## Problem
- Transcripts show as plain text without interactive timestamps
- No way to jump to specific parts of audio from transcript
- No visual highlighting of current playback position in transcript

## Acceptance Criteria
- [ ] TimeAnchor component renders as clickable timestamp
- [ ] Click seeks audio to that position
- [ ] Current segment highlighted during playback
- [ ] Keyboard accessible (Enter/Space to click)
- [ ] Proper aria-label describing action

## Proposed Component

```tsx
interface TimeAnchorProps {
  startMs: number
  endMs?: number
  children: React.ReactNode
  isActive?: boolean
  onSeek: (startMs: number, endMs?: number) => void
}

const TimeAnchor: React.FC<TimeAnchorProps> = ({
  startMs,
  endMs,
  children,
  isActive,
  onSeek
}) => {
  const formattedTime = formatDuration(startMs / 1000)

  return (
    <button
      onClick={() => onSeek(startMs, endMs)}
      className={cn(
        "text-muted-foreground hover:text-primary",
        isActive && "bg-primary/10 text-primary"
      )}
      aria-label={`Jump to ${formattedTime}`}
    >
      [{formattedTime}] {children}
    </button>
  )
}
```

## Files to Create
- `apps/electron/src/features/library/components/TimeAnchor.tsx`

## Files to Modify
- `apps/electron/src/features/library/components/index.ts`
- `apps/electron/src/features/library/components/SourceDetailDrawer.tsx`

## Dependencies
- None
