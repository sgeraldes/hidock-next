# Spec 2-007: Phase 2 Integration Test Suite

## Summary

Comprehensive test suite covering the complete Chirp 3 integration: end-to-end pipeline, fallback behavior, speaker inference, and word confidence handling.

## Consolidates

- todo-2-011 (Test e2e Chirp 3)
- todo-2-012 (Test fallback)
- todo-2-013 (Test speaker inference)
- todo-2-014 (Test word confidence)

## Layer: 4 (Testing)

## Test Files to Create

### `electron/main/__tests__/chirp3-e2e.test.ts` - End-to-End Pipeline (10 tests)

Tests the complete two-stage pipeline with mocked Chirp 3 and Gemini APIs.

1. Full pipeline: audio chunk → Chirp 3 STT → Gemini analysis → stored segments
2. Pipeline produces TranscriptionResult with speakers
3. Pipeline produces TranscriptionResult with topics
4. Pipeline produces TranscriptionResult with actionItems
5. Segments stored in database with correct timing (chunkIndex * 3000ms)
6. IPC events broadcast for new segments
7. IPC events broadcast for topics updated
8. IPC events broadcast for action items updated
9. Context from previous chunks passed to Gemini analysis
10. Multiple chunks processed sequentially maintain speaker continuity

### `electron/main/__tests__/chirp3-fallback.test.ts` - Fallback Behavior (10 tests)

Tests graceful degradation when Chirp 3 is unavailable or fails.

1. Falls back to Gemini multimodal when Chirp 3 not configured
2. Falls back to Gemini multimodal when backend is "gemini-multimodal"
3. Falls back to Gemini multimodal when Chirp 3 throws auth error
4. Falls back to Gemini multimodal when Chirp 3 throws network error
5. Falls back to Gemini multimodal when Chirp 3 returns empty result
6. Broadcasts "chirp3-fallback" status when falling back
7. Fallback produces valid TranscriptionResult
8. Fallback result stored in database correctly
9. Mid-session Chirp 3 failure: some chunks via Chirp 3, rest via Gemini
10. Both paths (Chirp 3 + Gemini fallback) produce compatible result formats

### `electron/main/__tests__/chirp3-speakers.test.ts` - Speaker Inference (8 tests)

Tests that Gemini Stage 2 correctly identifies speakers from Chirp 3 text.

1. Single speaker identified correctly
2. Two speakers identified with distinct names
3. Three+ speakers identified with distinct names
4. Speaker names from attendees list used when available
5. Speaker continuity maintained across chunks (known speakers passed)
6. "Speaker 1", "Speaker 2" pattern used when names unavailable
7. Speaker changes detected at word timing gaps (>0.5s pause)
8. Empty transcript returns no speakers (not "Unknown")

### `electron/main/__tests__/chirp3-confidence.test.ts` - Word Confidence (10 tests)

Tests word confidence filtering and transcript quality.

1. Words with confidence >= 0.7 retained
2. Words with confidence < 0.7 removed
3. Words at exactly 0.7 threshold retained
4. Custom threshold (0.5) changes filtering behavior
5. All-high-confidence input: no words removed
6. All-low-confidence input: all words removed, empty transcript
7. Mixed confidence: partial words retained, [...] markers inserted
8. Consecutive low-confidence words: single [...] marker (collapsed)
9. Confidence scores from Chirp 3 response correctly parsed
10. Average confidence calculated correctly across all words

## Mock Strategy

### Chirp 3 Mock

```typescript
vi.mock("@google-cloud/speech", () => ({
  SpeechClient: vi.fn().mockImplementation(() => ({
    recognize: vi.fn().mockResolvedValue([{
      results: [{
        alternatives: [{
          transcript: "Hello this is a test meeting",
          confidence: 0.95,
          words: [
            { word: "Hello", startTime: { seconds: "0", nanos: 0 }, endTime: { seconds: "0", nanos: 500000000 }, confidence: 0.98 },
            { word: "this", startTime: { seconds: "0", nanos: 500000000 }, endTime: { seconds: "0", nanos: 700000000 }, confidence: 0.92 },
            // ... more words
          ],
        }],
        isFinal: true,
      }],
    }]),
    close: vi.fn(),
  })),
}));
```

### Gemini Analysis Mock

```typescript
// Mock generateObject to return structured analysis
vi.mock("ai", () => ({
  generateObject: vi.fn().mockResolvedValue({
    object: {
      segments: [
        { speaker: "Speaker 1", text: "Hello this is a test meeting", sentiment: "neutral" },
      ],
      topics: ["testing", "meetings"],
      actionItems: [{ text: "Set up next meeting", assignee: "Speaker 1" }],
    },
  }),
}));
```

### Database Mock

Use the same settingsDb pattern from Phase 1 tests:
```typescript
const settingsDb = vi.hoisted(() => new Map<string, string>());
// ... standard database mocks
```

## Dependencies

- All Spec 2-001 through 2-006 (full implementation required)

## Acceptance Criteria

- [ ] 38 total new tests across 4 files
- [ ] All tests pass with mocked APIs
- [ ] No real API calls made in tests
- [ ] Tests cover both happy path and error scenarios
- [ ] Tests verify database storage and IPC broadcast
- [ ] TypeScript compiles without errors
- [ ] Tests run in < 30 seconds total
