import { z } from "zod";

export const TranscriptionSegmentSchema = z.object({
  speaker: z.string().describe("Speaker name or identifier"),
  text: z.string().describe("Transcribed text for this segment"),
  startMs: z.number().optional().describe("Start time in milliseconds"),
  endMs: z.number().optional().describe("End time in milliseconds"),
  sentiment: z
    .enum(["positive", "negative", "neutral"])
    .optional()
    .describe("Sentiment of this segment"),
  language: z.string().optional().describe("ISO 639-1 language code detected"),
});

export const TranscriptionResultSchema = z.object({
  segments: z
    .array(TranscriptionSegmentSchema)
    .describe("Transcription segments with speaker identification"),
  topics: z.array(z.string()).describe("Main topics discussed in this chunk"),
  actionItems: z
    .array(
      z.object({
        text: z.string().describe("Action item description"),
        assignee: z
          .string()
          .optional()
          .describe("Person assigned to the action"),
      }),
    )
    .describe("Action items identified in this chunk"),
});

export const SummarizationResultSchema = z.object({
  summary: z.string().describe("Concise summary of the content"),
  keyPoints: z.array(z.string()).describe("Key points from the conversation"),
});

export const TranslationResultSchema = z.object({
  translatedSegments: z
    .array(
      z.object({
        originalText: z.string(),
        translatedText: z.string(),
        targetLanguage: z.string(),
      }),
    )
    .describe("Translated text segments"),
});

export const EndOfMeetingResultSchema = z.object({
  title: z.string().describe("Generated meeting title"),
  summary: z.string().describe("Meeting summary"),
  keyTopics: z.array(z.string()).describe("Key topics discussed"),
  actionItems: z
    .array(
      z.object({
        text: z.string(),
        assignee: z.string().optional(),
        dueDate: z.string().optional(),
      }),
    )
    .describe("Action items with optional assignments and due dates"),
  sentiment: z
    .string()
    .describe("Overall meeting sentiment (positive/negative/neutral/mixed)"),
  duration: z.string().optional().describe("Estimated meeting duration"),
});
