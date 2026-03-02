# Google Cloud Speech-to-Text Chirp 3 + Gemini 2.5/3.0 Upgrade

**Date:** 2026-03-02
**Status:** Approved
**Author:** Claude

## Executive Summary

Upgrade the transcription system from deprecated Gemini 2.0 Flash to a dual-architecture approach:
- **Google Cloud Speech-to-Text Chirp 3** for accurate, streaming speech recognition
- **Gemini 2.5 Flash / 3.0 Pro** for AI-powered speaker diarization, topic extraction, and action items
- Keep existing Gemini multimodal fallback for audio-capable transcription

## Current Architecture

**Gemini 2.0 Flash (Deprecated):**
- Processes 3-second audio chunks via Vercel AI SDK
- Single API call: audio → structured output (speakers, transcript, topics, actions)
- Uses `generateObject` with Zod schema
- Prone to hallucination (fabricates conversations)
- 15-second timeslice → poor real-time experience

**Problems:**
- Gemini 2.0 is deprecated
- Hallucinations on short/unclear audio
- No word-level confidence scores
- No true streaming (chunk-based only)
- Multimodal API not optimized for speech

## Proposed Architecture

### Two-Stage Pipeline

**Stage 1: Speech Recognition (Chirp 3)**
```
Audio stream → Chirp 3 Streaming Recognize → Raw transcript + word timestamps + confidence
```

**Stage 2: AI Analysis (Gemini 2.5/3.0)**
```
Raw transcript + context → Gemini generateObject → Speakers + Topics + Actions
```

### Why This Approach?

**Chirp 3 Advantages:**
- Purpose-built for speech recognition (99%+ accuracy)
- Real-time streaming results (not chunk-based)
- Word-level confidence scores (filter low-quality words)
- Millisecond-precision timestamps
- Automatic punctuation and capitalization
- Language auto-detection
- Lower cost than multimodal LLM calls

**Gemini 2.5/3.0 Advantages:**
- Latest models (2.0 is deprecated)
- Better at speaker inference from text patterns
- Structured output for topics/actions/sentiment
- Can use context from previous segments
- 2.5 Flash: Fast, cheap (production default)
- 3.0 Pro: Higher quality for critical meetings

### Fallback Strategy

If Chirp 3 unavailable (missing API key, quota exceeded):
- Fall back to Gemini 2.5/3.0 multimodal (audio → structured output)
- Same flow as current implementation
- Graceful degradation

## Implementation Details

### 1. New Service: `chirp3-provider.ts`

```typescript
export class Chirp3Provider {
  private client: SpeechClient;
  private stream: RecognizeStream | null = null;

  async startStream(config: {
    sampleRate: number;
    encoding: string;
    languageCode: string;
  }): Promise<void> {
    const request = {
      config: {
        model: 'chirp_3',
        encoding: config.encoding,
        sampleRateHertz: config.sampleRate,
        languageCode: config.languageCode,
        enableWordTimeOffsets: true,
        enableWordConfidence: true,
        enableAutomaticPunctuation: true,
      },
      interimResults: true,
    };

    this.stream = this.client.streamingRecognize(request);
    this.stream.on('data', (data) => this.handleData(data));
  }

  writeAudioChunk(buffer: Buffer): void {
    this.stream?.write(buffer);
  }

  private handleData(data: google.cloud.speech.v2.IStreamingRecognizeResponse): void {
    // Extract transcript, word-level timestamps, confidence
    // Broadcast to transcription pipeline
  }
}
```

### 2. Modified `ai-provider.ts`

**Add Gemini 2.5/3.0 support:**
```typescript
const DEFAULT_MODELS = {
  google: "gemini-2.5-flash",  // Fast default
  "google-pro": "gemini-3.0-pro",  // High-quality option
  // ... other providers
};
```

**New methods:**
```typescript
// Analyze raw transcript text (from Chirp 3)
async analyzeTranscript(
  text: string,
  options: { attendees?: string[]; meetingContext?: string }
): Promise<TranscriptionResult> {
  // Use Gemini 2.5/3.0 for speaker inference, topics, actions
}
```

### 3. Modified `transcription-pipeline.ts`

