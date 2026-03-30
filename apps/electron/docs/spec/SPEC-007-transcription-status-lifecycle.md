# SPEC-007: Transcription Status Lifecycle

## Problem Statement
The current transcription status implementation is unreliable, leading to a degraded user experience. Users see incorrect statuses (e.g., "Pending" when transcription is complete), processes get stuck after application restarts, and the UI displays duplicate information or truncated content. These issues stem from a lack of a formal state machine, fragile IPC communication for status updates, and insufficient cleanup logic during the application boot sequence.

## Bugs Addressed
- **BUG-013 (P2): Incorrect/Stuck Status**: 
    - Status shows "Pending" or "Queued" even after successful transcription.
    - Status in the `recordings` table is not updated reliably.
    - App restarts leave "processing" items stuck in the database without being resumed or reset.
- **BUG-014 (P2): Duplicate Summary**: 
    - The recording summary is rendered twice: once in the `SourceReader` header and once in the `TranscriptViewer` collapsible section.
- **BUG-015 (P2): Transcript Truncation/Visibility**:
    - Long transcripts (e.g., >1 hour) appear truncated in the UI.
    - Potential visual truncation due to fixed-height scroll containers (`max-h-96`).
    - Potential API truncation for very long recordings if output token limits are reached.

## User Stories
- As a user, I want to see the accurate, real-time status of my transcription so I know when it's ready.
- As a user, I want my transcription to resume or fail gracefully if I restart the application during processing.
- As a user, I want a clean interface without redundant summaries.
- As a user, I want to be able to read the entire transcript of a long recording without it being cut off.

## Current Behavior (Broken)
1. **Status Mismatch**: The `recordings.transcription_status` column often falls out of sync with the `transcription_queue.status`.
2. **IPC Fragility**: The renderer relies on a 5-second polling interval and volatile store state that doesn't always reconcile correctly with the persistent database state.
3. **Stuck Processes**: If the app closes while a recording is `processing`, it remains in `processing` status indefinitely in the database, preventing future attempts.
4. **Redundant UI**: `SourceReader.tsx` renders `transcript.summary` and also passes `showSummary={true}` to `TranscriptViewer.tsx`, which renders it again.
5. **Scroll Container Limit**: `TranscriptViewer.tsx` uses `max-h-96`, which is only ~384px, making long transcripts difficult to read and appearing "truncated".
6. **Token Limits**: Current Gemini 2.0 Flash models have a default output limit (often 8,192 tokens), which might truncate extremely long transcripts (~1.5h+).

## Expected Behavior (Target)
1. **Source of Truth**: The `recordings.transcription_status` must always reflect the current state of the transcription process.
2. **State Machine Enforcement**: All status transitions must follow a strictly defined lifecycle.
3. **Startup Resilience**: The application must identify and reset "stuck" processing states on startup.
4. **Unified UI**: The summary should only be displayed in the header area to maintain a clean reading experience for the transcript.
5. **Improved Readability**: The transcript viewer should expand to utilize available vertical space rather than using a small fixed height.
6. **Token Awareness**: Configure API calls to maximize output length for long recordings.

## Acceptance Criteria
- [ ] Transcription status in the library sidebar and main panel matches the actual database state.
- [ ] After an app crash/restart, any recording previously in "processing" is reset to "pending" or "none" (if not in queue).
- [ ] Duplicate summary section is removed from `TranscriptViewer`.
- [ ] `TranscriptViewer` scroll container is replaced with a flex-grow container that fills the available height.
- [ ] Gemini API configuration uses `max_output_tokens` appropriately for the model (e.g., 8192 for Flash).
- [ ] "Transcribe" button is correctly enabled/disabled based on the current state.

## Technical Approach

### Status State Machine
Valid values for `transcription_status`: `none`, `pending`, `processing`, `complete`, `failed`.

**Transitions:**
- `none` → `pending`: User clicks "Transcribe" (added to queue).
- `pending` → `processing`: Processor picks up the item.
- `processing` → `complete`: Success.
- `processing` → `failed`: Error encountered (with retry logic).
- `pending` / `processing` → `none`: User cancels transcription.
- `failed` → `pending`: User clicks "Retry" or automatic retry triggers.

**Startup Cleanup Logic:**
In `electron/main/services/transcription.ts`:
```typescript
function cleanupStuckTranscriptions() {
    // 1. Reset 'processing' in queue to 'pending'
    // 2. Sync 'recordings' table status with 'transcription_queue'
    // 3. Ensure 'complete' status is only set if transcript actually exists
}
```

### Duplicate Summary Fix
- **Decision**: Keep the summary in the `SourceReader` header (line 355) because it provides immediate context.
- **Action**: Update `SourceReader.tsx` to pass `showSummary={false}` to `TranscriptViewer`.
- **Action**: Remove the summary toggle/render logic from `TranscriptViewer.tsx` to simplify the component.

### Transcript Completeness
- **Gemini Limits**: The current model `gemini-2.0-flash-exp` supports up to 1M input tokens but defaults to 8,192 output tokens.
- **Optimization**: Ensure `max_output_tokens` is explicitly set to the model's maximum allowed in `transcription.ts`.
- **UI Scroll Fix**: Change `max-h-96` in `TranscriptViewer.tsx` to a more flexible class like `flex-1` or remove the fixed height and let the parent container (`SourceReader` content area) handle the overflow.

### Status Persistence
- **Atomic Updates**: Every change to `transcription_queue.status` MUST be accompanied by an update to `recordings.transcription_status` in the same transaction where possible, or sequentially.
- **IPC Bridge**: Instead of just `notifyRenderer`, the `recordings:getAll` handler should ensure it returns the latest status from the database.

## UI/UX Requirements
- **Progress Indicators**: Show a progress bar or percentage if available in the queue metadata.
- **Error Feedback**: Provide a way to view the error message if status is `failed`.
- **Button States**: 
    - `none` / `failed`: "Transcribe" / "Retry" enabled.
    - `pending`: "Queued" (disabled).
    - `processing`: "In Progress" (disabled + spinner).
    - `complete`: Button hidden (Transcript visible).

## Testing Strategy
- **Unit Tests**: Verify the state machine transitions in the database service.
- **Integration Tests**: Mock the Gemini API to simulate `complete` and `failed` states.
- **Manual Verification**: 
    - Start transcription and force-close the app; verify it resets on next boot.
    - Verify long transcript scrolling works without "fake" truncation.
    - Check that summary only appears once.

## Dependencies & Risks
- **SPEC-001 Relationship**: Relies on real-time IPC updates for the "Transcribe" button state.
- **Risk**: Large audio files might still exceed output limits for very detailed transcripts. Consider chunking strategies if 8k tokens remains insufficient.

## Out of Scope
- Implementing multi-speaker diarization improvements (out of scope for status lifecycle).
- Changing the transcription provider (locked to Gemini for now).
- PDF/Document transcription.
