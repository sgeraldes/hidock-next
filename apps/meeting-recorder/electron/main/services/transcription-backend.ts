/** Chirp 3 STT → Gemini structured analysis (two-stage pipeline). */
export const BACKEND_CHIRP3_GEMINI = "chirp3+gemini" as const;

/** Gemini processes audio directly (single-stage pipeline). */
export const BACKEND_GEMINI_MULTIMODAL = "gemini-multimodal" as const;

export type TranscriptionBackend =
  | typeof BACKEND_CHIRP3_GEMINI
  | typeof BACKEND_GEMINI_MULTIMODAL;
