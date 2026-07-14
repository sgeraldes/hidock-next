/**
 * Meeting-timeline IPC handlers.
 *
 *   - recordings:getTimelineAnalysis(recordingId)
 *       → { sentimentSegments, eventMarkers } from the persisted transcript row
 *         (empty arrays if the recording hasn't been analyzed yet). Read-only.
 *
 *   - recordings:analyzeTimeline(recordingId)
 *       → runs the sentiment + event-marker derivation for that ONE recording,
 *         persists both onto the transcript, and returns the same shape.
 *         Idempotent (recomputes + overwrites). Pushes `recordings:timelineProgress`
 *         events to the calling window while it works (Gemini scoring is slow).
 *
 * The data itself is produced by services/timeline-analysis.ts; a sibling
 * renderer consumes this contract to draw the rich waveform timeline.
 */

import { ipcMain } from 'electron'
import {
  getTimelineAnalysis,
  analyzeTimeline,
  type TimelineAnalysis
} from '../services/timeline-analysis'

const EMPTY: TimelineAnalysis = { sentimentSegments: [], eventMarkers: [] }

/** Accept a bare id string or a { recordingId } payload. */
function extractRecordingId(payload: unknown): string | undefined {
  if (typeof payload === 'string') return payload
  if (payload && typeof payload === 'object' && 'recordingId' in payload) {
    const id = (payload as { recordingId?: unknown }).recordingId
    return typeof id === 'string' ? id : undefined
  }
  return undefined
}

export function registerTimelineHandlers(): void {
  ipcMain.handle('recordings:getTimelineAnalysis', async (_, payload: unknown): Promise<TimelineAnalysis> => {
    try {
      const recordingId = extractRecordingId(payload)
      if (!recordingId || recordingId.trim().length === 0) return { ...EMPTY }
      return getTimelineAnalysis(recordingId)
    } catch (error) {
      console.error('recordings:getTimelineAnalysis error:', error)
      return { ...EMPTY }
    }
  })

  ipcMain.handle('recordings:analyzeTimeline', async (event, payload: unknown): Promise<TimelineAnalysis> => {
    try {
      const recordingId = extractRecordingId(payload)
      if (!recordingId || recordingId.trim().length === 0) return { ...EMPTY }
      return await analyzeTimeline(recordingId, (p) => {
        try {
          event.sender.send('recordings:timelineProgress', { recordingId, ...p })
        } catch {
          /* window may be gone — progress is best-effort */
        }
      })
    } catch (error) {
      console.error('recordings:analyzeTimeline error:', error)
      return { ...EMPTY }
    }
  })
}
