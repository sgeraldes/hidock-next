# TODO-003: Transcription Overwrite Warning

## Current State
Users can manually edit metadata (title, category, meeting link) in SourceReader. However, when they then click "Transcribe", the transcription process may overwrite the title and other metadata fields with AI-generated values. There is no warning.

## What's Missing
- Track whether the user has manually edited metadata for the currently selected recording (session-level state — does NOT need to persist to DB)
- When the user clicks "Transcribe" and `hasManualEdits` is true: show a warning toast or confirmation dialog before proceeding
- Warning message: "Transcribing may overwrite some fields you edited manually (title, category, summary). The AI transcription process will update these fields. Continue?"
- After confirming, proceed with transcription as normal

## Key Files
- `apps/electron/src/features/library/components/SourceReader.tsx` — intercept onTranscribe, add warning dialog
- `apps/electron/src/components/ConfirmDialog.tsx` — existing confirm dialog to reuse
- No DB changes needed — this is purely client-side UI state

## Implementation Approach
- `SourceReader` receives a `hasManualEdits?: boolean` prop OR tracks it internally
- The cleanest approach: track internally in `SourceReader` local state
  - Set `metadataEdited = true` whenever title, category, or meeting link is changed
  - Reset `metadataEdited = false` after transcription starts or when recording changes
- Intercept `onTranscribe` call: if `metadataEdited`, show ConfirmDialog first
- ConfirmDialog: "Continue?" → call original `onTranscribe` | "Cancel" → close dialog only

## Constraints
- Do NOT add new IPC calls or DB migrations for this feature
- Warning is per-session only (resets when user navigates to another recording)
- Warning only when BOTH conditions: 1) user made an edit, 2) user clicks Transcribe

## Dependencies
- Depends on spec-001 (title editing) and spec-002 (meeting management) providing the edit callbacks
- Uses existing ConfirmDialog component
