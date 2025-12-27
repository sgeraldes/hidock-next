import { ipcMain } from 'electron'
import {
  getMeetings,
  getMeetingById,
  getMeetingsByIds,
  getRecordings,
  getRecordingById,
  getRecordingsForMeeting,
  getTranscriptByRecordingId,
  getTranscriptsByRecordingIds,
  searchTranscripts,
  getChatHistory,
  addChatMessage,
  clearChatHistory,
  linkRecordingToMeeting,
  updateRecordingStatus,
  getQueueItems,
  isFileSynced,
  getSyncedFile,
  getAllSyncedFiles,
  addSyncedFile,
  removeSyncedFile,
  getSyncedFilenames,
  Meeting,
  Recording,
  Transcript,
  SyncedFile
} from '../services/database'

export function registerDatabaseHandlers(): void {
  // Meetings
  ipcMain.handle('db:get-meetings', async (_, startDate?: string, endDate?: string) => {
    return getMeetings(startDate, endDate)
  })

  ipcMain.handle('db:get-meeting', async (_, id: string) => {
    return getMeetingById(id)
  })

  ipcMain.handle('db:get-meetings-by-ids', async (_, ids: string[]) => {
    const meetingsMap = getMeetingsByIds(ids)
    // Convert Map to object for IPC serialization
    return Object.fromEntries(meetingsMap)
  })

  // Recordings
  ipcMain.handle('db:get-recordings', async () => {
    return getRecordings()
  })

  ipcMain.handle('db:get-recording', async (_, id: string) => {
    return getRecordingById(id)
  })

  ipcMain.handle('db:get-recordings-for-meeting', async (_, meetingId: string) => {
    return getRecordingsForMeeting(meetingId)
  })

  ipcMain.handle('db:update-recording-status', async (_, id: string, status: string) => {
    updateRecordingStatus(id, status)
    return getRecordingById(id)
  })

  ipcMain.handle(
    'db:link-recording-to-meeting',
    async (_, recordingId: string, meetingId: string, confidence: number, method: string) => {
      linkRecordingToMeeting(recordingId, meetingId, confidence, method)
      return getRecordingById(recordingId)
    }
  )

  // Transcripts
  ipcMain.handle('db:get-transcript', async (_, recordingId: string) => {
    return getTranscriptByRecordingId(recordingId)
  })

  ipcMain.handle('db:search-transcripts', async (_, query: string) => {
    return searchTranscripts(query)
  })

  ipcMain.handle('db:get-transcripts-by-recording-ids', async (_, recordingIds: string[]) => {
    const transcriptsMap = getTranscriptsByRecordingIds(recordingIds)
    // Convert Map to object for IPC serialization
    return Object.fromEntries(transcriptsMap)
  })

  // Queue
  ipcMain.handle('db:get-queue', async (_, status?: string) => {
    return getQueueItems(status)
  })

  // Chat
  ipcMain.handle('db:get-chat-history', async (_, limit?: number) => {
    return getChatHistory(limit)
  })

  ipcMain.handle('db:add-chat-message', async (_, role: 'user' | 'assistant', content: string, sources?: string) => {
    const id = addChatMessage(role, content, sources)
    return { id, role, content, sources }
  })

  ipcMain.handle('db:clear-chat-history', async () => {
    clearChatHistory()
    return true
  })

  // Get meeting with its recordings and transcripts
  ipcMain.handle('db:get-meeting-details', async (_, meetingId: string) => {
    const meeting = getMeetingById(meetingId)
    if (!meeting) return null

    const recordings = getRecordingsForMeeting(meetingId)
    const recordingsWithTranscripts = recordings.map((recording) => ({
      ...recording,
      transcript: getTranscriptByRecordingId(recording.id)
    }))

    return {
      meeting,
      recordings: recordingsWithTranscripts
    }
  })

  // Synced files - tracking which device files have been downloaded
  ipcMain.handle('db:is-file-synced', async (_, originalFilename: string) => {
    return isFileSynced(originalFilename)
  })

  ipcMain.handle('db:get-synced-file', async (_, originalFilename: string) => {
    return getSyncedFile(originalFilename)
  })

  ipcMain.handle('db:get-all-synced-files', async () => {
    return getAllSyncedFiles()
  })

  ipcMain.handle('db:add-synced-file', async (_, originalFilename: string, localFilename: string, filePath: string, fileSize?: number) => {
    return addSyncedFile(originalFilename, localFilename, filePath, fileSize)
  })

  ipcMain.handle('db:remove-synced-file', async (_, originalFilename: string) => {
    removeSyncedFile(originalFilename)
    return true
  })

  ipcMain.handle('db:get-synced-filenames', async () => {
    const set = getSyncedFilenames()
    return Array.from(set)
  })
}
