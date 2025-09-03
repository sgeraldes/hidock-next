
// Ensure these model names are up-to-date with the latest Gemini offerings.
// The prompt specified 'gemini-2.5-flash-preview-04-17' for general text tasks and multimodal.
export const GEMINI_MODELS = {
  TEXT: 'gemini-2.5-flash-preview-04-17', // For transcription (multimodal) and text analysis
  // IMAGE: 'imagen-3.0-generate-002', // Not used in this app
};

export const MAX_FILE_SIZE_MB = 10;
export const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

export const SUPPORTED_AUDIO_TYPES = [
  'audio/mpeg', // .mp3
  'audio/wav',  // .wav
  'audio/ogg',  // .ogg
  'audio/aac',  // .aac
  'audio/flac', // .flac
  'audio/webm', // .webm (often used by MediaRecorder)
];
