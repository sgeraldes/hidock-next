# Task: Implement Chirp 3 streaming recognize flow

**Phase**: 2
**Priority**: High
**Estimated Complexity**: High

## Context
Implement full streaming recognize API flow with Chirp 3. Design doc references https://cloud.google.com/speech-to-text/docs/streaming-recognize

## Current State
Chirp3Provider class exists but streaming not implemented.

## What's Missing/Needed
Complete implementation:
- Configure stream with model: 'chirp_3'
- Enable word time offsets and confidence
- Handle data events
- Extract transcript, timestamps, confidence scores
- Emit to transcription pipeline

## Dependencies
- [ ] Task: Create chirp3-provider.ts service

## Acceptance Criteria
- [ ] Stream initializes with correct config
- [ ] enableWordTimeOffsets: true
- [ ] enableWordConfidence: true
- [ ] enableAutomaticPunctuation: true
- [ ] interimResults: true
- [ ] handleData extracts transcript and word data
- [ ] Results broadcast to transcription pipeline
- [ ] Unit tests verify stream behavior

## Files to Create/Modify
- `electron/main/services/chirp3-provider.ts` - Complete streaming implementation
- `electron/main/services/__tests__/chirp3-provider.test.ts` - Test stream data handling

## Testing Requirements
Mock stream data events and verify extraction logic
