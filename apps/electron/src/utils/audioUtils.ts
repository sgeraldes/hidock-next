/**
 * Audio Processing Utilities
 *
 * Provides utilities for audio decoding and waveform data generation.
 */

// Create singleton AudioContext (prevents exhausting browser's ~6 context limit)
let audioContext: AudioContext | null = null

/**
 * Get or create the singleton AudioContext
 * Reuses the same context to avoid exhausting browser's context limit (~6)
 */
function getAudioContext(): AudioContext {
  if (!audioContext) {
    audioContext = new AudioContext()
  }
  return audioContext
}

/**
 * Generate waveform data from an AudioBuffer by sampling amplitude peaks
 *
 * @param audioBuffer - Decoded audio buffer from Web Audio API
 * @param sampleCount - Number of waveform samples to generate (default: 1000)
 * @returns Float32Array containing normalized amplitude values (0.0 to 1.0)
 */
export async function generateWaveformData(
  audioBuffer: AudioBuffer,
  sampleCount: number = 1000
): Promise<Float32Array> {
  // Get mono or left channel data
  const rawData = audioBuffer.getChannelData(0)
  const blockSize = Math.floor(rawData.length / sampleCount)
  const waveformData = new Float32Array(sampleCount)

  // Calculate peak amplitude for each block
  for (let i = 0; i < sampleCount; i++) {
    const start = i * blockSize
    const end = start + blockSize
    let max = 0

    // Find peak amplitude in this block
    for (let j = start; j < end && j < rawData.length; j++) {
      const abs = Math.abs(rawData[j])
      if (abs > max) max = abs
    }

    waveformData[i] = max
  }

  return waveformData
}

/**
 * Decode base64-encoded audio data into an AudioBuffer
 *
 * @param base64Data - Base64-encoded audio file content
 * @param _mimeType - MIME type of the audio (unused, for future use)
 * @returns Decoded AudioBuffer
 */
export async function decodeAudioData(
  base64Data: string,
  _mimeType: string
): Promise<AudioBuffer> {
  // Use singleton audio context instead of creating new one
  const audioContext = getAudioContext()

  // Decode base64 to binary
  const binaryData = atob(base64Data)
  const arrayBuffer = new ArrayBuffer(binaryData.length)
  const uint8Array = new Uint8Array(arrayBuffer)

  for (let i = 0; i < binaryData.length; i++) {
    uint8Array[i] = binaryData.charCodeAt(i)
  }

  // Decode audio data
  return await audioContext.decodeAudioData(arrayBuffer)
}

/**
 * Format time in seconds to HH:MM:SS or MM:SS format
 *
 * @param seconds - Time in seconds
 * @returns Formatted time string
 */
export function formatTimestamp(seconds: number): string {
  if (!isFinite(seconds) || isNaN(seconds)) return '0:00'

  const hours = Math.floor(seconds / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)

  if (hours > 0) {
    return `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }

  return `${mins}:${secs.toString().padStart(2, '0')}`
}

/**
 * Format file size in bytes to human-readable string
 *
 * @param bytes - File size in bytes
 * @returns Formatted file size string (e.g., "1.5 MB")
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'

  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))

  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}
