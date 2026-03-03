# Spec 2-001: Install @google-cloud/speech & Create Chirp3Provider Shell

## Summary

Install the Google Cloud Speech-to-Text SDK and create the foundational `Chirp3Provider` class that wraps the SDK for chunk-based recognition. This is the foundation layer that all other Phase 2 specs depend on.

## Consolidates

- todo-2-001 (Install @google-cloud/speech dependency)
- todo-2-002 (Create chirp3-provider.ts service)

## Layer: 1 (Foundation)

## Files to Create

### `electron/main/services/chirp3-provider.ts`

```typescript
class Chirp3Provider {
  private client: SpeechClient | null = null;
  private projectId: string = "";
  private location: string = "global";
  private configured: boolean = false;

  configure(config: Chirp3Config): void
  isConfigured(): boolean
  async recognizeChunk(audioData: Buffer, mimeType: string): Promise<Chirp3Result>
  async recognizeBatch(audioPath: string): Promise<Chirp3Result>
  filterByConfidence(words: Chirp3Word[], threshold?: number): Chirp3Word[]
  dispose(): void
}
```

### `electron/main/services/chirp3-provider.types.ts`

```typescript
interface Chirp3Config {
  credentials: GCPCredentials;
  projectId: string;
  location?: string;        // default: "global"
  languageCode?: string;    // default: "en-US"
  model?: string;           // default: "chirp_2" (latest Chirp)
  confidenceThreshold?: number; // default: 0.7
}

interface GCPCredentials {
  type: "api-key" | "service-account";
  apiKey?: string;
  serviceAccountJson?: string; // JSON string of service account key
}

interface Chirp3Word {
  word: string;
  startTime: number;  // seconds
  endTime: number;    // seconds
  confidence: number; // 0.0-1.0
  speakerTag?: number;
}

interface Chirp3Result {
  transcript: string;
  words: Chirp3Word[];
  confidence: number;       // overall
  languageCode: string;
  isFinal: boolean;
}
```

## Files to Modify

### `package.json`

Add dependency: `"@google-cloud/speech": "^6.8.0"`

## Implementation Details

### SDK Selection: V1 API with Chirp Model

Use `@google-cloud/speech` V1 API (simpler, well-documented). Chirp 2 model is available via V1 `recognize()` method.

The V1 `recognize()` call matches our chunk-based architecture perfectly - each 3-second chunk is sent as an individual recognition request.

### Audio Format Handling

Current audio is WebM/Opus at 16kHz mono. The Speech-to-Text API supports:
- `OGG_OPUS` encoding (our format)
- `WEBM_OPUS` encoding (alternate format)

The provider must normalize the mimeType from renderer (`audio/ogg;codecs=opus` or `audio/webm;codecs=opus`) to the appropriate SDK encoding enum.

### Authentication

Support two modes:
1. **API Key** - Simpler setup, passed via `SpeechClient({apiKey})` or REST header
2. **Service Account JSON** - More secure, passed via `SpeechClient({credentials: JSON.parse(json)})`

The provider should NOT require a JSON key file on disk - accept the JSON string from settings and parse it in memory (avoids file management complexity).

### Confidence Filtering

`filterByConfidence()` removes words below threshold (default 0.7). Called after recognition, before passing to Stage 2. Low-confidence words are replaced with `[...]` placeholder to preserve timing but indicate uncertainty.

### Error Handling

- Missing/invalid credentials: throw descriptive error, don't crash
- Network errors: return error result with `isFinal: false`
- Rate limiting: log warning, propagate error for retry in pipeline
- Invalid audio: return empty result with warning

## Test Cases (12 tests)

### Unit Tests: `electron/main/__tests__/chirp3-provider.test.ts`

1. Chirp3Provider instantiates without error
2. configure() sets client and projectId
3. isConfigured() returns false before configure
4. isConfigured() returns true after configure with valid credentials
5. recognizeChunk() throws when not configured
6. recognizeChunk() sends correct config to SpeechClient (mocked)
7. recognizeChunk() maps OGG_OPUS mimeType correctly
8. recognizeChunk() maps WEBM_OPUS mimeType correctly
9. recognizeChunk() returns Chirp3Result with transcript and words
10. filterByConfidence() removes words below threshold
11. filterByConfidence() keeps words at or above threshold
12. dispose() sets client to null and configured to false

## Dependencies

- None (Layer 1 foundation)

## Acceptance Criteria

- [ ] `@google-cloud/speech` installed and importable
- [ ] Chirp3Provider class exists with all methods
- [ ] Type definitions exported
- [ ] 12 unit tests pass
- [ ] TypeScript compiles without errors
