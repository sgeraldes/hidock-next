# Scaffold packages/audio-capture
## Current State
Nothing exists. packages/ only has storage-controller/.
## What to Create
Package @hidock/audio-capture with tsup build, following storage-controller pattern:
- package.json, tsconfig.json, tsup.config.ts, vitest.config.ts
- src/index.ts barrel exports
- src/mic-capture.ts, system-audio-capture.ts, audio-mixer.ts - stub classes
- src/chunk-recorder.ts - stub with ChunkRecorderOptions (3s timeslice, backpressure 15/10)
- src/silence-detector.ts - stub with configurable thresholds (-45dB peak, -40dB mean)
## Dependencies
None
## Acceptance Criteria
- npm run build succeeds
- TypeScript compiles without errors
- All types exported from index.ts
