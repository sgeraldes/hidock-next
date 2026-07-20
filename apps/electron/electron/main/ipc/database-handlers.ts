import { ipcMain } from 'electron'
import {
  getMeetings,
  getMeetingsByIds,
  getMeetingById,
  getRecordings,
  getRecordingById,
  getRecordingsForMeeting,
  getTranscriptByRecordingId,
  getTranscriptsByRecordingIds,
  searchTranscripts,
  getQueueItems,
  getChatHistory,
  addChatMessage,
  clearChatHistory,
  isFileSynced,
  getSyncedFile,
  getAllSyncedFiles,
  addSyncedFile,
  removeSyncedFile,
  getSyncedFilenames,
  updateRecordingStatus,
  updateRecordingTranscriptionStatus,
  linkRecordingToMeeting
} from '../services/database'
import { getRecurringTopics } from '../services/recurring-topics'
import { filterEligibleRecordingIds, existingRecordings } from '../services/recording-eligibility'
import { revalidateStoredSources, REDACTED_ANSWER } from '../services/chat-source-provenance'

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

  // ADV25-4 (round-26) — db:get-recording is a NON-OWNER point read. Its sole
  // preload consumer (`recordings.getById`) is ActionableDetail, which resolves an
  // actionable's source recording on expand: the actionable list is eligibility-
  // gated, but eligibility can change between listing and expand (the recording is
  // trashed / marked personal / value-excluded / hard-purged), so an earlier-gated
  // id is NOT sufficient for end-to-end fail-closed. Gate the point read through
  // the shared positive allowlist: null on ineligible OR on any eligibility-lookup
  // failure. ActionableDetail already handles null (renders a neutral "none"
  // state). No owner-only variant is needed — no owner-management surface calls
  // recordings.getById (Library/Trash/SourceReader use their own accessors).
  ipcMain.handle('db:get-recording', async (_, id: string) => {
    const { eligible, failClosed } = filterEligibleRecordingIds([id])
    if (failClosed || !eligible.has(id)) return null
    return getRecordingById(id)
  })

  // ADV24-3 (round-25) — db:get-recordings-for-meeting is a NON-OWNER accessor.
  // preload `recordings.getForMeeting` is called ONLY from non-owner surfaces:
  // Today (Today.tsx), the meeting-recording-intelligence hover card
  // (recorded/transcribed/wordCount), and the RecordingLinkDialog — none is an
  // owner-management reader (Library/Trash/SourceReader/MeetingDetail use their
  // own accessors). Returning raw linked recordings exposed an excluded
  // recording's existence + linked/recorded/transcribed STATE outside the
  // sanctioned owner reader. Gate the shared IPC through the fail-closed positive
  // allowlist so ineligible (personal/soft-deleted/value-excluded/hard-purged)
  // recordings are omitted; fail-closed → no recordings. No owner-only variant is
  // needed because every caller is non-owner.
  ipcMain.handle('db:get-recordings-for-meeting', async (_, meetingId: string) => {
    const recordings = getRecordingsForMeeting(meetingId)
    if (recordings.length === 0) return recordings
    const { eligible, failClosed } = filterEligibleRecordingIds(recordings.map((r) => r.id))
    if (failClosed) return []
    return recordings.filter((r) => eligible.has(r.id))
  })

  ipcMain.handle('db:update-recording-status', async (_, id: string, status: string) => {
    // Transcription-related statuses go to transcription_status column
    // Standard enum: 'none' | 'pending' | 'processing' | 'complete' | 'error'
    // Also accept legacy values for backward compatibility: 'queued', 'transcribing', 'transcribed', 'failed'
    const transcriptionStatuses = ['none', 'pending', 'processing', 'complete', 'error', 'queued', 'transcribing', 'transcribed', 'failed']
    if (transcriptionStatuses.includes(status)) {
      updateRecordingTranscriptionStatus(id, status)
    } else {
      updateRecordingStatus(id, status)
    }
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
  //
  // ADV13 (round-13) — TWO ELIGIBILITY TIERS on the transcript READ side.
  // The three DEFAULT IPCs below are the ASSISTANT / DISPLAY-safe accessors:
  // they resolve the recording id(s) through the shared FAIL-CLOSED positive
  // allowlist (recording exists AND non-personal/non-deleted/non-value-excluded)
  // so a soft-deleted / personal / value-excluded / hard-purged recording's
  // transcript can NOT be fetched by id, batched, or discovered via full-text
  // search — closing the DISPLAY-tier read bypass. The NARROW owner-management
  // accessors further down (db:get-transcript-owner / *-owner batch) are the
  // sanctioned exemption that lets the OWNER view their OWN trashed/excluded
  // content in management UI (Library / SourceReader detail).
  ipcMain.handle('db:get-transcript', async (_, recordingId: string) => {
    // ADV13: fail closed — null when ineligible or on any eligibility-lookup failure.
    const { eligible, failClosed } = filterEligibleRecordingIds([recordingId])
    if (failClosed || !eligible.has(recordingId)) return null
    return getTranscriptByRecordingId(recordingId) ?? null
  })

  ipcMain.handle('db:search-transcripts', async (_, query: string) => {
    // ADV13: full-text discovery must not surface excluded transcripts. searchTranscripts
    // applies NO SQL LIMIT (returns every match), so filtering the rows here happens
    // BEFORE any truncation — eligible matches are never dropped behind excluded ones.
    const rows = searchTranscripts(query)
    if (rows.length === 0) return []
    const { eligible, failClosed } = filterEligibleRecordingIds(rows.map((r) => r.recording_id))
    if (failClosed) return []
    return rows.filter((r) => eligible.has(r.recording_id))
  })

  ipcMain.handle('db:get-recurring-topics', async () => {
    return getRecurringTopics()
  })

  ipcMain.handle('db:get-transcripts-by-recording-ids', async (_, recordingIds: string[]) => {
    // ADV13: filter the input ids through the positive allowlist BEFORE fetching so
    // ineligible ids are omitted from the returned map; fail closed → empty map.
    const ids = recordingIds ?? []
    const { eligible, failClosed } = filterEligibleRecordingIds(ids)
    if (failClosed) return {}
    const eligibleIds = ids.filter((id) => eligible.has(id))
    if (eligibleIds.length === 0) return {}
    const transcriptsMap = getTranscriptsByRecordingIds(eligibleIds)
    // Convert Map to object for IPC serialization
    return Object.fromEntries(transcriptsMap)
  })

  // ADV13 (round-13) TIER-2 — NARROW OWNER-MANAGEMENT transcript accessors.
  // Scope = the recording ROW EXISTS (via getExistingRecordingIds): a
  // soft-deleted / personal / value-excluded recording is EXISTING, so the owner
  // can still view/manage their OWN excluded content before purge — but a
  // HARD-PURGED / nonexistent id resolves to null / is omitted. These read the
  // AUTHORITATIVE transcript by recording id (no renderer-supplied content).
  // F17's promise is about AI processing + honest-deletion semantics, NOT
  // preventing the owner from reading their own trashed item. ONLY the exempt
  // owner viewers (Library batch, SourceReader detail) may call these; assistant /
  // discovery callers stay on the gated default IPCs above.
  ipcMain.handle('db:get-transcript-owner', async (_, recordingId: string) => {
    const { ids, failClosed } = existingRecordings([recordingId])
    if (failClosed || !ids.has(recordingId)) return null
    return getTranscriptByRecordingId(recordingId) ?? null
  })

  ipcMain.handle('db:get-transcripts-by-recording-ids-owner', async (_, recordingIds: string[]) => {
    const ids = recordingIds ?? []
    const { ids: existing, failClosed } = existingRecordings(ids)
    if (failClosed) return {}
    const existingIds = ids.filter((id) => existing.has(id))
    if (existingIds.length === 0) return {}
    const transcriptsMap = getTranscriptsByRecordingIds(existingIds)
    return Object.fromEntries(transcriptsMap)
  })

  // Queue
  ipcMain.handle('db:get-queue', async (_, status?: string) => {
    return getQueueItems(status)
  })

  // Chat
  ipcMain.handle('db:get-chat-history', async (_, limit?: number) => {
    // ADV17-2 (round-18) — the legacy chat history reads the SAME chat_messages
    // table as assistant:getMessages and returns each message's persisted
    // `sources` (transcript excerpts). Revalidate every message's normalized
    // provenance through the shared fail-closed boundary before returning: drop
    // now-excluded snippets and redact an answer grounded solely on excluded
    // sources. (Same treatment as assistant:getMessages so the two readers of
    // this table can never diverge.)
    return getChatHistory(limit).map((row) => {
      const { sources, redactContent } = revalidateStoredSources(row.sources, (row as { role?: string }).role ?? '')
      return { ...row, sources, ...(redactContent ? { content: REDACTED_ANSWER } : {}) }
    })
  })

  ipcMain.handle('db:add-chat-message', async (_, role: unknown, content: string, sources?: string) => {
    // ADV22-2 (round-23) — USER-ONLY. Assistant messages may be created ONLY through
    // the main-owned assistant:addMessage(generationId) path (main owns the generated
    // content + authoritative provenance and is the SOLE sanitized release path). This
    // legacy write door must NOT be a second assistant-write surface: REJECT any role
    // other than the exact string 'user' — no 'assistant', no normalization, no
    // smuggled/legacy roles ('system'/'Assistant'/' assistant '/''/null/non-string).
    // Rejection = no insert.
    if (role !== 'user') {
      const error = new Error(
        `db:add-chat-message is user-only; rejected role: ${typeof role === 'string' ? JSON.stringify(role) : typeof role}`
      )
      console.error(error.message)
      throw error
    }
    // User rows keep their raw sources verbatim (no provenance envelope).
    const packed = sources ?? null
    const id = addChatMessage('user', content, packed ?? undefined)
    // Route the returned row through the shared read-time sanitizer for consistency
    // with every other write door. For user text this is a no-op (always preserved).
    const { sources: sanitized, redactContent } = revalidateStoredSources(packed, 'user')
    return { id, role: 'user', content: redactContent ? REDACTED_ANSWER : content, sources: sanitized }
  })

  ipcMain.handle('db:clear-chat-history', async () => {
    clearChatHistory()
    return true
  })

  // Get meeting with its recordings and transcripts
  ipcMain.handle('db:get-meeting-details', async (_, meetingId: string) => {
    const meeting = getMeetingById(meetingId)
    if (!meeting) return null

    // Self-heal: recordings and meetings arrive independently (device download
    // vs ICS sync), so run the time-overlap auto-linker before reading links.
    // Lazy import: org-reconciler is only needed for this one self-heal path,
    // not eagerly for every db:get-meeting-details call (execution deferral,
    // not chunk splitting — the main process bundles to a single file).
    try {
      const { autoLinkRecordingsToMeetings } = await import('../services/org-reconciler')
      autoLinkRecordingsToMeetings()
    } catch (e) {
      console.error('db:get-meeting-details auto-link failed:', e)
    }

    // ADV15-1 (round-16) — MeetingDetail is a meeting-AGGREGATION DISPLAY surface,
    // NOT the single-recording owner reader (SourceReader). So it GATES: run every
    // linked recording id through the shared FAIL-CLOSED positive allowlist and
    // omit any ineligible recording (personal/soft-deleted/value-excluded/hard-
    // purged) — and therefore its transcript/summary/action-items — from the
    // returned linked-recordings entirely. The owner still views an excluded
    // recording via SourceReader's existence-scoped owner accessor
    // (db:get-transcript-owner). Fail-closed → no linked recordings.
    const recordings = getRecordingsForMeeting(meetingId)
    const { eligible, failClosed } = filterEligibleRecordingIds(recordings.map((r) => r.id))
    const recordingsWithTranscripts = failClosed
      ? []
      : recordings
          .filter((recording) => eligible.has(recording.id))
          .map((recording) => ({
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
