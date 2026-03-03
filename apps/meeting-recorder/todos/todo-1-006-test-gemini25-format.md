# Task: Verify Gemini 2.5 multimodal flow produces same output format

**Phase**: 1
**Priority**: High
**Estimated Complexity**: Low

## Context
Ensure Gemini 2.5 produces TranscriptionResult schema matching existing format. Design doc specifies backward compatibility.

## Current State
Tests exist for Gemini 2.0 multimodal flow.

## What's Missing/Needed
Create unit test verifying Gemini 2.5 outputs correct schema.

## Dependencies
- [ ] Task: Update DEFAULT_MODELS
- [ ] Task: Update @ai-sdk/google dependency

## Acceptance Criteria
- [ ] Test file exists for Gemini 2.5 validation
- [ ] Test verifies TranscriptionResult has segments, topics, actionItems
- [ ] Test verifies segment structure (speaker, text, sentiment, etc.)
- [ ] Test passes with Gemini 2.5 Flash
- [ ] No schema breaking changes

## Files to Create/Modify
- `electron/main/services/__tests__/ai-provider-gemini25.test.ts` - NEW test file
- `electron/main/services/ai-provider.ts` - May need minor adjustments

## Testing Requirements
Run test with mock audio to verify schema compliance
