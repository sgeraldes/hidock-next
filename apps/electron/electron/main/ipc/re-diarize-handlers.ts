/**
 * Re-diarize IPC handler.
 *
 * `recordings:reDiarize` re-runs speaker segmentation for ONE recording on
 * demand — used when the diarizer split one person's voice across two labels
 * (or merged two people onto one) and renaming can't fix it. It clears the
 * AUTOMATIC speaker names (preserving the user's MANUAL corrections) and
 * re-queues the recording for (re)transcription so the turns are regenerated,
 * emitting the normal `transcription:*` progress events. See re-diarize.ts.
 */

import { ipcMain } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { resolveRecordingId } from '../services/database'
import { getConfig } from '../services/config'
import { reDiarizeRecording, ClearedAutoBindings } from '../services/re-diarize'

interface ReDiarizeResponse {
  success: boolean
  queueItemId?: string
  cleared?: ClearedAutoBindings
  error?: string
}

// Accept either a bare recordingId string or a { recordingId } payload so the
// renderer bridge can call it as reDiarize(id) regardless of wrapping.
function extractRecordingId(payload: unknown): string | undefined {
  if (typeof payload === 'string') return payload
  if (payload && typeof payload === 'object' && 'recordingId' in payload) {
    const id = (payload as { recordingId?: unknown }).recordingId
    return typeof id === 'string' ? id : undefined
  }
  return undefined
}

export function registerReDiarizeHandlers(): void {
  ipcMain.handle('recordings:reDiarize', async (_, payload: unknown): Promise<ReDiarizeResponse> => {
    try {
      const recordingId = extractRecordingId(payload)
      if (!recordingId || recordingId.trim().length === 0) {
        return { success: false, error: 'recordingId is required' }
      }

      // Re-diarization goes through the transcription pipeline (Gemini couples
      // transcription + diarization). Validate the configured provider's
      // prerequisites up front so the user gets an actionable error, not a
      // silently-failing queue item.
      const config = getConfig()
      const provider = config.transcription.provider || 'gemini'
      if (provider === 'gemini' && !config.transcription.geminiApiKey) {
        return {
          success: false,
          error: 'Transcription API key not configured. Please add your API key in Settings.'
        }
      }
      if (provider === 'local-asr' || provider === 'vibevoice') {
        const runnerPath = join(config.transcription.localAsrPath || '', 'mcp_runner.py')
        if (!config.transcription.localAsrPath || !existsSync(runnerPath)) {
          return {
            success: false,
            error: 'Local ASR runner not found. Check the ASR MCP path in Settings.'
          }
        }
      }

      // Resolve renderer-supplied ids (may be a synced_files id from the unified
      // view) to the real recordings row before clearing / queueing.
      const recording = resolveRecordingId(recordingId)
      if (!recording) {
        return { success: false, error: `Recording not found: ${recordingId}. Try refreshing the library.` }
      }

      const { queueItemId, cleared } = await reDiarizeRecording(recording.id, provider)
      return { success: true, queueItemId, cleared }
    } catch (error) {
      console.error('recordings:reDiarize error:', error)
      return { success: false, error: (error as Error).message }
    }
  })
}
