# Task: Add analyzeTranscript method to ai-provider.ts

**Phase**: 2
**Priority**: High
**Estimated Complexity**: Medium

## Context
Stage 2 of two-stage pipeline: analyze raw Chirp 3 transcript with Gemini for speakers/topics/actions. Design doc specifies this separation.

## Current State
ai-provider.ts only has transcribeAudio (multimodal).

## What's Missing/Needed
Add new method:
```typescript
async analyzeTranscript(
  text: string,
  options: { attendees?: string[]; meetingContext?: string }
): Promise<TranscriptionResult>
```

## Dependencies
- [ ] All Phase 1 tasks completed

## Acceptance Criteria
- [ ] analyzeTranscript method exists
- [ ] Takes raw text transcript as input
- [ ] Uses Gemini 2.5/3.0 (not multimodal, just text)
- [ ] Returns TranscriptionResult with speakers, topics, actions
- [ ] Uses buildTranscriptionPrompt for context
- [ ] Uses generateObject with TranscriptionResultSchema
- [ ] Unit tests verify method

## Files to Create/Modify
- `electron/main/services/ai-provider.ts` - Add analyzeTranscript method
- `electron/main/services/__tests__/ai-provider-analyze.test.ts` - NEW test file

## Testing Requirements
Test with mock text transcript and verify structured output
