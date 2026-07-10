/**
 * Transcription queue-control IPC handlers.
 *
 * These expose the MAIN-PROCESS transcription queue processor to the renderer's
 * Operations dock:
 *
 *   - transcription:pause / transcription:resume  Queue-level pause. Pause stops
 *       DEQUEUING new items; an item already in flight finishes normally (a live
 *       model request cannot be aborted mid-call). Resume continues where it left.
 *   - transcription:reorder                       Apply a user prioritize (up) or
 *       deprioritize (down) intent. Main is the source of truth for the actual
 *       processing order (queuePriorityRank); it echoes queue state back so every
 *       renderer reflects the change.
 *   - transcription:queueState                    Pull the current queue snapshot
 *       (paused? which id is processing? pending/processing counts). Main also
 *       PUSHES this same shape on 'transcription:queueState' whenever it changes.
 *
 * (The pre-existing transcription:cancel / cancelAll / getQueue / updateQueueItem
 * channels live in recording-handlers.ts and are unchanged.)
 */

import { ipcMain } from 'electron'
import { z } from 'zod'
import {
  pauseQueue,
  resumeQueue,
  reorderQueueItem,
  getQueueState,
  type TranscriptionQueueState
} from '../services/transcription'

const ReorderSchema = z.object({
  recordingId: z.string().min(1).max(200),
  direction: z.enum(['up', 'down'])
})

export function registerTranscriptionHandlers(): void {
  ipcMain.handle('transcription:pause', async (): Promise<TranscriptionQueueState> => {
    try {
      return pauseQueue()
    } catch (error) {
      console.error('transcription:pause error:', error)
      return getQueueState()
    }
  })

  ipcMain.handle('transcription:resume', async (): Promise<TranscriptionQueueState> => {
    try {
      return resumeQueue()
    } catch (error) {
      console.error('transcription:resume error:', error)
      return getQueueState()
    }
  })

  ipcMain.handle('transcription:reorder', async (_, request: unknown): Promise<TranscriptionQueueState> => {
    try {
      const parsed = ReorderSchema.safeParse(request)
      if (!parsed.success) {
        console.error('transcription:reorder validation error:', parsed.error.format())
        return getQueueState()
      }
      reorderQueueItem(parsed.data.recordingId, parsed.data.direction)
      return getQueueState()
    } catch (error) {
      console.error('transcription:reorder error:', error)
      return getQueueState()
    }
  })

  ipcMain.handle('transcription:queueState', async (): Promise<TranscriptionQueueState> => {
    try {
      return getQueueState()
    } catch (error) {
      console.error('transcription:queueState error:', error)
      return { paused: false, isProcessing: false, processingId: null, pendingCount: 0, processingCount: 0 }
    }
  })
}
