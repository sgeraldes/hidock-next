# Task: Add Gemini 3.0 Pro as model option

**Phase**: 1
**Priority**: Medium
**Estimated Complexity**: Low

## Context
Provide users with option to use Gemini 3.0 Pro for higher quality transcription. Design doc specifies this as an optional upgrade path.

## Current State
Only gemini-2.5-flash is available as default.

## What's Missing/Needed
Extend DEFAULT_MODELS record with "google-pro": "gemini-3.0-pro" entry.

## Dependencies
- [ ] Task: Update DEFAULT_MODELS to use Gemini 2.5 Flash
- [ ] Task: Update @ai-sdk/google dependency

## Acceptance Criteria
- [ ] DEFAULT_MODELS has entry for google-pro model
- [ ] Model identifier resolves to "gemini-3.0-pro"
- [ ] No breaking changes to default behavior
- [ ] TypeScript compiles without errors

## Files to Create/Modify
- `electron/main/services/ai-provider.types.ts` - Add google-pro entry
- `electron/main/services/__tests__/ai-provider.test.ts` - Test 3.0 Pro model creation

## Testing Requirements
Verify 3.0 Pro model can be created and used without errors
