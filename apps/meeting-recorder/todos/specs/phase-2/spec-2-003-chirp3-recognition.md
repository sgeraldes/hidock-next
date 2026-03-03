# Spec 2-003: Chirp 3 Recognition Implementation

## Summary

Implement the core `recognizeChunk()` method in Chirp3Provider that sends audio to Google Cloud Speech-to-Text with the Chirp 2 model and returns word-level results with timestamps and confidence.

## Consolidates

- todo-2-003 (Implement streaming recognize flow)
- todo-2-014 (Word confidence filtering)

## Layer: 2 (Core Implementation)

## Architecture Decision: Chunk-Based (Not Streaming) for Phase 2

The current architecture processes 3-second audio chunks individually. Phase 2 uses **batch recognition per chunk** (`client.recognize()`) rather than streaming. This matches the existing architecture perfectly:

- Each 3-second chunk → individual `recognize()` call
- Results returned per-chunk, fed to Stage 2 analysis
- Phase 3 will optimize with true streaming if needed

## Files to Modify

### `electron/main/services/chirp3-provider.ts`

Complete the `recognizeChunk()` implementation:

```typescript
async recognizeChunk(audioData: Buffer, mimeType: string): Promise<Chirp3Result> {
  if (!this.client || !this.configured) {
    throw new Error("Chirp3Provider not configured");
  }

  const encoding = this.mapEncoding(mimeType);
  const request = {
    audio: { content: audioData.toString("base64") },
    config: {
      encoding,
      sampleRateHertz: 16000,
      languageCode: this.languageCode,
      model: "chirp_2",
      enableWordTimeOffsets: true,
      enableWordConfidence: true,
      enableAutomaticPunctuation: true,
    },
  };

  const [response] = await this.client.recognize(request);
  return this.mapResponse(response);
}
```

### Encoding Map

```typescript
private mapEncoding(mimeType: string): string {
  const base = mimeType.split(";")[0].trim();
  const encodingMap: Record<string, string> = {
    "audio/ogg": "OGG_OPUS",
    "audio/webm": "WEBM_OPUS",
    "audio/wav": "LINEAR16",
    "audio/flac": "FLAC",
  };
  return encodingMap[base] || "OGG_OPUS";
}
```

### Response Mapping

```typescript
private mapResponse(response: RecognizeResponse): Chirp3Result {
  const results = response.results || [];
  let transcript = "";
  const words: Chirp3Word[] = [];
  let totalConfidence = 0;
  let confidenceCount = 0;

  for (const result of results) {
    if (!result.alternatives?.length) continue;
    const alt = result.alternatives[0];
    transcript += (transcript ? " " : "") + (alt.transcript || "");

    if (alt.words) {
      for (const w of alt.words) {
        const word: Chirp3Word = {
          word: w.word || "",
          startTime: this.durationToSeconds(w.startTime),
          endTime: this.durationToSeconds(w.endTime),
          confidence: w.confidence || 0,
          speakerTag: w.speakerTag,
        };
        words.push(word);
        totalConfidence += word.confidence;
        confidenceCount++;
      }
    }
  }

  return {
    transcript: transcript.trim(),
    words,
    confidence: confidenceCount > 0 ? totalConfidence / confidenceCount : 0,
    languageCode: this.languageCode,
    isFinal: true,
  };
}
```

### Confidence Filtering

```typescript
filterByConfidence(words: Chirp3Word[], threshold?: number): Chirp3Word[] {
  const t = threshold ?? this.confidenceThreshold;
  return words.filter(w => w.confidence >= t);
}

buildFilteredTranscript(words: Chirp3Word[], threshold?: number): string {
  const t = threshold ?? this.confidenceThreshold;
  return words
    .map(w => w.confidence >= t ? w.word : "[...]")
    .join(" ")
    .replace(/\s*\[\.\.\.\]\s*(\[\.\.\.\]\s*)*/g, " [...] ") // collapse consecutive
    .trim();
}
```

### Batch Recognition (for post-processing)

```typescript
async recognizeBatch(audioPath: string): Promise<Chirp3Result> {
  if (!this.client || !this.configured) {
    throw new Error("Chirp3Provider not configured");
  }

  const audioData = await fs.promises.readFile(audioPath);
  const ext = path.extname(audioPath).toLowerCase();
  const mimeMap: Record<string, string> = {
    ".ogg": "audio/ogg",
    ".webm": "audio/webm",
    ".wav": "audio/wav",
    ".flac": "audio/flac",
  };

  return this.recognizeChunk(audioData, mimeMap[ext] || "audio/ogg");
}
```

## Test Cases (18 tests)

### `electron/main/__tests__/chirp3-recognition.test.ts`

**Recognition:**
1. recognizeChunk sends correct encoding for audio/ogg
2. recognizeChunk sends correct encoding for audio/webm
3. recognizeChunk sends correct encoding for audio/wav
4. recognizeChunk sends model "chirp_2" in config
5. recognizeChunk enables word time offsets
6. recognizeChunk enables word confidence
7. recognizeChunk enables automatic punctuation
8. recognizeChunk maps response to Chirp3Result format
9. recognizeChunk calculates average confidence correctly
10. recognizeChunk handles empty response gracefully
11. recognizeChunk handles multi-result response
12. recognizeChunk throws when not configured

**Confidence Filtering:**
13. filterByConfidence removes words below 0.7 threshold
14. filterByConfidence keeps words at 0.7 exactly
15. filterByConfidence with custom threshold (0.5)
16. buildFilteredTranscript replaces low-confidence words with [...]
17. buildFilteredTranscript collapses consecutive [...] markers
18. filterByConfidence returns empty array for all-low-confidence input

## Dependencies

- Spec 2-001 (Chirp3Provider class and types)

## Acceptance Criteria

- [ ] recognizeChunk sends correct request to Google Cloud Speech API
- [ ] Response mapped to Chirp3Result with words, timestamps, confidence
- [ ] Encoding auto-detected from mimeType
- [ ] Confidence filtering works with configurable threshold
- [ ] Batch recognition reads from file path
- [ ] 18 tests pass
- [ ] TypeScript compiles without errors