**Two-stage processing:**
```typescript
async processAudioChunk(audioData: Buffer, mimeType: string, chunkIndex: number): Promise<void> {
  if (this.chirp3Enabled) {
    // Stage 1: Chirp 3 streaming
    await this.chirp3Provider.writeAudioChunk(audioData);
    // Results come via stream callback → Stage 2
  } else {
    // Fallback: Gemini multimodal (current implementation)
    await this.aiProvider.transcribeAudio(audioData, mimeType, { ... });
  }
}

private async handleChirp3Result(rawTranscript: string, words: Word[]): Promise<void> {
  // Stage 2: Analyze with Gemini 2.5/3.0
  const result = await this.aiProvider.analyzeTranscript(rawTranscript, {
    meetingContext: this.buildContext(),
    attendees: Array.from(this.knownSpeakers),
  });

  // Store and broadcast
  this.storeAndBroadcast(result, chunkIndex);
}
```

### 4. Settings UI Updates

**New settings:**
- Google Cloud Project ID
- Google Cloud API Key (for Chirp 3)
- Gemini Model Selection: 2.5 Flash (default) | 3.0 Pro
- Transcription Backend: Chirp 3 + Gemini (recommended) | Gemini Multimodal (fallback)

### 5. Dependencies

**Add:**
```json
{
  "@google-cloud/speech": "^6.8.0"
}
```

**Update:**
```json
{
  "@ai-sdk/google": "^0.0.70"  // Latest for Gemini 2.5/3.0
}
```

## Migration Path

### Phase 1: Gemini 2.5/3.0 Upgrade (Low Risk)
- Update `DEFAULT_MODELS` to use `gemini-2.5-flash`
- Add `gemini-3.0-pro` as optional upgrade
- Test with existing multimodal flow
- **No breaking changes**

### Phase 2: Chirp 3 Integration (Medium Risk)
- Implement `Chirp3Provider` service
- Add two-stage pipeline to `transcription-pipeline.ts`
- Add settings UI for Google Cloud credentials
- Keep Gemini multimodal as fallback
- **Backwards compatible**

### Phase 3: Streaming Optimization (Low Risk)
- Replace 3-second chunk processing with true streaming
- Use Chirp 3's interim results for real-time display
- Optimize word confidence filtering
- **Performance improvement only**

## Testing Strategy

**Phase 1 Tests:**
- Verify Gemini 2.5 Flash produces same output format
- Test 3.0 Pro upgrade path
- Regression test: existing recordings still work

**Phase 2 Tests:**
- Record 10-second test audio → verify Chirp 3 transcription
- Test fallback when Chirp 3 unavailable
- Verify speaker inference from Gemini analysis
- Test word confidence filtering (remove <70% confidence)

**Phase 3 Tests:**
- Measure latency improvement vs. chunk-based
- Verify interim results display correctly
- Load test: 30+ minute recording

## Rollback Plan

If issues arise:
- **Phase 1:** Revert `DEFAULT_MODELS` to `gemini-2.0-flash`
- **Phase 2:** Disable Chirp 3 in settings, use Gemini multimodal
- **Phase 3:** Disable streaming, use chunk-based

## Success Criteria

- ✅ No more Gemini 2.0 deprecation warnings
- ✅ Chirp 3 streaming transcription works end-to-end
- ✅ Word-level confidence scores available
- ✅ Fallback to Gemini multimodal when Chirp 3 unavailable
- ✅ User can choose Gemini 2.5 Flash or 3.0 Pro
- ✅ No hallucinated transcripts on short audio
- ✅ Real-time transcription latency < 500ms

## Cost Analysis

**Current (Gemini 2.0 Multimodal):**
- 3-second chunks = 1200 chunks/hour
- ~$0.15/hour (audio input tokens)

**Proposed (Chirp 3 + Gemini):**
- Chirp 3: $0.024/minute = $1.44/hour
- Gemini 2.5 text analysis: ~$0.02/hour (text input only)
- **Total: $1.46/hour**

**Trade-off:** 10x cost increase, but:
- Production-grade accuracy
- No hallucinations
- Word-level confidence
- True streaming

## Timeline

- **Phase 1:** 4 hours (Gemini upgrade)
- **Phase 2:** 8 hours (Chirp 3 integration)
- **Phase 3:** 4 hours (Streaming optimization)
- **Total:** ~16 hours

## References

- [Chirp 3 Models](https://cloud.google.com/speech-to-text/docs/models/chirp-3)
- [Streaming Recognize API](https://cloud.google.com/speech-to-text/docs/streaming-recognize)
- [Best Practices](https://cloud.google.com/speech-to-text/docs/best-practices)
- [Word Confidence](https://cloud.google.com/speech-to-text/docs/word-confidence)
- [Gemini 2.5 Flash](https://ai.google.dev/gemini-api/docs/models/gemini-v2)
- [Gemini 3.0 Pro](https://ai.google.dev/gemini-api/docs/models/gemini)
