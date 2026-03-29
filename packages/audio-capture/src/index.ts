// Mic capture
export { MicCapture } from './mic-capture.js'
export type { MicCaptureOptions, AudioStreamHandle } from './mic-capture.js'

// System audio capture
export { SystemAudioCapture } from './system-audio-capture.js'
export type { SystemAudioCaptureOptions } from './system-audio-capture.js'

// Audio mixer
export { AudioMixer } from './audio-mixer.js'
export type { AudioMixerOptions, MixedAudioOutput } from './audio-mixer.js'

// Chunk recorder
export { ChunkRecorder } from './chunk-recorder.js'
export type { ChunkRecorderOptions, AudioChunk, ChunkRecorderEventMap } from './chunk-recorder.js'

// Silence detector
export { SilenceDetector } from './silence-detector.js'
export type { SilenceDetectorOptions, SilenceDetectionResult } from './silence-detector.js'
