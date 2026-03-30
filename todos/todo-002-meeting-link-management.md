# TODO-002: Meeting Link Management in SourceReader

## Current State
In `SourceReader.tsx`, the linked meeting is displayed as a read-only card with no way to:
- Change which meeting is linked
- Remove an incorrect meeting link
- Link to a different meeting if auto-detection was wrong

## What's Missing
- "Change" button on the meeting card → opens RecordingLinkDialog
- "Remove" button on the meeting card → calls `recordings:selectMeeting(id, null)`
- When no meeting is linked, a "Link Meeting" action button in the actions bar
- After linking/unlinking, refresh the recording data

## Key Files
- `apps/electron/src/features/library/components/SourceReader.tsx` — add Change/Remove buttons to meeting card
- `apps/electron/src/components/RecordingLinkDialog.tsx` — existing dialog, reuse it
- IPC: `window.electronAPI.recordings.selectMeeting(recordingId, meetingId | null)` — already exists
- `apps/electron/electron/main/ipc/recording-handlers.ts` — `recordings:selectMeeting` already implemented

## Constraints
- The RecordingLinkDialog accepts a `recording` of type `Pick<Recording, 'id' | 'filename' | 'date_recorded' | 'duration_seconds'>` — need to map UnifiedRecording to this shape
- After dialog resolves, call the `refresh()` function from `useUnifiedRecordings` to reload data
- "Remove link" should show a confirmation (brief) before calling the IPC
- SourceReader must accept new props: `onRefresh?: () => void` and `onLinkMeeting?: () => void`

## Dependencies
- RecordingLinkDialog already exists — just wire it up
