# TODO-018: AI Title & Question Generation During Transcription

## Summary

Enhanced the transcription pipeline to automatically generate:
1. A brief title suggestion (3-8 words) for each recording
2. 4-5 context-aware, specific questions for the AssistantPanel

This feature provides users with better recording organization and more relevant AI assistant suggestions based on the actual content of their recordings.

## Changes Made

### Database Layer

**File: `apps/electron/electron/main/services/database.ts`**
- Bumped schema version from 15 to 16
- Added migration v16 to add `title_suggestion` and `question_suggestions` columns to `transcripts` table
- Updated `SCHEMA` to include new columns in the transcripts table definition
- Updated `insertTranscript` function to support the new fields
- Added `updateKnowledgeCaptureTitle` function to auto-update recording titles when they match filename patterns

**File: `apps/electron/electron/main/types/database.ts`**
- Updated `Transcript` interface to include:
  - `title_suggestion: string | null` - AI-generated title (3-8 words)
  - `question_suggestions: string | null` - JSON string array of 4-5 context-aware questions

### Transcription Service

**File: `apps/electron/electron/main/services/transcription.ts`**
- Enhanced analysis prompt to generate:
  - Title suggestions (3-8 words that capture the essence of the recording)
  - Question suggestions (4-5 specific, context-aware questions)
- Updated analysis type definition to include new fields
- Modified transcript creation to save `title_suggestion` and `question_suggestions`
- Added logic to auto-update `knowledge_captures.title` if:
  - A title suggestion exists
  - Current title looks like a filename (contains `.` or equals "Untitled")
- Imported `updateKnowledgeCaptureTitle` function

### UI Components

**File: `apps/electron/src/features/library/components/AssistantPanel.tsx`**
- Added `transcript` prop with type `{ question_suggestions?: string | null } | null`
- Implemented dynamic question parsing:
  - Parses `question_suggestions` JSON from transcript
  - Falls back to default questions if parsing fails or no suggestions exist
  - Default questions: "What were the key topics discussed?", "What action items were mentioned?", "Summarize the main decisions made"
- Updated suggested questions UI to map through dynamic questions array

**File: `apps/electron/src/pages/Library.tsx`**
- Passed `selectedTranscript` to `AssistantPanel` component
- Enables dynamic question suggestions based on transcript content

## Acceptance Criteria Status

- ✅ Transcription generates title_suggestion
- ✅ Transcription generates 4-5 question_suggestions
- ✅ Recording title auto-populated if not set (via `updateKnowledgeCaptureTitle`)
- ✅ AssistantPanel shows dynamic questions
- ✅ Fallback to defaults if suggestions unavailable
- ✅ Existing transcripts continue to work (backwards compatible - nullable fields)

## Implementation Details

### Title Generation
- AI generates 3-8 word descriptive titles during transcription analysis
- Titles are designed to capture the essence of the recording
- Stored in `transcripts.title_suggestion` as TEXT (nullable)
- Auto-updates `knowledge_captures.title` only if current title matches filename pattern

### Question Generation
- AI generates 4-5 specific, context-aware questions
- Questions are designed to be actionable and specific (e.g., "What was decided about the Q3 marketing budget?")
- Generic questions are avoided (e.g., "What was discussed?" or "Tell me more")
- Stored as JSON array in `transcripts.question_suggestions` (nullable)
- Parsed and displayed in AssistantPanel with graceful fallback

### Backwards Compatibility
- New columns are nullable, so existing transcripts work without issues
- Migration v16 runs automatically on first app launch after update
- AssistantPanel gracefully handles missing or invalid `question_suggestions`
- Default questions are shown if no AI-generated questions are available

## Testing Recommendations

1. **New Transcriptions**: Transcribe a new recording and verify:
   - Title suggestion is generated and saved
   - Question suggestions are generated (4-5 questions)
   - Recording title is auto-updated if it was filename-based
   - AssistantPanel shows the AI-generated questions

2. **Existing Transcripts**: Open a recording transcribed before this update:
   - Verify no errors occur
   - Confirm default questions are shown in AssistantPanel
   - Ensure all other transcript data displays correctly

3. **Edge Cases**:
   - Transcription with empty/invalid question_suggestions JSON
   - Recording with custom title (should not be overwritten)
   - Recording with filename-based title (should be updated)

## Files Modified

1. `apps/electron/electron/main/services/database.ts`
2. `apps/electron/electron/main/types/database.ts`
3. `apps/electron/electron/main/services/transcription.ts`
4. `apps/electron/src/features/library/components/AssistantPanel.tsx`
5. `apps/electron/src/pages/Library.tsx`

## Commits

1. `92eb310c` - feat(transcription): add database migration for AI title and question suggestions
2. `b9533109` - feat(types): update Transcript interface with AI title and question fields
3. `805c0929` - feat(transcription): generate AI title and question suggestions during analysis
4. `47340352` - feat(ui): use dynamic AI-generated questions in AssistantPanel
5. `0fda9b37` - feat(ui): pass transcript to AssistantPanel in Library

## Notes

- The implementation follows the existing pattern in the codebase for JSON storage of arrays
- Error handling is in place for JSON parsing failures
- The feature degrades gracefully when AI doesn't generate suggestions
- Migration uses the same pattern as previous schema updates (v11-v15)
