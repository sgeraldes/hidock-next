import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../brains', () => ({ resolveGeminiApiKey: () => 'test-key' }))
vi.mock('../config', () => ({
  getConfig: () => ({ transcription: { language: 'es' } }),
}))

import {
  GEMINI_LIVE_TRANSCRIBE_MODEL,
  GeminiLiveTranscriptionService,
  hidockRealtimeToMonoPcm,
} from '../gemini-live-transcription'

describe('Gemini live transcription', () => {
  beforeEach(() => vi.clearAllMocks())

  it('strips the device header and mixes stereo PCM16LE to mono', () => {
    const body = new Uint8Array(16)
    const view = new DataView(body.buffer)
    view.setInt16(8, 1000, true)
    view.setInt16(10, 3000, true)
    view.setInt16(12, -2000, true)
    view.setInt16(14, 1000, true)

    const mono = hidockRealtimeToMonoPcm({ rest: 0, muted: false, data: body })
    const monoView = new DataView(mono.buffer)
    expect(monoView.getInt16(0, true)).toBe(2000)
    expect(monoView.getInt16(2, true)).toBe(-500)
    expect(hidockRealtimeToMonoPcm({ rest: 0, muted: true, data: body })).toHaveLength(0)
  })

  it('connects the dedicated model, sends PCM, and forwards interim/final text', async () => {
    let callbacks: any
    const session = {
      sendRealtimeInput: vi.fn(),
      close: vi.fn(),
    }
    const connect = vi.fn(async (request: any) => {
      callbacks = request.callbacks
      request.callbacks.onopen?.()
      return session
    })
    const sender = { isDestroyed: () => false, send: vi.fn() }
    const service = new GeminiLiveTranscriptionService(() => ({ live: { connect } }) as any)

    await service.start(sender)
    const request = connect.mock.calls[0][0]
    expect(request.model).toBe(GEMINI_LIVE_TRANSCRIBE_MODEL)
    expect(request.config).toMatchObject({
      responseModalities: ['TEXT'],
      inputAudioTranscription: { languageCodes: ['es-419'], mode: 'SMART' },
    })

    const packet = new Uint8Array(12)
    new DataView(packet.buffer).setInt16(8, 400, true)
    new DataView(packet.buffer).setInt16(10, 600, true)
    await service.acceptDevicePacket({ rest: 0, muted: false, data: packet })
    expect(session.sendRealtimeInput).toHaveBeenCalledWith({
      audio: { data: expect.any(String), mimeType: 'audio/pcm;rate=16000' },
    })

    callbacks.onmessage({ serverContent: { interimInputTranscription: { text: 'hola' } } })
    callbacks.onmessage({ serverContent: { inputTranscription: { text: 'hola mundo' } } })
    expect(sender.send).toHaveBeenCalledWith('transcription-live:interim', { text: 'hola' })
    expect(sender.send).toHaveBeenCalledWith('transcription-live:final', { text: 'hola mundo' })
  })
})
