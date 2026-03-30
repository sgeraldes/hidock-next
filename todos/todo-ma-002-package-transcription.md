# Scaffold packages/transcription
## Current State
Nothing exists.
## What to Create
Package @hidock/transcription with tsup build:
- src/engines/engine-interface.ts - TranscriptionEngine + TranscriptSegment interfaces from spec
- src/engines/cohere-engine.ts, chirp3-engine.ts - stubs
- src/pipeline.ts - stub TranscriptionPipeline
- src/diarizer.ts, vocabulary.ts - stubs
- src/index.ts barrel exports
## Dependencies
None
## Acceptance Criteria
- Build and typecheck pass
- TranscriptSegment has: speaker, text, startTime, endTime, confidence, source
- TranscriptionEngine has: transcribe(), isStreaming, isLocal
