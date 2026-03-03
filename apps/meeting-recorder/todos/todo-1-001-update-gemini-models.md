# Task: Update DEFAULT_MODELS to use Gemini 2.5 Flash

**Phase**: 1
**Priority**: High
**Estimated Complexity**: Low

## Context
Gemini 2.0 is deprecated. Need to update to Gemini 2.5 Flash as the new default model. This is referenced in design doc section "Phase 1: Gemini 2.5/3.0 Upgrade".

## Current State
`electron/main/services/ai-provider.types.ts` line 63 currently uses `"gemini-2.0-flash"`.

## What's Missing/Needed
Change the default model string to `"gemini-2.5-flash"`.

## Dependencies
- No dependencies

## Acceptance Criteria
- [ ] DEFAULT_MODELS.google is set to "gemini-2.5-flash"
- [ ] No breaking changes to existing API calls
- [ ] TypeScript compiles without errors

## Files to Create/Modify
- `electron/main/services/ai-provider.types.ts` - Change line 63 default model
- `electron/main/services/__tests__/ai-provider.test.ts` - Add test verifying new default

## Testing Requirements
Run unit tests to verify model string matches "gemini-2.5-flash"
