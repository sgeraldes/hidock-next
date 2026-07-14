import { createHandler } from './create-handler'
import { CHANNELS } from './channels'
import { AudioChunkInput } from './validation'
import type { AudioTranscriptionBridge } from '../services/audio-transcription-bridge'

// Module-level DI reference (matches pattern used by suggestion-handlers, notes-handlers, etc.)
let _audioBridge: AudioTranscriptionBridge | null = null

export function setAudioBridge(bridge: AudioTranscriptionBridge): void {
  _audioBridge = bridge
}

export function getAudioBridge(): AudioTranscriptionBridge | null {
  return _audioBridge
}

export function registerAudioHandlers(): void {
  createHandler({
    channel: CHANNELS.audio.chunk,
    schema: AudioChunkInput,
    handler: async (input) => {
      if (!_audioBridge) return { ok: false, reason: 'no bridge' }

      const buffer = Buffer.from((input.data as ArrayBufferView).buffer as ArrayBuffer)
      _audioBridge.receiveChunk(buffer, input.timestamp)
      return { ok: true }
    },
  })

  console.log('[IPC] Audio handlers registered')
}
