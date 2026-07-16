// Engine interface
export type { TranscriptSegment, TranscribeOptions, TranscriptionEngine } from './engines/engine-interface.js'
export { TranscriptionCancelledError } from './engines/engine-interface.js'

// Engines
export { CohereEngine } from './engines/cohere-engine.js'
export type { CohereEngineOptions } from './engines/cohere-engine.js'
export { Chirp3Engine } from './engines/chirp3-engine.js'
export type { Chirp3Options } from './engines/chirp3-engine.js'
export { VibeVoiceEngine } from './engines/vibevoice-engine.js'
export type { VibeVoiceEngineOptions } from './engines/vibevoice-engine.js'
export { GeminiEngine, splitWavIntoChunks, splitMp3IntoChunks, parseTurns } from './engines/gemini-engine.js'
export type { GeminiEngineOptions, AudioChunk } from './engines/gemini-engine.js'

// Pipeline
export { TranscriptionPipeline } from './pipeline.js'
export type { PipelineOptions, PipelineEvents } from './pipeline.js'

// Diarizer
export { Diarizer } from './diarizer.js'

// Vocabulary corrector
export { VocabularyCorrector, escapeRegex } from './vocabulary.js'
