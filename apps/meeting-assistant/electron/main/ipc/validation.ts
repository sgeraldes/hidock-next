import { z } from "zod";

// ── Session ──────────────────────────────────────────────────────────────────

export const SessionListInput = z.void();

export const SessionCreateInput = z.void();

export const SessionGetInput = z.object({
  sessionId: z.string(),
});

export const SessionEndInput = z.object({
  sessionId: z.string(),
});

export const SessionDeleteInput = z.object({
  sessionId: z.string(),
});

export const SessionLinkMeetingInput = z.object({
  sessionId: z.string(),
  meetingId: z.string(),
});

// ── Transcript ───────────────────────────────────────────────────────────────

export const TranscriptGetSegmentsInput = z.object({
  sessionId: z.string(),
  offset: z.number().int().nonnegative().optional(),
  limit: z.number().int().positive().optional(),
});

export const TranscriptGetRecentInput = z.object({
  sessionId: z.string(),
  maxAgeSecs: z.number().positive().optional(),
  maxCount: z.number().int().positive().optional(),
});

// ── Suggestion ───────────────────────────────────────────────────────────────

export const SuggestionGetActiveInput = z.object({
  sessionId: z.string(),
});

export const SuggestionDismissInput = z.object({
  suggestionId: z.string(),
});

// ── Notes ────────────────────────────────────────────────────────────────────

export const NotesGenerateInput = z.object({
  sessionId: z.string(),
  templateId: z.string().optional(),
});

export const NotesGetForSessionInput = z.object({
  sessionId: z.string(),
});

export const NotesUpdateInput = z.object({
  notesId: z.string(),
  content: z.string(),
});

export const NotesListTemplatesInput = z.void();

export const NotesCategorizeInput = z.object({
  notesId: z.string(),
  category: z.string(),
});

// ── Screenshot ───────────────────────────────────────────────────────────────

export const ScreenshotCaptureInput = z.object({
  sessionId: z.string(),
});

export const ScreenshotListInput = z.object({
  sessionId: z.string(),
});

export const ScreenshotGetAnalysisInput = z.object({
  screenshotId: z.string(),
});

export const ScreenshotConfigureInput = z.object({
  autoCapture: z.boolean().optional(),
  intervalSeconds: z.number().int().positive().optional(),
  analyzeWithLLM: z.boolean().optional(),
});

// ── Knowledge Base ────────────────────────────────────────────────────────────

export const KnowledgeAddSourceInput = z.object({
  path: z.string(),
});

export const KnowledgeRemoveSourceInput = z.object({
  sourcePath: z.string(),
});

export const KnowledgeSearchInput = z.object({
  query: z.string(),
  topK: z.number().int().positive().optional(),
});

export const KnowledgeReindexInput = z.void();

// ── Settings ─────────────────────────────────────────────────────────────────

export const SettingsGetInput = z.object({
  key: z.string(),
});

export const SettingsSetInput = z.object({
  key: z.string(),
  value: z.unknown(),
});

export const SettingsGetAllInput = z.void();

export const SettingsGetCategoryInput = z.object({
  category: z.string(),
});

export const SettingsTestConnectionInput = z.void();
