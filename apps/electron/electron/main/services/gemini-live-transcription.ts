import {
  AudioTranscriptionConfigMode,
  GoogleGenAI,
  Modality,
  type Session,
} from '@google/genai'
import type { RealtimeData } from '@hidock/jensen-protocol'
import { resolveGeminiApiKey } from './brains'
import { getConfig } from './config'

export const GEMINI_LIVE_TRANSCRIBE_MODEL = 'gemini-3.5-transcribe-live'
const LIVE_SESSION_ROTATE_MS = 9 * 60 * 1000

export interface LiveTranscriptionSender {
  isDestroyed(): boolean
  send(channel: string, payload?: unknown): void
}

type LiveClient = Pick<GoogleGenAI, 'live'>

/** Convert HiDock's 8-byte-header, stereo PCM16LE packet to Gemini mono PCM16LE. */
export function hidockRealtimeToMonoPcm(packet: RealtimeData): Uint8Array {
  if (packet.muted || packet.data.length <= 8) return new Uint8Array()
  const input = packet.data.subarray(8)
  const frameCount = Math.floor(input.length / 4)
  const output = new Uint8Array(frameCount * 2)
  const inView = new DataView(input.buffer, input.byteOffset, frameCount * 4)
  const outView = new DataView(output.buffer)
  for (let frame = 0; frame < frameCount; frame++) {
    const left = inView.getInt16(frame * 4, true)
    const right = inView.getInt16(frame * 4 + 2, true)
    outView.setInt16(frame * 2, Math.trunc((left + right) / 2), true)
  }
  return output
}

function languageCodes(language: string | undefined): string[] {
  const value = (language ?? '').trim()
  if (!value || /^(auto|unknown)$/i.test(value)) return []
  if (/^es$/i.test(value)) return ['es-419']
  if (/^en$/i.test(value)) return ['en-US']
  return [value]
}

export class GeminiLiveTranscriptionService {
  private session: Session | null = null
  private sender: LiveTranscriptionSender | null = null
  private active = false
  private openedAt = 0
  private generation = 0
  private connecting: Promise<void> | null = null

  constructor(
    private readonly createClient: (apiKey: string) => LiveClient = (apiKey) => new GoogleGenAI({ apiKey }),
    private readonly now: () => number = Date.now
  ) {}

  async start(sender: LiveTranscriptionSender): Promise<void> {
    const key = resolveGeminiApiKey()
    if (!key) throw new Error('Gemini API key is required for live transcription')
    await this.stop()
    this.active = true
    this.sender = sender
    await this.connect(key)
  }

  async acceptDevicePacket(packet: RealtimeData): Promise<void> {
    if (!this.active) return
    const pcm = hidockRealtimeToMonoPcm(packet)
    if (pcm.length === 0) return
    if (!this.session || this.now() - this.openedAt >= LIVE_SESSION_ROTATE_MS) {
      await this.reconnect()
    }
    this.session?.sendRealtimeInput({
      audio: {
        data: Buffer.from(pcm).toString('base64'),
        mimeType: 'audio/pcm;rate=16000',
      },
    })
  }

  pause(): void {
    this.session?.sendRealtimeInput({ audioStreamEnd: true })
    this.emit('transcription-live:status', { status: 'paused' })
  }

  async stop(): Promise<void> {
    this.active = false
    this.generation += 1
    const current = this.session
    this.session = null
    this.connecting = null
    if (current) {
      try { current.sendRealtimeInput({ audioStreamEnd: true }) } catch { /* already closed */ }
      try { current.close() } catch { /* already closed */ }
    }
    this.emit('transcription-live:status', { status: 'stopped' })
    this.sender = null
  }

  private async reconnect(): Promise<void> {
    if (this.connecting) return this.connecting
    const key = resolveGeminiApiKey()
    if (!key) throw new Error('Gemini API key is required for live transcription')
    const old = this.session
    this.session = null
    if (old) {
      try { old.sendRealtimeInput({ audioStreamEnd: true }) } catch { /* already closed */ }
      try { old.close() } catch { /* already closed */ }
    }
    this.emit('transcription-live:status', { status: 'reconnecting' })
    return this.connect(key)
  }

  private async connect(apiKey: string): Promise<void> {
    if (this.connecting) return this.connecting
    const generation = ++this.generation
    this.emit('transcription-live:status', { status: 'connecting' })
    this.connecting = (async () => {
      const client = this.createClient(apiKey)
      const session = await client.live.connect({
        model: GEMINI_LIVE_TRANSCRIBE_MODEL,
        config: {
          responseModalities: [Modality.TEXT],
          inputAudioTranscription: {
            languageCodes: languageCodes(getConfig().transcription.language),
            mode: AudioTranscriptionConfigMode.SMART,
          },
        },
        callbacks: {
          onopen: () => this.emit('transcription-live:status', { status: 'connected' }),
          onmessage: (message) => {
            const interim = message.serverContent?.interimInputTranscription?.text?.trim()
            const final = message.serverContent?.inputTranscription?.text?.trim()
            if (interim) this.emit('transcription-live:interim', { text: interim })
            if (final) this.emit('transcription-live:final', { text: final })
          },
          onerror: (event) => this.emit('transcription-live:error', {
            error: event.message || 'Gemini Live transcription error',
          }),
          onclose: () => {
            if (this.active && generation === this.generation) {
              this.session = null
              this.emit('transcription-live:status', { status: 'reconnecting' })
            }
          },
        },
      })
      if (!this.active || generation !== this.generation) {
        session.close()
        return
      }
      this.session = session
      this.openedAt = this.now()
    })().finally(() => {
      this.connecting = null
    })
    return this.connecting
  }

  private emit(channel: string, payload: unknown): void {
    if (this.sender && !this.sender.isDestroyed()) this.sender.send(channel, payload)
  }
}

export const geminiLiveTranscription = new GeminiLiveTranscriptionService()
