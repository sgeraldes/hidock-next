# Spec 2-004: analyzeTranscript Method (Stage 2 Gemini Analysis)

## Summary

Add an `analyzeTranscript()` method to `AIProviderService` that takes raw text from Chirp 3 and produces structured output (speakers, topics, action items) using Gemini. This is Stage 2 of the two-stage pipeline.

## Consolidates

- todo-2-004 (Add analyzeTranscript method to ai-provider.ts)

## Layer: 2 (Core Implementation)

## Files to Modify

### `electron/main/services/ai-provider.ts`

Add new method:

```typescript
async analyzeTranscript(
  text: string,
  options?: {
    meetingContext?: string;
    attendees?: string[];
    wordData?: Array<{ word: string; startTime: number; endTime: number; confidence: number }>;
  }
): Promise<TranscriptionResult> {
  if (!this.model) {
    throw new Error("AI provider not configured");
  }

  const systemPrompt = this.buildAnalysisPrompt(text, options);

  const { object } = await generateObject({
    model: this.model,
    schema: TranscriptionResultSchema,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: `Analyze this transcript and identify speakers, topics, and action items:\n\n${text}`,
      },
    ],
  });

  return object;
}
```

### Analysis Prompt Builder

```typescript
private buildAnalysisPrompt(
  text: string,
  options?: { meetingContext?: string; attendees?: string[]; wordData?: Array<...> }
): string {
  const parts: string[] = [
    "You are a meeting analysis AI. Analyze the provided transcript text.",
    "Identify distinct speakers and assign them consistent names.",
    "Extract key topics discussed and any action items mentioned.",
    "",
    "For speaker identification:",
    "- Use context clues (names mentioned, role references) to identify speakers.",
    "- If speakers cannot be identified by name, use 'Speaker 1', 'Speaker 2', etc.",
    "- Maintain consistent speaker labels across the analysis.",
  ];

  if (options?.attendees?.length) {
    parts.push(`\nKnown meeting attendees: ${options.attendees.join(", ")}`);
  }

  if (options?.meetingContext) {
    parts.push(`\nPrevious context:\n${options.meetingContext}`);
  }

  if (options?.wordData?.length) {
    parts.push(
      "\nWord-level timing data is available. Use it to determine speaker turn boundaries.",
      "Significant pauses (>0.5s) between words often indicate speaker changes."
    );
  }

  return parts.join("\n");
}
```

### `electron/main/services/ai-provider.types.ts`

No changes needed - `TranscriptionResult` already has the right shape (segments, topics, actionItems).

## Key Design Decisions

### Text-Only Analysis (No Audio)

`analyzeTranscript()` is text-only - it does NOT receive audio data. Chirp 3 handles audio-to-text (Stage 1), and Gemini handles text-to-structure (Stage 2). This means:

- Any Gemini model works (not just audio-capable ones)
- Lower cost (text tokens << audio tokens)
- Faster processing (no audio encoding overhead)
- Better separation of concerns

### Word Data Enhancement

When word-level timing data from Chirp 3 is available, it's passed as supplementary information to help Gemini with speaker diarization. Pause patterns between words help identify speaker turns.

### Fallback Behavior

If `analyzeTranscript()` fails:
- Auth errors: throw immediately (not retryable)
- Other errors: return basic fallback result (single "Unknown" speaker segment with the raw text)
- This ensures the transcript is never lost even if analysis fails

## Test Cases (10 tests)

### `electron/main/__tests__/ai-provider-analyze.test.ts`

1. analyzeTranscript returns TranscriptionResult with segments
2. analyzeTranscript returns topics array
3. analyzeTranscript returns actionItems array
4. analyzeTranscript uses text-only model (no audio content)
5. analyzeTranscript includes attendees in prompt when provided
6. analyzeTranscript includes meetingContext in prompt when provided
7. analyzeTranscript includes wordData guidance in prompt when provided
8. analyzeTranscript throws on auth error
9. analyzeTranscript returns fallback on transient error
10. analyzeTranscript throws when not configured

## Dependencies

- Phase 1 complete (AIProviderService, model config, generateObject infrastructure)

## Acceptance Criteria

- [ ] analyzeTranscript method exists on AIProviderService
- [ ] Takes raw text + optional context/attendees/wordData
- [ ] Uses Gemini via generateObject with TranscriptionResultSchema
- [ ] Returns structured TranscriptionResult
- [ ] Fallback on non-auth errors
- [ ] 10 tests pass
- [ ] TypeScript compiles without errors
