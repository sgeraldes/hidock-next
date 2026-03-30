# TODO-001: Inline Title Editing in SourceReader

## Current State
The title displayed in `SourceReader.tsx` (the center panel h2 element) shows the recording title or filename but is NOT editable. Users cannot rename a knowledge capture.

## What's Missing
- Click-to-edit inline title input in SourceReader
- Save/cancel buttons or keyboard shortcuts (Enter/Escape)
- IPC call to persist the new title via `knowledge:update`
- Visual hint that the title is editable (pencil icon or hover state)
- Error handling if save fails
- Optimistic UI update so title updates instantly

## Key Files
- `apps/electron/src/features/library/components/SourceReader.tsx` — main component to modify
- IPC: `window.electronAPI.knowledge.update(id, { title: newTitle })` — already exists
- `apps/electron/electron/main/ipc/knowledge-handlers.ts` — handles `knowledge:update`
- `apps/electron/src/types/unified-recording.ts` — `UnifiedRecording.knowledgeCaptureId` field
- `apps/electron/electron/preload/index.ts` — preload API already exposes `knowledge.update`

## Constraints
- Editing is only possible when `recording.knowledgeCaptureId` is present
- Empty title should not be saved — revert to previous
- Title from meeting subject should NOT be overridden by user rename (meeting.subject takes priority in getDisplayTitle)
- The rename sets `knowledge_captures.title`, not `meetings.subject`
- Must also add editable **category** dropdown (meeting/interview/1:1/brainstorm/note/other) to SourceReader metadata grid

## Dependencies
- None (uses existing IPC)
