# Spec 2-005: Two-Stage Pipeline Integration

## Summary

Modify `TranscriptionPipeline` to support dual-path processing: Chirp 3 STT + Gemini analysis (two-stage) vs existing Gemini multimodal (single-stage). Add the callback that bridges Chirp 3 results to Gemini analysis.

## Consolidates

- todo-2-005 (Modify transcription-pipeline.ts for two-stage processing)
- todo-2-006 (Implement handleChirp3Result callback)

## Layer: 3 (Pipeline Integration)

## Files to Modify

### `electron/main/services/transcription-pipeline.ts`

#### New Constructor Parameters

```typescript
class TranscriptionPipeline {
  constructor(
    sessionId: string,
    aiProvider: AIProviderService,
    chirp3Provider?: Chirp3Provider,  // NEW - optional
    transcriptionBackend?: "chirp3+gemini" | "gemini-multimodal",  // NEW
  )
}
```

#### Modified `processAudioChunk()`

```typescript
async processAudioChunk(
  audioData: Buffer,
  mimeType: string,
  chunkIndex: number
): Promise<void> {
  if (this.stopped) return;

  const context = this.buildContext();

  if (
    this.transcriptionBackend === "chirp3+gemini" &&
    this.chirp3Provider?.isConfigured()
  ) {
    // TWO-STAGE PATH: Chirp 3 STT → Gemini analysis
    await this.processWithChirp3(audioData, mimeType, chunkIndex, context);
  } else {
    // SINGLE-STAGE PATH: Gemini multimodal (existing behavior)
    await this.processWithGemini(audioData, mimeType, chunkIndex, context);
  }
}
```

#### New `processWithChirp3()` Method

```typescript
private async processWithChirp3(
  audioData: Buffer,
  mimeType: string,
  chunkIndex: number,
  context: string
): Promise<void> {
  try {
    // Stage 1: Chirp 3 Speech-to-Text
    const chirp3Result = await this.callWithRetry(() =>
      this.chirp3Provider!.recognizeChunk(audioData, mimeType)
    );

    if (!chirp3Result.transcript.trim()) {
      console.log(`[Pipeline] Chunk ${chunkIndex}: Chirp 3 returned empty transcript (silence)`);
      return;
    }

    // Apply confidence filtering
    const filteredWords = this.chirp3Provider!.filterByConfidence(chirp3Result.words);
    const filteredTranscript = filteredWords.map(w => w.word).join(" ");

    // Stage 2: Gemini analysis of text
    const result = await this.callWithRetry(() =>
      this.aiProvider.analyzeTranscript(
        filteredTranscript || chirp3Result.transcript,
        {
          meetingContext: context,
          attendees: Array.from(this.knownSpeakers),
          wordData: filteredWords.map(w => ({
            word: w.word,
            startTime: w.startTime,
            endTime: w.endTime,
            confidence: w.confidence,
          })),
        }
      )
    );

    // Store and broadcast (same as single-stage)
    this.storeAndBroadcast(result, chunkIndex);

  } catch (err) {
    // If Chirp 3 fails, attempt fallback to Gemini multimodal
    console.warn(
      `[Pipeline] Chirp 3 failed for chunk ${chunkIndex}, falling back to Gemini multimodal:`,
      err
    );
    this.broadcastStatus("chirp3-fallback");
    await this.processWithGemini(audioData, mimeType, chunkIndex, context);
  }
}
```

#### Extracted `processWithGemini()` Method

```typescript
private async processWithGemini(
  audioData: Buffer,
  mimeType: string,
  chunkIndex: number,
  context: string
): Promise<void> {
  // This is the EXISTING processAudioChunk logic, extracted to a method
  const result = await this.callWithRetry(() =>
    this.aiProvider.transcribeAudio(audioData, mimeType, {
      meetingContext: context,
      attendees: Array.from(this.knownSpeakers),
    })
  );

  this.storeAndBroadcast(result, chunkIndex);
}
```

#### New `broadcastStatus()` Method

```typescript
private broadcastStatus(status: string): void {
  BrowserWindow.getAllWindows().forEach((w) =>
    w.webContents.send("transcription:status", {
      sessionId: this.sessionId,
      status,
    })
  );
}
```

### `electron/main/ipc/transcription-handlers.ts`

Update pipeline creation to inject Chirp3Provider:

```typescript
import { getChirp3Provider } from "./chirp3-handlers";

function startPipeline(sessionId: string): void {
  const chirp3 = getChirp3Provider();
  const backend = getSetting("ai.transcriptionBackend") || "gemini-multimodal";

  const pipeline = new TranscriptionPipeline(
    sessionId,
    getAIService(),
    chirp3,
    backend as "chirp3+gemini" | "gemini-multimodal",
  );

  pipelines.set(sessionId, pipeline);
}
```

## Key Design Decisions

### Automatic Fallback

If Chirp 3 fails for any chunk, the pipeline automatically falls back to Gemini multimodal for that chunk. This ensures:
- No transcription is lost due to Chirp 3 errors
- Mixed-mode operation is possible (some chunks via Chirp 3, some via Gemini)
- Users get a seamless experience

### Per-Pipeline Configuration

The backend choice is read at pipeline creation time (session start), not per-chunk. This avoids mid-session configuration changes causing inconsistency.

### Empty Transcript Handling

If Chirp 3 returns an empty transcript (silence), skip Stage 2 analysis entirely. The silence detection in audio-handlers.ts should catch most silence, but Chirp 3 provides a second layer.

## Test Cases (15 tests)

### `electron/main/__tests__/transcription-pipeline-chirp3.test.ts`

**Routing:**
1. processAudioChunk uses Chirp 3 path when backend is "chirp3+gemini" and provider configured
2. processAudioChunk uses Gemini path when backend is "gemini-multimodal"
3. processAudioChunk uses Gemini path when Chirp 3 provider not configured
4. processAudioChunk uses Gemini path when Chirp 3 provider is null

**Two-Stage Flow:**
5. processWithChirp3 calls chirp3Provider.recognizeChunk
6. processWithChirp3 calls chirp3Provider.filterByConfidence on results
7. processWithChirp3 calls aiProvider.analyzeTranscript with filtered text
8. processWithChirp3 passes wordData to analyzeTranscript
9. processWithChirp3 passes known speakers as attendees
10. processWithChirp3 calls storeAndBroadcast with analysis result

**Fallback:**
11. processWithChirp3 falls back to Gemini on Chirp 3 error
12. processWithChirp3 broadcasts "chirp3-fallback" status on fallback
13. processWithChirp3 skips Stage 2 when transcript is empty (silence)

**Edge Cases:**
14. Pipeline stops processing when stopped flag is set
15. Pipeline uses retry for both Stage 1 and Stage 2

## Dependencies

- Spec 2-001 (Chirp3Provider)
- Spec 2-003 (recognizeChunk implementation)
- Spec 2-004 (analyzeTranscript method)

## Acceptance Criteria

- [ ] processAudioChunk routes to correct path based on backend setting
- [ ] Two-stage flow: Chirp 3 → confidence filter → Gemini analysis → store
- [ ] Automatic fallback to Gemini multimodal on Chirp 3 failure
- [ ] Empty transcript (silence) skips Stage 2
- [ ] No breaking changes to existing single-stage flow
- [ ] 15 tests pass
- [ ] TypeScript compiles without errors
