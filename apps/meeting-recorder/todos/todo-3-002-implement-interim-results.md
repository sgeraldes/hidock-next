# Task: Implement interim results display

**Phase**: 3
**Priority**: High
**Estimated Complexity**: Medium

## Context
Show real-time transcription as Chirp 3 streams results. Design doc specifies interim vs final result distinction.

## Current State
UI only shows final transcription results.

## What's Missing/Needed
Update TranscriptPanel to:
- Display interim results in gray/italic
- Replace with final results when confirmed
- No layout shifts during updates
- Visual distinction between interim/final

## Dependencies
- [ ] Task: Replace chunking with streaming

## Acceptance Criteria
- [ ] Interim results render in gray text
- [ ] Final results render in normal text
- [ ] No layout shifts or jumps
- [ ] Smooth transition interim → final
- [ ] Clear visual distinction
- [ ] Unit tests for UI updates

## Files to Create/Modify
- `src/components/TranscriptPanel.tsx` - Add interim result handling
- `src/hooks/useTranscriptionStream.ts` - Handle interim vs final
- `src/components/__tests__/TranscriptPanel.test.tsx` - Test interim display

## Testing Requirements
Verify interim results display and update correctly
