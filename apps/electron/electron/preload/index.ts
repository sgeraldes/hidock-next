import { contextBridge, ipcRenderer } from 'electron'
import type {
  ConnectorSummary,
  ConnectorStatus,
  ExternalPerson,
  IngestionOutcome,
  SourceContainer,
} from '@hidock/connectors'

/**
 * B-SET-004 / QAM-002: QA logging check via localStorage bridge.
 * Preload scripts run in context isolation, so they cannot access Zustand stores directly.
 * Instead, read from the persisted localStorage key that the UI store writes to.
 * Defined early so callIPC can use it for QA-MONITOR gating.
 */
let _qaLogsCache = false
let _qaLogsCacheTime = 0
const QA_CACHE_TTL = 5000

function isQaLogsEnabled(): boolean {
  const now = Date.now()
  if (now - _qaLogsCacheTime < QA_CACHE_TTL) return _qaLogsCache
  try {
    const stored = localStorage.getItem('hidock-ui-store')
    if (stored) {
      const { state } = JSON.parse(stored)
      _qaLogsCache = state?.qaLogsEnabled ?? false
    } else {
      _qaLogsCache = false
    }
  } catch {
    _qaLogsCache = false
  }
  _qaLogsCacheTime = now
  return _qaLogsCache
}

// --- IPC Logging Wrapper ---
const callIPC = async (channel: string, ...args: any[]) => {
  const isPolling = ['recordings:getTranscriptionStatus', 'db:get-recordings', 'knowledge:getAll'].includes(channel);

  try {
    const start = performance.now();
    const result = await ipcRenderer.invoke(channel, ...args);
    const duration = (performance.now() - start).toFixed(1);

    if (!isPolling && isQaLogsEnabled()) {
        console.log(`[QA-MONITOR][IPC] ${channel} (${duration}ms)`);
    }
    return result;
  } catch (error) {
    if (!isPolling && isQaLogsEnabled()) {
        console.error('[QA-MONITOR][IPC-ERR]', channel, error);
    }
    throw error;
  }
}

// Import types from api.ts for proper typing
import type {
  Result,
  RAGChatRequest,
  RAGChatResponse,
  RAGStatus,
  GetContactsRequest,
  GetContactsResponse,
  CreateContactRequest,
  UpdateContactRequest,
  GetProjectsRequest,
  GetProjectsResponse,
  CreateProjectRequest,
  UpdateProjectRequest,
  TagMeetingRequest,
  OutputTemplate,
  GenerateOutputRequest,
  GenerateOutputResponse,
  ArtifactsAPI
} from '../main/types/api'
import type { Contact, ContactWithMeetings, Project, ProjectWithMeetings } from '../main/types/database'
import type { MigrationAPI } from './migration-types'
import type {
  KnowledgeCapture,
  Actionable,
  Conversation,
  Message,
  Person
} from '../../src/types/knowledge'
import type { PipelineState } from '../main/types/device-pipeline'

/** A Context Graph node with its degree + click-through ids (mirrors the service DTO). */
interface ContextGraphNode {
  id: string
  type: string
  label: string
  degree: number
  contactId?: string
  meetingId?: string
  projectId?: string
}

/** A Context Graph payload: nodes + edges (+ the focused center, if any). */
interface ContextGraphData {
  center: string | null
  nodes: ContextGraphNode[]
  edges: Array<{ id: string; source: string; target: string; type: string; weight: number }>
}

/** A lens node: a graph node annotated with its stratum band + effective date. */
interface ContextLensNode extends ContextGraphNode {
  stratum: 'strategic' | 'operational' | 'people' | 'evidence'
  dateMs: number | null
}

/** Per-stratum totals-in-scope vs. shown after the lens node budget. */
interface ContextLensStratumCount {
  stratum: 'strategic' | 'operational' | 'people' | 'evidence'
  total: number
  shown: number
}

/** A stratified, time-aware lens payload. */
interface ContextLensData {
  center: string | null
  nodes: ContextLensNode[]
  edges: Array<{ id: string; source: string; target: string; type: string; weight: number }>
  referenceMs: number | null
  strata: ContextLensStratumCount[]
}

/** A one-line entity descriptor (lens center / provenance node). */
interface LensCenter {
  id: string
  type: string
  label: string
  contactId?: string
  meetingId?: string
  projectId?: string
}

type ProvenanceEntityDTO = LensCenter & { dateMs: number | null }

/** The evidence path + narrative behind a decision / risk / action. */
interface ProvenanceDTO {
  node: ProvenanceEntityDTO | null
  meetings: ProvenanceEntityDTO[]
  people: ProvenanceEntityDTO[]
  projects: ProvenanceEntityDTO[]
  actions: ProvenanceEntityDTO[]
  pathIds: string[]
  narrative: string
  dateMs: number | null
}

/** Rich detail for the node inspector — identity, contact facts, graph stats. */
interface NodeDetailDTO {
  node: LensCenter | null
  linked: boolean
  contactId: string | null
  pronouns: string | null
  role: string | null
  company: string | null
  email: string | null
  meetingCount: number
  firstSeenMs: number | null
  lastSeenMs: number | null
  peopleCount: number
  projectCount: number
  degree: number
  aliases: string[]
  narrative: string
}

/** Blast-radius preview for a two-node merge. */
interface MergePreviewDTO {
  a: { id: string; label: string; type: string; edges: number } | null
  b: { id: string; label: string; type: string; edges: number } | null
  shared: number
  resulting: number
  contactMerge: boolean
  contactImpact?: { keeper: number; loser: number }
}

/** Project issue / risk / note (v29). */
interface ProjectNote {
  id: string
  project_id: string
  kind: 'issue' | 'risk' | 'note'
  content: string
  status: 'open' | 'resolved'
  created_at: string
  resolved_at: string | null
}

/** Actionable linked to a project (v29). */
interface ProjectActionable {
  id: string
  type: string
  title: string
  description: string | null
  sourceKnowledgeId: string
  status: string
  confidence: number | null
  createdAt: string
}

/** A keeper link that appeared after a merge — surfaced by unmerge for manual review (v30). */
interface OrphanLink {
  table: 'meeting_contacts' | 'transcript_speakers' | 'meeting_projects' | 'knowledge_projects'
  key: string
  label: string
  date: string | null
}

/** Result of an unmerge: restore counts + links the user must reassign by hand (v30). */
interface UnmergeResult {
  loserId: string
  loserName: string
  restored: {
    meetingLinks: number
    speakerLinks: number
    knowledgeLinks: number
    aliases: number
    fieldsRestored: number
    skipped: number
  }
  orphanedSinceMerge: OrphanLink[]
}

/** One merge-journal entry surfaced in an entity's "Merge history" (v30). */
interface MergeJournalEntry {
  id: string
  kind: 'contact' | 'project'
  keeperId: string
  loserId: string
  loserName: string
  createdAt: string
  undoneAt: string | null
  linkCount: number
}

/** Snapshot of the main-process transcription queue processor (dock reflects this). */
export interface TranscriptionQueueState {
  paused: boolean
  isProcessing: boolean
  processingId: string | null
  pendingCount: number
  processingCount: number
}

// Type definitions for the API
export interface ElectronAPI {
  // App
  app: {
    restart: () => Promise<void>
    info: () => Promise<{
      version: string
      name: string
      isPackaged: boolean
      platform: string
    }>
  }

  // Config
  config: {
    get: () => Promise<any>
    set: (config: any) => Promise<any>
    updateSection: (section: string, values: any) => Promise<any>
    getValue: (key: string) => Promise<any>
  }

  // Database - Meetings
  meetings: {
    getAll: (startDate?: string, endDate?: string) => Promise<any[]>
    getById: (id: string) => Promise<any>
    getByIds: (ids: string[]) => Promise<Record<string, any>>
    getDetails: (id: string) => Promise<any>
    update: (request: { id: string; subject?: string; start_time?: string; end_time?: string; location?: string | null; description?: string | null; organizer_name?: string | null; organizer_email?: string | null }) => Promise<Result<any>>
    addAttendee: (request: { meetingId: string; name?: string; email?: string }) => Promise<Result<Contact>>
    removeAttendee: (request: { meetingId: string; contactId: string }) => Promise<Result<void>>
  }

  // Contacts
  contacts: {
    getAll: (request?: GetContactsRequest) => Promise<Result<GetContactsResponse>>
    getById: (id: string) => Promise<Result<ContactWithMeetings>>
    create: (request: CreateContactRequest) => Promise<Result<Person>>
    update: (request: UpdateContactRequest) => Promise<Result<Contact>>
    delete: (id: string) => Promise<Result<void>>
    merge: (request: { keeperId: string; loserId: string }) => Promise<Result<Person>>
    unmerge: (journalId: string) => Promise<Result<UnmergeResult>>
    getForMeeting: (meetingId: string) => Promise<Result<Contact[]>>
  }

  // Projects
  projects: {
    getAll: (request?: GetProjectsRequest & { status?: string }) => Promise<Result<GetProjectsResponse>>
    getById: (id: string) => Promise<Result<ProjectWithMeetings>>
    create: (request: CreateProjectRequest) => Promise<Result<Project>>
    update: (request: UpdateProjectRequest) => Promise<Result<Project>>
    delete: (id: string) => Promise<Result<void>>
    tagMeeting: (request: TagMeetingRequest) => Promise<Result<void>>
    untagMeeting: (request: TagMeetingRequest) => Promise<Result<void>>
    getForMeeting: (meetingId: string) => Promise<Result<Project[]>>
    merge: (request: { keeperId: string; loserId: string }) => Promise<Result<Project>>
    unmerge: (journalId: string) => Promise<Result<UnmergeResult>>
    getForKnowledge: (knowledgeCaptureId: string) => Promise<Result<Project[]>>
    getNotes: (request: { projectId: string; kind?: 'issue' | 'risk' | 'note' }) => Promise<Result<ProjectNote[]>>
    addNote: (request: { projectId: string; kind: 'issue' | 'risk' | 'note'; content: string }) => Promise<Result<ProjectNote>>
    updateNote: (request: { id: string; content?: string; status?: 'open' | 'resolved' }) => Promise<Result<ProjectNote>>
    deleteNote: (request: { id: string }) => Promise<Result<void>>
    getActionables: (projectId: string) => Promise<Result<ProjectActionable[]>>
    openFolder: (projectId: string) => Promise<Result<void>>
  }

  // Database - Recordings
  recordings: {
    getAll: () => Promise<any[]>
    getById: (id: string) => Promise<any>
    getForMeeting: (meetingId: string) => Promise<any[]>
    updateStatus: (id: string, status: string) => Promise<any>
    updateRecordingStatus: (id: string, status: string) => Promise<{ success: boolean; data?: any; error?: string }>
    updateTranscriptionStatus: (id: string, status: string) => Promise<{ success: boolean; data?: any; error?: string }>
    updateDuration: (id: string, durationSeconds: number) => Promise<{ success: boolean; error?: string }>
    backfillDurations: () => Promise<{ success: boolean; scanned?: number; updated?: number; markedLowValue?: number; error?: string }>
    linkToMeeting: (recordingId: string, meetingId: string, confidence: number, method: string) => Promise<any>
    delete: (id: string) => Promise<boolean>
    deleteBatch: (ids: string[]) => Promise<{
      success: boolean
      deleted: number
      failed: number
      errors: Array<{ id: string; error: string }>
    }>
    // Privacy source-deletion (v38)
    markPersonal: (id: string, personal: boolean) => Promise<{ success: boolean; personal?: boolean; error?: string }>
    deletionImpact: (id: string) => Promise<{
      success: boolean
      data?: {
        recordingId: string
        filename: string
        transcripts: number
        actionItems: number
        embeddings: number
        captures: number
        artifacts: number
        meetingLinks: number
        hasAudioFile: boolean
      }
      error?: string
    }>
    deleteCascade: (id: string, hard: boolean) => Promise<{
      success: boolean
      mode?: 'soft' | 'hard'
      removed?: {
        transcripts: number
        embeddings: number
        captures: number
        actionItems: number
        artifacts: number
        speakerBindings: number
        candidates: number
        meetingLinksRemoved: number
      }
      filesRemoved?: { audio: boolean; wikiPages: number; artifactBlobs: number }
      error?: string
    }>
    restore: (id: string) => Promise<{ success: boolean }>
    // Recording-Meeting linking dialog methods
    getCandidates: (recordingId: string) => Promise<{ success: boolean; data: any[]; error?: string }>
    getMeetingsNearDate: (date: string) => Promise<{ success: boolean; data: any[]; error?: string }>
    selectMeeting: (recordingId: string, meetingId: string | null) => Promise<{ success: boolean; error?: string }>
    // Live-recording pre-assignment (attribution set IN ADVANCE, keyed by device filename)
    preassign: (filename: string, meetingId: string | null) => Promise<{ success: boolean; error?: string }>
    getPreassignment: (filename: string) => Promise<{ success: boolean; data: { filename: string; meeting_id: string | null; created_at?: string } | null; error?: string }>
    clearPreassignment: (filename: string) => Promise<{ success: boolean; error?: string }>
    // External file import
    addExternal: () => Promise<{ success: boolean; recording?: any; error?: string }>
    addExternalByPath: (filePath: string) => Promise<{ success: boolean; recording?: any; error?: string }>
    // Transcription
    transcribe: (recordingId: string) => Promise<void>
    addToQueue: (recordingId: string, priority?: boolean) => Promise<string | false>
    reprocessWith: (recordingId: string, provider: 'gemini' | 'local-asr' | 'vibevoice') => Promise<{ success: boolean; queueItemId?: string; error?: string }>
    processQueue: () => Promise<boolean>
    getTranscriptionStatus: () => Promise<{ isProcessing: boolean; pendingCount: number; processingCount: number }>
    getTranscriptionQueue: () => Promise<any[]>
    cancelTranscription: (recordingId: string) => Promise<{ success: boolean }>
    cancelAllTranscriptions: () => Promise<{ success: boolean; count: number }>
    updateQueueItem: (id: string, status: string, errorMessage?: string) => Promise<boolean>
    // Queue-level control (main-process queue processor). Pause stops dequeuing
    // new items (an in-flight item finishes); reorder applies a prioritize (up) /
    // deprioritize (down) intent. All return the fresh queue state.
    pauseTranscriptionQueue: () => Promise<TranscriptionQueueState>
    resumeTranscriptionQueue: () => Promise<TranscriptionQueueState>
    reorderTranscription: (recordingId: string, direction: 'up' | 'down') => Promise<TranscriptionQueueState>
    getTranscriptionQueueState: () => Promise<TranscriptionQueueState>
  }

  // Database - Transcripts
  transcripts: {
    getByRecordingId: (recordingId: string) => Promise<any>
    getByRecordingIds: (recordingIds: string[]) => Promise<Record<string, any>>
    search: (query: string) => Promise<any[]>
    assignSpeaker: (request: { recordingId: string; speakerLabel: string; contactId?: string; newName?: string }) => Promise<Result<Contact>>
    getSpeakerMap: (request: { recordingId: string }) => Promise<Result<Array<{ speaker_label: string; contact_id: string; name: string }>>>
    unassignSpeaker: (request: { recordingId: string; speakerLabel: string }) => Promise<Result<void>>
  }

  // Old-transcript triage + text reformat (Library "Upgrade Transcripts")
  transcriptUpgrade: {
    scan: (req?: { threshold?: number }) => Promise<Result<any>>
    run: (req?: { threshold?: number }) => Promise<Result<any>>
    getStatus: (req?: { threshold?: number }) => Promise<Result<any>>
    getRecommended: () => Promise<Result<string[]>>
  }

  // Speaker self-identification (bind "Speaker N" to a self-stated name)
  selfId: {
    scan: () => Promise<Result<any>>
    runForRecording: (request: { recordingId: string; force?: boolean }) => Promise<Result<any>>
    backfill: () => Promise<Result<any>>
    getStatus: () => Promise<Result<any>>
    getMergeSuspected: () => Promise<Result<Array<{ label: string; names: string[] }>>>
  }

  // Per-turn speaker overrides + speaker splits (v37): fix a single turn, or
  // fork a merged diarization label into an independently-assignable half.
  turnSpeakers: {
    getOverrides: (request: { recordingId: string }) => Promise<Result<Array<{ turn_index: number; contact_id: string; name: string }>>>
    setOverride: (request: { recordingId: string; turnIndex: number; contactId?: string; newName?: string }) => Promise<Result<Contact>>
    clearOverride: (request: { recordingId: string; turnIndex: number }) => Promise<Result<void>>
    getSplits: (request: { recordingId: string }) => Promise<Result<Array<{ base_label: string; from_turn_index: number; derived_label: string }>>>
    split: (request: { recordingId: string; baseLabel: string; fromTurnIndex: number }) => Promise<Result<{ derivedLabel: string }>>
    mergeSplit: (request: { recordingId: string; baseLabel: string; fromTurnIndex: number }) => Promise<Result<void>>
    assignFromHere: (request: { recordingId: string; baseLabel: string; fromTurnIndex: number; contactId?: string; newName?: string }) => Promise<Result<{ derivedLabel: string; contact: Contact }>>
    getMergeHints: (request: { recordingId: string }) => Promise<Result<Array<{ label: string; names: string[] }>>>
  }

  // Today briefing (single round-trip payload for the Today page)
  briefing: {
    get: () => Promise<{ success: boolean; data?: any; error?: string }>
  }

  // Database - Queue
  queue: {
    getItems: (status?: string) => Promise<any[]>
  }

  // Knowledge Captures
  knowledge: {
    getAll: (options?: { limit?: number; offset?: number; status?: string }) => Promise<KnowledgeCapture[]>
    getById: (id: string) => Promise<KnowledgeCapture | null>
    getByIds: (ids: string[]) => Promise<KnowledgeCapture[]> // B-CHAT-004
    update: (id: string, updates: Partial<KnowledgeCapture>) => Promise<{ success: boolean; error?: string }>
    setProjects: (request: { knowledgeCaptureId: string; projectIds: string[] }) => Promise<Result<void>>
  }

  // Action items (first-class action_items table)
  actionItems: {
    setAssignee: (request: { actionItemId: string; contactId: string | null }) => Promise<Result<any>>
  }

  // Actionables
  actionables: {
    getAll: (options?: { status?: string }) => Promise<Actionable[]>
    getByMeeting: (meetingId: string) => Promise<Actionable[]>
    updateStatus: (id: string, status: string) => Promise<{ success: boolean; error?: string }>
    generateOutput: (actionableId: string) => Promise<{ success: boolean; error?: string; data?: any }>
  }

  // Assistant
  assistant: {
    getConversations: () => Promise<Conversation[]>
    createConversation: (title?: string) => Promise<Conversation>
    deleteConversation: (id: string) => Promise<{ success: boolean; error?: string }>
    getMessages: (conversationId: string) => Promise<Message[]>
    addMessage: (conversationId: string, role: 'user' | 'assistant', content: string, sources?: string) => Promise<Message>
    updateConversationTitle: (conversationId: string, title: string) => Promise<{ success: boolean; error?: string }>
    addContext: (conversationId: string, knowledgeCaptureId: string) => Promise<{ success: boolean; error?: string }>
    removeContext: (conversationId: string, knowledgeCaptureId: string) => Promise<{ success: boolean; error?: string }>
    getContext: (conversationId: string) => Promise<string[]>
  }

  // Chat
  chat: {
    getHistory: (limit?: number) => Promise<any[]>
    addMessage: (role: 'user' | 'assistant', content: string, sources?: string) => Promise<any>
    clearHistory: () => Promise<boolean>
  }

  // Calendar
  calendar: {
    sync: () => Promise<any>
    clearAndSync: () => Promise<any>
    getLastSync: () => Promise<string | null>
    setUrl: (url: string) => Promise<any>
    toggleAutoSync: (enabled: boolean) => Promise<any>
    setInterval: (minutes: number) => Promise<any>
    getSettings: () => Promise<any>
  }

  // Storage
  storage: {
    getInfo: () => Promise<any>
    openFolder: (folder: 'recordings' | 'transcripts' | 'data') => Promise<boolean>
    selectFolder?: (currentPath?: string) => Promise<{ success: boolean; data?: string | null; error?: string }>
    openFile: (filePath: string) => Promise<{ success: boolean; error?: string }>
    revealInFolder: (filePath: string) => Promise<{ success: boolean; error?: string }>
    readRecording: (filePath: string) => Promise<{ success: boolean; data?: string; error?: string }>
    deleteRecording: (filePath: string) => Promise<boolean>
    saveRecording: (filename: string, data: number[], recordingDateIso?: string) => Promise<string>
  }

  // Synced files - tracking which device files have been downloaded
  syncedFiles: {
    isFileSynced: (originalFilename: string) => Promise<boolean>
    getSyncedFile: (originalFilename: string) => Promise<{
      id: string
      original_filename: string
      local_filename: string
      file_path: string
      file_size?: number
      synced_at: string
    } | undefined>
    getAll: () => Promise<Array<{
      id: string
      original_filename: string
      local_filename: string
      file_path: string
      file_size?: number
      synced_at: string
    }>>
    add: (originalFilename: string, localFilename: string, filePath: string, fileSize?: number) => Promise<string>
    remove: (originalFilename: string) => Promise<boolean>
    getFilenames: () => Promise<string[]>
  }

  // Outputs - document generation
  outputs: {
    getTemplates: () => Promise<Result<OutputTemplate[]>>
    generate: (request: GenerateOutputRequest) => Promise<Result<GenerateOutputResponse>>
    getByActionableId: (actionableId: string) => Promise<Result<GenerateOutputResponse | null>>
    copyToClipboard: (content: string) => Promise<Result<void>>
    saveToFile: (content: string, suggestedName?: string) => Promise<Result<string>>
    openInFolder: (filePath: string) => Promise<Result<void>>
    launchClaudeCode: (args: {
      filePath?: string
      content?: string
      templateId?: string
      actionableId?: string
      cwd?: string
    }) => Promise<Result<{ launched: boolean; needsFolder?: boolean; cwd?: string }>>
  }

  // RAG Chatbot (extended with Result pattern)
  rag: {
    status: () => Promise<Result<RAGStatus>>
    chat: (request: RAGChatRequest) => Promise<Result<RAGChatResponse>>
    chatLegacy: (sessionId: string, message: string, meetingFilter?: string) => Promise<{
      answer: string
      sources: Array<{
        content: string
        meetingId?: string
        subject?: string
        timestamp?: string
        score: number
      }>
      error?: string
    }>
    summarizeMeeting: (meetingId: string) => Promise<Result<string>>
    findActionItems: (meetingId?: string) => Promise<Result<string>>
    cancel: (sessionId: string) => Promise<Result<boolean>> // B-CHAT-005
    removeLastMessages: (sessionId: string, count: number) => Promise<Result<number>>
    clearSession: (sessionId: string) => Promise<Result<void>>
    stats: () => Promise<{
      documentCount: number
      meetingCount: number
      sessionCount: number
    }>
    indexTranscript: (transcript: string, metadata: {
      meetingId?: string
      recordingId?: string
      timestamp?: string
      subject?: string
    }) => Promise<{ indexed: number }>
    search: (query: string, limit?: number) => Promise<Array<{
      content: string
      meetingId?: string
      subject?: string
      score: number
    }>>
    getChunks: () => Promise<Array<{
      id: string
      content: string
      meetingId?: string
      recordingId?: string
      chunkIndex: number
      subject?: string
      timestamp?: string
      embeddingDimensions: number
    }>>
    globalSearch: (query: string, limit?: number) => Promise<Result<{
      knowledge: any[]
      people: any[]
      projects: any[]
    }>>
  }

  // Download Service - Centralized background download manager
  downloadService: {
    getState: () => Promise<{
      queue: Array<{
        id: string
        filename: string
        fileSize: number
        progress: number
        status: 'pending' | 'downloading' | 'completed' | 'failed' | 'cancelled'
        error?: string
      }>
      session: {
        id: string
        totalFiles: number
        completedFiles: number
        failedFiles: number
        status: 'active' | 'completed' | 'cancelled' | 'failed'
      } | null
      isProcessing: boolean
      isPaused: boolean
    }>
    isFileSynced: (filename: string) => Promise<{ synced: boolean; reason: string }>
    getFilesToSync: (files: Array<{ filename: string; size: number; duration: number; dateCreated: Date }>) => Promise<Array<{ filename: string; size: number; duration: number; dateCreated: Date; skipReason?: string }>>
    queueDownloads: (files: Array<{ filename: string; size: number; dateCreated?: string }>) => Promise<string[]>
    startSession: (files: Array<{ filename: string; size: number; dateCreated?: string }>) => Promise<{
      id: string
      totalFiles: number
      completedFiles: number
      failedFiles: number
      status: 'active' | 'completed' | 'cancelled' | 'failed'
    }>
    processDownload: (filename: string, data: number[] | Uint8Array) => Promise<{ success: boolean; filePath?: string; error?: string }>
    updateProgress: (filename: string, bytesReceived: number) => Promise<void>
    markFailed: (filename: string, error: string) => Promise<void>
    clearCompleted: () => Promise<void>
    cancel: (filename: string) => Promise<{ success: boolean; error?: string }>
    cancelAll: () => Promise<void>
    retryFailed: (deviceConnected?: boolean) => Promise<{ count: number; error?: string }>
    getStats: () => Promise<{ totalSynced: number; pendingInQueue: number; failedInQueue: number }>
    checkStalled: () => Promise<number>
    cancelActive: (reason?: string) => Promise<number>
    notifyCompletion: (stats: { completed: number; failed: number; aborted: boolean }) => Promise<unknown>
    onStateUpdate: (callback: (state: any) => void) => () => void
  }

  // Device Cache - Caches device file listings for offline access
  deviceCache: {
    getAll: () => Promise<any[]>
    saveAll: (files: any[]) => Promise<void>
    clear: () => Promise<void>
  }

  // Quality Assessment API
  quality: {
    get: (recordingId: string) => Promise<any>
    set: (recordingId: string, quality: 'high' | 'medium' | 'low', reason?: string, assessedBy?: string) => Promise<any>
    autoAssess: (recordingId: string) => Promise<any>
    getByQuality: (quality: 'high' | 'medium' | 'low') => Promise<any>
    batchAutoAssess: (recordingIds: string[]) => Promise<any>
    assessUnassessed: () => Promise<any>
  }

  // Storage Policy API
  storagePolicy: {
    getByTier: (tier: 'hot' | 'warm' | 'cold' | 'archive') => Promise<any>
    getCleanupSuggestions: (minAgeOverride?: Partial<Record<'hot' | 'warm' | 'cold' | 'archive', number>>) => Promise<any>
    getCleanupSuggestionsForTier: (tier: 'hot' | 'warm' | 'cold' | 'archive', minAgeDays?: number) => Promise<any>
    executeCleanup: (recordingIds: string[], archive?: boolean) => Promise<any>
    getStats: () => Promise<any>
    initializeUntiered: () => Promise<any>
    assignTier: (recordingId: string, quality: 'high' | 'medium' | 'low') => Promise<any>
  }

  // Data Integrity Service - Health checks and repairs
  integrity: {
    runScan: () => Promise<{
      scanStarted: string
      scanCompleted: string
      totalIssues: number
      issuesByType: Record<string, number>
      issuesBySeverity: Record<string, number>
      issues: Array<{
        id: string
        type: string
        severity: 'low' | 'medium' | 'high'
        description: string
        filePath?: string
        filename?: string
        recordingId?: string
        suggestedAction: string
        autoRepairable: boolean
        details?: Record<string, unknown>
      }>
      autoRepairableCount: number
    }>
    getReport: () => Promise<any>
    repairIssue: (issueId: string) => Promise<{
      issueId: string
      success: boolean
      action: string
      error?: string
    }>
    repairAll: () => Promise<Array<{
      issueId: string
      success: boolean
      action: string
      error?: string
    }>>
    runStartupChecks: () => Promise<{ issuesFound: number; issuesFixed: number }>
    cleanupWronglyNamed: () => Promise<{
      deletedFiles: string[]
      keptFiles: string[]
      clearedDbRecords: number
    }>
    purgeMissingFiles: () => Promise<{
      totalRecords: number
      deleted: number
      kept: number
      deletedFiles: string[]
    }>
    onProgress: (callback: (progress: { message: string; progress: number }) => void) => () => void
  }

  // Artifacts - entity-type foundation (C0): import files as captures
  artifacts: ArtifactsAPI

  // Connectors (Layer 2) — Settings → Connectors UI bridge
  connectors: {
    list: () => Promise<ConnectorSummary[]>
    get: (id: string) => Promise<ConnectorSummary>
    configure: (id: string, values: Record<string, string | number | boolean>) => Promise<ConnectorSummary>
    connect: (id: string, authMode?: 'auth-code' | 'device-code') => Promise<ConnectorSummary>
    disconnect: (id: string) => Promise<ConnectorSummary>
    // Multi-instance: add / remove / rename accounts of a connector type.
    addInstance: (type: string, label?: string) => Promise<ConnectorSummary>
    removeInstance: (id: string) => Promise<ConnectorSummary[]>
    setInstanceLabel: (id: string, label: string) => Promise<ConnectorSummary>
    listContainers: (id: string) => Promise<SourceContainer[]>
    setSourceEnabled: (id: string, containerId: string, enabled: boolean) => Promise<ConnectorSummary>
    sync: (id: string, containerId?: string) => Promise<IngestionOutcome>
    searchPeople: (query: string) => Promise<ExternalPerson[]>
    onStatusChanged: (callback: (payload: { id: string; status: ConnectorStatus }) => void) => () => void
  }

  // Migration - Database schema migration to V11 (Knowledge Captures)
  migration: MigrationAPI


  // Jensen Device API — IPC bridge to main-process JensenDevice singleton
  jensen: {
    // Core
    connect: () => Promise<boolean>
    tryConnect: () => Promise<boolean>
    disconnect: () => Promise<void>
    reset: () => Promise<boolean>
    isConnected: () => Promise<boolean>
    getModel: () => Promise<string | null>
    isP1Device: () => Promise<boolean>
    // Device info & settings
    getDeviceInfo: () => Promise<any>
    getCardInfo: () => Promise<any>
    getFileCount: () => Promise<{ count: number } | null>
    getSettings: () => Promise<any>
    setTime: () => Promise<any>
    setAutoRecord: (enabled: boolean) => Promise<any>
    // File operations
    listFiles: () => Promise<any[] | null>
    downloadFile: (filename: string, fileSize: number) => Promise<boolean | null>
    cancelDownload: () => Promise<void>
    deleteFile: (filename: string) => Promise<any>
    formatCard: () => Promise<any>
    // Realtime
    getRealtimeSettings: () => Promise<any>
    startRealtime: () => Promise<any>
    pauseRealtime: () => Promise<any>
    stopRealtime: () => Promise<any>
    getRealtimeData: (offset: number) => Promise<any>
    // Battery & Bluetooth
    getBatteryStatus: () => Promise<any>
    startBluetoothScan: (duration?: number) => Promise<any>
    stopBluetoothScan: () => Promise<any>
    getBluetoothStatus: () => Promise<any>
    // Push event subscriptions
    onStateChanged: (callback: (state: { connected: boolean; model: string | null; serialNumber: string | null; versionCode: string | null; versionNumber: number | null }) => void) => () => void
    onConnect: (callback: () => void) => () => void
    onDisconnect: (callback: () => void) => () => void
    onDownloadProgress: (callback: (data: { filename: string; bytesReceived: number; totalBytes: number }) => void) => () => void
    onDownloadChunk: (callback: (data: { filename: string; data: Uint8Array }) => void) => () => void
    onScanProgress: (callback: (data: { current: number; total: number }) => void) => () => void
    onRecordingChanged: (callback: (data: { recording: string | null }) => void) => () => void
  }

  // Device Pipeline API (Slice 4) — INERT main→renderer state projection.
  // Built + unit-tested but NOT consumed by any page yet; cutover is a later slice.
  devicePipeline: {
    getState: () => Promise<PipelineState>
    getFiles: () => Promise<any[]>
    connect: () => Promise<boolean>
    disconnect: () => Promise<void>
    sync: () => Promise<void>
    cancel: () => Promise<void>
    deleteFile: (filename: string) => Promise<{ result: string } | null>
    format: () => Promise<{ result: string } | null>
    onState: (callback: (state: PipelineState) => void) => () => void
    onFiles: (callback: (files: any[]) => void) => () => void
  }

  // Knowledge Graph API
  graph: {
    stats: () => Promise<{ success: boolean; data?: { nodes: number; edges: number; nodesByType: Record<string, number> }; error?: string }>
    ingestAll: () => Promise<{ success: boolean; data?: { ingested: number; skipped: number; errors: Array<{ transcriptId: string; error: string }> }; error?: string }>
    ingestFolder: (folderPath: string) => Promise<{ success: boolean; data?: { ingested: number; skipped: number; errors: Array<{ transcriptId: string; error: string }> }; error?: string }>
    topAttendees: (name: string) => Promise<{ success: boolean; data?: Array<{ person: string; personId: string; meetings: number }>; error?: string }>
    topSkill: (skill: string) => Promise<{ success: boolean; data?: Array<{ person: string; personId: string; weight: number }>; error?: string }>
    personProfile: (name: string) => Promise<{ success: boolean; data?: { personId: string; personLabel: string; meetings: any[]; skills: any[]; actionItems: any[] } | undefined; error?: string }>
    meetingGraph: (meetingId: string) => Promise<{ success: boolean; data?: { meeting: any; nodes: any[]; edges: any[] }; error?: string }>
    listNodes: (type?: string) => Promise<{ success: boolean; data?: any[]; error?: string }>
    resolvePerson: (name: string) => Promise<{ success: boolean; data?: Contact | null; error?: string }>
  }

  // Context Graph — interactive visualization + neighborhood retrieval
  contextGraph: {
    getGraph: (limit?: number) => Promise<{ success: boolean; data?: ContextGraphData; error?: string }>
    getNeighborhood: (
      entityId: string,
      hops?: number
    ) => Promise<{ success: boolean; data?: ContextGraphData; error?: string }>
    search: (query: string) => Promise<{ success: boolean; data?: ContextGraphNode[]; error?: string }>
    rekey: () => Promise<{
      success: boolean
      data?: { rekeyed: number; merged: number; skipped: number }
      error?: string
    }>
    prune: () => Promise<{
      success: boolean
      data?: { removedNodes: number; removedEdges: number }
      error?: string
    }>
    getLens: (
      centerId: string | null,
      hops?: number,
      windowDays?: number | null,
      cap?: number
    ) => Promise<{ success: boolean; data?: ContextLensData; error?: string }>
    defaultCenter: (
      ownerContactId?: string | null
    ) => Promise<{ success: boolean; data?: LensCenter | null; error?: string }>
    provenance: (
      entityId: string
    ) => Promise<{ success: boolean; data?: ProvenanceDTO; error?: string }>
    nodeDetail: (
      entityId: string
    ) => Promise<{ success: boolean; data?: NodeDetailDTO; error?: string }>
    rename: (
      entityId: string,
      newLabel: string
    ) => Promise<{
      success: boolean
      data?: { outcome: 'noop' | 'renamed' | 'merged'; scope: 'contact' | 'graph'; nodeId: string | null }
      error?: string
    }>
    convertToContact: (
      entityId: string,
      opts?: { role?: string | null; company?: string | null; email?: string | null }
    ) => Promise<{
      success: boolean
      data?: { contactId: string; outcome: 'linked' | 'merged'; nodeId: string; reusedExisting?: boolean }
      error?: string
    }>
    linkContact: (
      entityId: string,
      contactId: string
    ) => Promise<{
      success: boolean
      data?: { contactId: string; outcome: 'linked' | 'merged'; nodeId: string; reusedExisting?: boolean }
      error?: string
    }>
    setPronouns: (
      entityId: string,
      pronouns: string
    ) => Promise<{ success: boolean; data?: boolean; error?: string }>
    mergePreview: (
      keeperId: string,
      loserId: string
    ) => Promise<{ success: boolean; data?: MergePreviewDTO; error?: string }>
    mergeNodes: (
      keeperId: string,
      loserId: string
    ) => Promise<{
      success: boolean
      data?: { keeperId: string; movedEdges: number; path: 'contact' | 'graph' }
      error?: string
    }>
    deleteNode: (
      entityId: string
    ) => Promise<{ success: boolean; data?: { removed: boolean; removedEdges: number }; error?: string }>
  }

  // Identity suggestions (Round 4a) — the resolver's 0.5–0.8 review queue
  identity: {
    getSuggestions: (
      status?: 'pending' | 'accepted' | 'rejected'
    ) => Promise<{ success: boolean; data?: any[]; error?: string }>
    acceptSuggestion: (
      id: string
    ) => Promise<{
      success: boolean
      data?: { id: string; status: string; mergeJournalId?: string | null; supersededCount?: number }
      error?: string
    }>
    rejectSuggestion: (id: string) => Promise<{ success: boolean; data?: any; error?: string }>
    supersedeOrphaned: (
      kind?: 'person' | 'project'
    ) => Promise<{ success: boolean; data?: { superseded: number }; error?: string }>
    discoverContacts: () => Promise<{
      success: boolean
      data?: { candidatePairs: number; suggestionsCreated: number; autoMergeable: number }
      error?: string
    }>
    discoverProjects: () => Promise<{
      success: boolean
      data?: { candidatePairs: number; suggestionsCreated: number; autoMergeable: number }
      error?: string
    }>
    getMergeJournal: (
      request: { kind: 'contact' | 'project'; keeperId: string }
    ) => Promise<Result<MergeJournalEntry[]>>
    getMergeImpact: (
      request: { kind: 'contact' | 'project'; keeperId: string; loserId: string }
    ) => Promise<Result<{ keeper: number; loser: number }>>
    getMentionSnippets: (
      name: string,
      limit?: number
    ) => Promise<{
      success: boolean
      data?: {
        snippets: Array<{ recordingId: string; title: string; date: string | null; snippet: string }>
        recordingIds: string[]
      }
      error?: string
    }>
    getPersonContext: (
      idOrName: string
    ) => Promise<{
      success: boolean
      data?: { people: string[]; topics: string[] }
      error?: string
    }>
    getAliases: (
      contactId: string
    ) => Promise<{
      success: boolean
      data?: Array<{
        alias: string
        source: 'merge' | 'speaker_assign' | 'manual' | 'inferred' | 'rejected' | null
        confidence: number | null
        created_at: string
      }>
      error?: string
    }>
    getAmbiguousBuckets: () => Promise<{
      success: boolean
      data?: Array<{
        contactId: string
        name: string
        candidates: Array<{ id: string; name: string }>
        recordingCount: number
        resolvedCount: number
        pendingCount: number
      }>
      error?: string
    }>
    getBucketResolution: (
      contactId: string
    ) => Promise<{
      success: boolean
      data?: {
        contactId: string
        name: string
        candidates: Array<{ id: string; name: string }>
        recordings: Array<{
          recordingId: string
          title: string
          date: string | null
          meetingId: string | null
          meetingLinked: boolean
          meetingHasCalendarAttendees: boolean
          bestGuessId: string | null
          bestGuessName: string | null
          method: 'attendee-email' | 'speaker-map' | 'attendee-context' | 'unclear'
          signal: string
          resolvedContactId: string | null
          resolvedMethod: string | null
          resolved: boolean
        }>
      } | null
      error?: string
    }>
    resolveMention: (request: {
      recordingId: string
      sourceName: string
      contactId: string | null
      method?: string
    }) => Promise<{ success: boolean; data?: { ok: true }; error?: string }>
    autoSplitBuckets: () => Promise<{
      success: boolean
      data?: { buckets: number; resolved: number }
      error?: string
    }>
  }

  // Domain Events - Event-driven architecture
  onDomainEvent: (callback: (event: any) => void) => () => void

  // Recording Watcher Events
  onRecordingAdded: (callback: (data: { recording: any }) => void) => () => void

  // Transcription Events
  onTranscriptionStarted: (callback: (data: { queueItemId?: string; recordingId: string }) => void) => () => void
  onTranscriptionProgress: (callback: (data: { queueItemId: string; progress: number; stage: string }) => void) => () => void
  onTranscriptionCompleted: (callback: (data: { queueItemId?: string; recordingId: string }) => void) => () => void
  onTranscriptionFailed: (callback: (data: { queueItemId?: string; recordingId: string; error: string }) => void) => () => void
  onTranscriptionCancelled: (callback: (data: { recordingId: string }) => void) => () => void
  onTranscriptionAllCancelled: (callback: (data: { count: number }) => void) => () => void
  onTranscriptionQueueState: (callback: (state: TranscriptionQueueState) => void) => () => void

  // Security Warning Events
  onSecurityWarning: (callback: (data: { type: string; message: string }) => void) => () => void

  // Activity Log bridge — main process services (transcription, calendar, download) emit entries here
  onActivityLogEntry: (callback: (entry: { type: string; message: string; details?: string; timestamp: string }) => void) => () => void
}

// Expose the API to the renderer process
const electronAPI: ElectronAPI = {
  app: {
    restart: () => callIPC('app:restart'),
    info: () => callIPC('app:info')
  },

  config: {
    get: () => callIPC('config:get'),
    set: (config) => callIPC('config:set', config),
    updateSection: (section, values) => callIPC('config:update-section', section, values),
    getValue: (key) => callIPC('config:get-value', key)
  },

  meetings: {
    getAll: (startDate, endDate) => callIPC('db:get-meetings', startDate, endDate),
    getById: (id) => callIPC('db:get-meeting', id),
    getByIds: (ids) => callIPC('db:get-meetings-by-ids', ids),
    getDetails: (id) => callIPC('db:get-meeting-details', id),
    update: (request) => callIPC('meetings:update', request),
    addAttendee: (request) => callIPC('meetings:addAttendee', request),
    removeAttendee: (request) => callIPC('meetings:removeAttendee', request)
  },

  contacts: {
    getAll: (request) => callIPC('contacts:getAll', request),
    getById: (id) => callIPC('contacts:getById', id),
    create: (request) => callIPC('contacts:create', request),
    update: (request) => callIPC('contacts:update', request),
    delete: (id) => callIPC('contacts:delete', id),
    merge: (request) => callIPC('contacts:merge', request),
    unmerge: (journalId) => callIPC('contacts:unmerge', journalId),
    getForMeeting: (meetingId) => callIPC('contacts:getForMeeting', meetingId)
  },

  projects: {
    getAll: (request) => callIPC('projects:getAll', request),
    getById: (id) => callIPC('projects:getById', id),
    create: (request) => callIPC('projects:create', request),
    update: (request) => callIPC('projects:update', request),
    delete: (id) => callIPC('projects:delete', id),
    tagMeeting: (request) => callIPC('projects:tagMeeting', request),
    untagMeeting: (request) => callIPC('projects:untagMeeting', request),
    getForMeeting: (meetingId) => callIPC('projects:getForMeeting', meetingId),
    merge: (request) => callIPC('projects:merge', request),
    unmerge: (journalId) => callIPC('projects:unmerge', journalId),
    getForKnowledge: (knowledgeCaptureId) => callIPC('projects:getForKnowledge', knowledgeCaptureId),
    getNotes: (request) => callIPC('projects:getNotes', request),
    addNote: (request) => callIPC('projects:addNote', request),
    updateNote: (request) => callIPC('projects:updateNote', request),
    deleteNote: (request) => callIPC('projects:deleteNote', request),
    getActionables: (projectId) => callIPC('projects:getActionables', projectId),
    openFolder: (projectId) => callIPC('projects:openFolder', projectId)
  },

  recordings: {
    getAll: () => callIPC('db:get-recordings'),
    getById: (id) => callIPC('db:get-recording', id),
    getForMeeting: (meetingId) => callIPC('db:get-recordings-for-meeting', meetingId),
    updateStatus: (id, status) => callIPC('db:update-recording-status', id, status),
    updateRecordingStatus: (id, status) => callIPC('recordings:updateStatus', id, status),
    updateTranscriptionStatus: (id, status) => callIPC('recordings:updateTranscriptionStatus', id, status),
    updateDuration: (id, durationSeconds) => callIPC('recordings:updateDuration', id, durationSeconds),
    backfillDurations: () => callIPC('recordings:backfillDurations'),
    linkToMeeting: (recordingId, meetingId, confidence, method) =>
      callIPC('db:link-recording-to-meeting', recordingId, meetingId, confidence, method),
    delete: (id) => callIPC('recordings:delete', id),
    deleteBatch: (ids) => callIPC('recordings:deleteBatch', ids),
    markPersonal: (id, personal) => callIPC('recordings:markPersonal', id, personal),
    deletionImpact: (id) => callIPC('recordings:deletionImpact', id),
    deleteCascade: (id, hard) => callIPC('recordings:deleteCascade', id, hard),
    restore: (id) => callIPC('recordings:restore', id),
    // Recording-Meeting linking dialog methods
    getCandidates: (recordingId) => callIPC('recordings:getCandidates', recordingId),
    getMeetingsNearDate: (date) => callIPC('recordings:getMeetingsNearDate', date),
    selectMeeting: (recordingId, meetingId) => callIPC('recordings:selectMeeting', recordingId, meetingId),
    // Live-recording pre-assignment
    preassign: (filename: string, meetingId: string | null) => callIPC('recordings:preassign', filename, meetingId),
    getPreassignment: (filename: string) => callIPC('recordings:getPreassignment', filename),
    clearPreassignment: (filename: string) => callIPC('recordings:clearPreassignment', filename),
    // External file import
    addExternal: () => callIPC('recordings:addExternal'),
    addExternalByPath: (filePath: string) => callIPC('recordings:addExternalByPath', filePath),
    // Transcription
    transcribe: (recordingId) => callIPC('recordings:transcribe', recordingId),
    addToQueue: (recordingId, priority) => callIPC('recordings:addToQueue', recordingId, priority),
    reprocessWith: (recordingId, provider) => callIPC('recordings:reprocessWith', { recordingId, provider }),
    processQueue: () => callIPC('recordings:processQueue'),
    getTranscriptionStatus: () => callIPC('recordings:getTranscriptionStatus'),
    getTranscriptionQueue: () => callIPC('transcription:getQueue'),
    cancelTranscription: (recordingId: string) => callIPC('transcription:cancel', recordingId),
    cancelAllTranscriptions: () => callIPC('transcription:cancelAll'),
    updateQueueItem: (id: string, status: string, errorMessage?: string) => callIPC('transcription:updateQueueItem', id, status, errorMessage),
    pauseTranscriptionQueue: () => callIPC('transcription:pause'),
    resumeTranscriptionQueue: () => callIPC('transcription:resume'),
    reorderTranscription: (recordingId: string, direction: 'up' | 'down') => callIPC('transcription:reorder', { recordingId, direction }),
    getTranscriptionQueueState: () => callIPC('transcription:queueState'),
  },

  transcripts: {
    getByRecordingId: (recordingId) => callIPC('db:get-transcript', recordingId),
    getByRecordingIds: (recordingIds) => callIPC('db:get-transcripts-by-recording-ids', recordingIds),
    search: (query) => callIPC('db:search-transcripts', query),
    assignSpeaker: (request) => callIPC('transcripts:assignSpeaker', request),
    getSpeakerMap: (request) => callIPC('transcripts:getSpeakerMap', request),
    unassignSpeaker: (request) => callIPC('transcripts:unassignSpeaker', request)
  },

  transcriptUpgrade: {
    scan: (req) => callIPC('transcript-upgrade:scan', req),
    run: (req) => callIPC('transcript-upgrade:run', req),
    getStatus: (req) => callIPC('transcript-upgrade:getStatus', req),
    getRecommended: () => callIPC('transcript-upgrade:getRecommended')
  },

  selfId: {
    scan: () => callIPC('self-id:scan'),
    runForRecording: (request) => callIPC('self-id:runForRecording', request),
    backfill: () => callIPC('self-id:backfill'),
    getStatus: () => callIPC('self-id:getStatus'),
    getMergeSuspected: () => callIPC('self-id:getMergeSuspected')
  },

  turnSpeakers: {
    getOverrides: (request) => callIPC('turn-speakers:getOverrides', request),
    setOverride: (request) => callIPC('turn-speakers:setOverride', request),
    clearOverride: (request) => callIPC('turn-speakers:clearOverride', request),
    getSplits: (request) => callIPC('turn-speakers:getSplits', request),
    split: (request) => callIPC('turn-speakers:split', request),
    mergeSplit: (request) => callIPC('turn-speakers:mergeSplit', request),
    assignFromHere: (request) => callIPC('turn-speakers:assignFromHere', request),
    getMergeHints: (request) => callIPC('turn-speakers:getMergeHints', request)
  },

  briefing: {
    get: () => callIPC('briefing:get')
  },

  queue: {
    getItems: (status) => callIPC('db:get-queue', status)
  },

  knowledge: {
    getAll: (options) => callIPC('knowledge:getAll', options),
    getById: (id) => callIPC('knowledge:getById', id),
    getByIds: (ids) => callIPC('knowledge:getByIds', ids), // B-CHAT-004
    update: (id, updates) => callIPC('knowledge:update', id, updates),
    setProjects: (request) => callIPC('knowledge:setProjects', request)
  },

  actionItems: {
    setAssignee: (request) => callIPC('actionItems:setAssignee', request)
  },

  actionables: {
    getAll: (options) => callIPC('actionables:getAll', options),
    getByMeeting: (meetingId) => callIPC('actionables:getByMeeting', meetingId),
    updateStatus: (id, status) => callIPC('actionables:updateStatus', id, status),
    generateOutput: (actionableId) => callIPC('actionables:generateOutput', actionableId)
  },

  assistant: {
    getConversations: () => callIPC('assistant:getConversations'),
    createConversation: (title) => callIPC('assistant:createConversation', title),
    deleteConversation: (id) => callIPC('assistant:deleteConversation', id),
    getMessages: (conversationId) => callIPC('assistant:getMessages', conversationId),
    addMessage: (conversationId, role, content, sources) => callIPC('assistant:addMessage', conversationId, role, content, sources),
    updateConversationTitle: (conversationId, title) => callIPC('assistant:updateConversationTitle', conversationId, title),
    addContext: (conversationId, knowledgeCaptureId) => callIPC('assistant:addContext', conversationId, knowledgeCaptureId),
    removeContext: (conversationId, knowledgeCaptureId) => callIPC('assistant:removeContext', conversationId, knowledgeCaptureId),
    getContext: (conversationId) => callIPC('assistant:getContext', conversationId)
  },

  chat: {
    getHistory: (limit) => callIPC('db:get-chat-history', limit),
    addMessage: (role, content, sources) => callIPC('db:add-chat-message', role, content, sources),
    clearHistory: () => callIPC('db:clear-chat-history')
  },

  calendar: {
    sync: () => callIPC('calendar:sync'),
    clearAndSync: () => callIPC('calendar:clear-and-sync'),
    getLastSync: () => callIPC('calendar:get-last-sync'),
    setUrl: (url) => callIPC('calendar:set-url', url),
    toggleAutoSync: (enabled) => callIPC('calendar:toggle-auto-sync', enabled),
    setInterval: (minutes) => callIPC('calendar:set-interval', minutes),
    getSettings: () => callIPC('calendar:get-settings')
  },

  storage: {
    getInfo: () => callIPC('storage:get-info'),
    openFolder: (folder) => callIPC('storage:open-folder', folder),
    selectFolder: (currentPath) => callIPC('storage:select-folder', currentPath),
    openFile: (filePath) => callIPC('storage:open-file', filePath),
    revealInFolder: (filePath) => callIPC('storage:reveal-in-folder', filePath),
    readRecording: (filePath) => callIPC('storage:read-recording', filePath),
    deleteRecording: (filePath) => callIPC('storage:delete-recording', filePath),
    saveRecording: (filename, data, recordingDateIso) => callIPC('storage:save-recording', filename, data, recordingDateIso)
  },

  syncedFiles: {
    isFileSynced: (originalFilename) => callIPC('db:is-file-synced', originalFilename),
    getSyncedFile: (originalFilename) => callIPC('db:get-synced-file', originalFilename),
    getAll: () => callIPC('db:get-all-synced-files'),
    add: (originalFilename, localFilename, filePath, fileSize) =>
      callIPC('db:add-synced-file', originalFilename, localFilename, filePath, fileSize),
    remove: (originalFilename) => callIPC('db:remove-synced-file', originalFilename),
    getFilenames: () => callIPC('db:get-synced-filenames')
  },

  deviceCache: {
    getAll: () => callIPC('deviceCache:getAll'),
    saveAll: (files) => callIPC('deviceCache:saveAll', files),
    clear: () => callIPC('deviceCache:clear')
  },

  artifacts: {
    import: (filePaths) => callIPC('artifacts:import', filePaths),
    pickAndImport: () => callIPC('artifacts:pickAndImport'),
    getForCapture: (knowledgeCaptureId) => callIPC('artifacts:getForCapture', knowledgeCaptureId),
    openInFolder: (id) => callIPC('artifacts:openInFolder', id)
  },

  connectors: {
    list: () => callIPC('connectors:list'),
    get: (id) => callIPC('connectors:get', id),
    configure: (id, values) => callIPC('connectors:configure', id, values),
    connect: (id, authMode) => callIPC('connectors:connect', id, authMode),
    disconnect: (id) => callIPC('connectors:disconnect', id),
    addInstance: (type, label) => callIPC('connectors:addInstance', type, label),
    removeInstance: (id) => callIPC('connectors:removeInstance', id),
    setInstanceLabel: (id, label) => callIPC('connectors:setInstanceLabel', id, label),
    listContainers: (id) => callIPC('connectors:listContainers', id),
    setSourceEnabled: (id, containerId, enabled) => callIPC('connectors:setSourceEnabled', id, containerId, enabled),
    sync: (id, containerId) => callIPC('connectors:sync', id, containerId),
    searchPeople: (query) => callIPC('connectors:searchPeople', query),
    onStatusChanged: (callback) => {
      const handler = (_e: unknown, payload: { id: string; status: ConnectorStatus }) => callback(payload)
      ipcRenderer.on('connectors:status-changed', handler)
      return () => ipcRenderer.removeListener('connectors:status-changed', handler)
    }
  },

  migration: {
    previewCleanup: () => callIPC('migration:previewCleanup'),
    runCleanup: () => callIPC('migration:runCleanup'),
    runV11: () => callIPC('migration:runV11'),
    rollbackV11: () => callIPC('migration:rollbackV11'),
    getStatus: () => callIPC('migration:getStatus'),
    previewMisbundledRecordings: () => callIPC('repair:previewMisbundled'),
    applyMisbundledRecordings: () => callIPC('repair:applyMisbundled'),
    onProgress: (callback) => {
      const handler = (_event: any, progress: any) => callback(progress)
      ipcRenderer.on('migration:progress', handler)
      return () => {
        ipcRenderer.removeListener('migration:progress', handler)
      }
    }
  },

  outputs: {
    getTemplates: () => callIPC('outputs:getTemplates'),
    generate: (request) => callIPC('outputs:generate', request),
    getByActionableId: (actionableId) => callIPC('outputs:getByActionableId', actionableId),
    copyToClipboard: (content) => callIPC('outputs:copyToClipboard', content),
    saveToFile: (content, suggestedName) => callIPC('outputs:saveToFile', content, suggestedName),
    openInFolder: (filePath) => callIPC('outputs:openInFolder', filePath),
    launchClaudeCode: (args) => callIPC('outputs:launchClaudeCode', args)
  },

  rag: {
    status: () => callIPC('rag:status'),
    chat: (request) => callIPC('rag:chat', request),
    chatLegacy: (sessionId, message, meetingFilter) =>
      callIPC('rag:chat-legacy', { sessionId, message, meetingFilter }),
    summarizeMeeting: (meetingId) => callIPC('rag:summarize-meeting', meetingId),
    findActionItems: (meetingId) => callIPC('rag:find-action-items', meetingId),
    cancel: (sessionId) => callIPC('rag:cancel', sessionId), // B-CHAT-005
    removeLastMessages: (sessionId, count) => callIPC('rag:removeLastMessages', sessionId, count),
    clearSession: (sessionId) => callIPC('rag:clear-session', sessionId),
    stats: () => callIPC('rag:stats'),
    indexTranscript: (transcript, metadata) =>
      callIPC('rag:index-transcript', { transcript, metadata }),
    search: (query, limit) => callIPC('rag:search', { query, limit }),
    getChunks: () => callIPC('rag:get-chunks'),
    globalSearch: (query, limit) => callIPC('rag:globalSearch', { query, limit })
  },

  downloadService: {
    getState: () => callIPC('download-service:get-state'),
    isFileSynced: (filename) => callIPC('download-service:is-file-synced', filename),
    getFilesToSync: (files) => callIPC('download-service:get-files-to-sync', files),
    queueDownloads: (files) => callIPC('download-service:queue-downloads', files),
    startSession: (files) => callIPC('download-service:start-session', files),
    processDownload: (filename, data) => callIPC('download-service:process-download', filename, data),
    updateProgress: (filename, bytesReceived) => callIPC('download-service:update-progress', filename, bytesReceived),
    markFailed: (filename, error) => callIPC('download-service:mark-failed', filename, error),
    clearCompleted: () => callIPC('download-service:clear-completed'),
    cancel: (filename) => callIPC('download-service:cancel', filename),
    cancelAll: () => callIPC('download-service:cancel-all'),
    retryFailed: (deviceConnected?: boolean) => callIPC('download-service:retry-failed', deviceConnected),
    getStats: () => callIPC('download-service:get-stats'),
    checkStalled: () => callIPC('download-service:check-stalled'),
    cancelActive: (reason?: string) => callIPC('download-service:cancel-active', reason),
    notifyCompletion: (stats: { completed: number; failed: number; aborted: boolean }) =>
      callIPC('download-service:notify-completion', stats),
    onStateUpdate: (callback) => {
      const handler = (_event: any, state: any) => callback(state)
      ipcRenderer.on('download-service:state-update', handler)
      // Return unsubscribe function
      return () => {
        ipcRenderer.removeListener('download-service:state-update', handler)
      }
    }
  },

  // Quality Assessment API
  quality: {
    get: (recordingId: string) => callIPC('quality:get', recordingId),
    set: (recordingId: string, quality: 'high' | 'medium' | 'low', reason?: string, assessedBy?: string) =>
      callIPC('quality:set', recordingId, quality, reason, assessedBy),
    autoAssess: (recordingId: string) => callIPC('quality:auto-assess', recordingId),
    getByQuality: (quality: 'high' | 'medium' | 'low') => callIPC('quality:get-by-quality', quality),
    batchAutoAssess: (recordingIds: string[]) => callIPC('quality:batch-auto-assess', recordingIds),
    assessUnassessed: () => callIPC('quality:assess-unassessed')
  },

  // Storage Policy API
  storagePolicy: {
    getByTier: (tier: 'hot' | 'warm' | 'cold' | 'archive') => callIPC('storage:get-by-tier', tier),
    getCleanupSuggestions: (minAgeOverride?: Partial<Record<'hot' | 'warm' | 'cold' | 'archive', number>>) =>
      callIPC('storage:get-cleanup-suggestions', minAgeOverride),
    getCleanupSuggestionsForTier: (tier: 'hot' | 'warm' | 'cold' | 'archive', minAgeDays?: number) =>
      callIPC('storage:get-cleanup-suggestions-for-tier', tier, minAgeDays),
    executeCleanup: (recordingIds: string[], archive?: boolean) =>
      callIPC('storage:execute-cleanup', recordingIds, archive),
    getStats: () => callIPC('storage:get-stats'),
    initializeUntiered: () => callIPC('storage:initialize-untiered'),
    assignTier: (recordingId: string, quality: 'high' | 'medium' | 'low') =>
      callIPC('storage:assign-tier', recordingId, quality)
  },

  // Data Integrity Service API
  integrity: {
    runScan: () => callIPC('integrity:run-scan'),
    getReport: () => callIPC('integrity:get-report'),
    repairIssue: (issueId: string) => callIPC('integrity:repair-issue', issueId),
    repairAll: () => callIPC('integrity:repair-all'),
    runStartupChecks: () => callIPC('integrity:run-startup-checks'),
    cleanupWronglyNamed: () => callIPC('integrity:cleanup-wrongly-named'),
    purgeMissingFiles: () => callIPC('integrity:purge-missing-files'),
    onProgress: (callback: (progress: { message: string; progress: number }) => void) => {
      const handler = (_event: any, progress: { message: string; progress: number }) => callback(progress)
      ipcRenderer.on('integrity:progress', handler)
      return () => {
        ipcRenderer.removeListener('integrity:progress', handler)
      }
    }
  },

  // Jensen Device API — IPC bridge to main-process JensenDevice singleton
  jensen: {
    // Core
    connect: () => callIPC('jensen:connect'),
    tryConnect: () => callIPC('jensen:tryConnect'),
    disconnect: () => callIPC('jensen:disconnect'),
    reset: () => callIPC('jensen:reset'),
    isConnected: () => callIPC('jensen:isConnected'),
    getModel: () => callIPC('jensen:getModel'),
    isP1Device: () => callIPC('jensen:isP1Device'),
    // Device info & settings
    getDeviceInfo: () => callIPC('jensen:getDeviceInfo'),
    getCardInfo: () => callIPC('jensen:getCardInfo'),
    getFileCount: () => callIPC('jensen:getFileCount'),
    getSettings: () => callIPC('jensen:getSettings'),
    setTime: () => callIPC('jensen:setTime'),
    setAutoRecord: (enabled: boolean) => callIPC('jensen:setAutoRecord', { enabled }),
    // File operations
    listFiles: () => callIPC('jensen:listFiles'),
    downloadFile: (filename: string, fileSize: number) => callIPC('jensen:downloadFile', { filename, fileSize }),
    cancelDownload: () => callIPC('jensen:cancelDownload'),
    deleteFile: (filename: string) => callIPC('jensen:deleteFile', { filename }),
    formatCard: () => callIPC('jensen:formatCard'),
    // Realtime
    getRealtimeSettings: () => callIPC('jensen:getRealtimeSettings'),
    startRealtime: () => callIPC('jensen:startRealtime'),
    pauseRealtime: () => callIPC('jensen:pauseRealtime'),
    stopRealtime: () => callIPC('jensen:stopRealtime'),
    getRealtimeData: (offset: number) => callIPC('jensen:getRealtimeData', { offset }),
    // Battery & Bluetooth
    getBatteryStatus: () => callIPC('jensen:getBatteryStatus'),
    startBluetoothScan: (duration?: number) => callIPC('jensen:startBluetoothScan', { duration }),
    stopBluetoothScan: () => callIPC('jensen:stopBluetoothScan'),
    getBluetoothStatus: () => callIPC('jensen:getBluetoothStatus'),
    // Push event subscriptions
    onStateChanged: (callback: (state: { connected: boolean; model: string | null; serialNumber: string | null; versionCode: string | null; versionNumber: number | null }) => void) => {
      const handler = (_event: any, state: any) => callback(state)
      ipcRenderer.on('jensen:state-changed', handler)
      return () => ipcRenderer.removeListener('jensen:state-changed', handler)
    },
    onConnect: (callback: () => void) => {
      const handler = () => callback()
      ipcRenderer.on('jensen:connect-event', handler)
      return () => ipcRenderer.removeListener('jensen:connect-event', handler)
    },
    onDisconnect: (callback: () => void) => {
      const handler = () => callback()
      ipcRenderer.on('jensen:disconnect-event', handler)
      return () => ipcRenderer.removeListener('jensen:disconnect-event', handler)
    },
    onDownloadProgress: (callback: (data: { filename: string; bytesReceived: number; totalBytes: number }) => void) => {
      const handler = (_event: any, data: any) => callback(data)
      ipcRenderer.on('jensen:download-progress', handler)
      return () => ipcRenderer.removeListener('jensen:download-progress', handler)
    },
    onDownloadChunk: (callback: (data: { filename: string; data: Uint8Array }) => void) => {
      const handler = (_event: any, data: any) => callback(data)
      ipcRenderer.on('jensen:download-chunk', handler)
      return () => ipcRenderer.removeListener('jensen:download-chunk', handler)
    },
    onScanProgress: (callback: (data: { current: number; total: number }) => void) => {
      const handler = (_event: any, data: any) => callback(data)
      ipcRenderer.on('jensen:scan-progress', handler)
      return () => ipcRenderer.removeListener('jensen:scan-progress', handler)
    },
    // Live-recording signal: `recording` is the in-progress capture's filename, or
    // null when the device goes idle / disconnects. Pushed by the main-process poll.
    onRecordingChanged: (callback: (data: { recording: string | null }) => void) => {
      const handler = (_event: any, data: any) => callback(data)
      ipcRenderer.on('jensen:recording-changed', handler)
      return () => ipcRenderer.removeListener('jensen:recording-changed', handler)
    },
  },

  // Device Pipeline API (Slice 4) — INERT main→renderer state projection.
  devicePipeline: {
    getState: () => callIPC('device-pipeline:get-state'),
    getFiles: () => callIPC('device-pipeline:get-files'),
    connect: () => callIPC('device-pipeline:connect'),
    disconnect: () => callIPC('device-pipeline:disconnect'),
    sync: () => callIPC('device-pipeline:sync'),
    cancel: () => callIPC('device-pipeline:cancel'),
    deleteFile: (filename: string) => callIPC('device-pipeline:delete-file', { filename }),
    format: () => callIPC('device-pipeline:format'),
    onState: (callback: (state: any) => void) => {
      const handler = (_event: any, state: any) => callback(state)
      ipcRenderer.on('device-pipeline:state', handler)
      return () => ipcRenderer.removeListener('device-pipeline:state', handler)
    },
    onFiles: (callback: (files: any[]) => void) => {
      const handler = (_event: any, files: any[]) => callback(files)
      ipcRenderer.on('device-pipeline:files', handler)
      return () => ipcRenderer.removeListener('device-pipeline:files', handler)
    }
  },

  graph: {
    stats: () => callIPC('graph:stats'),
    ingestAll: () => callIPC('graph:ingestAll'),
    ingestFolder: (folderPath: string) => callIPC('graph:ingestFolder', folderPath),
    topAttendees: (name: string) => callIPC('graph:topAttendees', name),
    topSkill: (skill: string) => callIPC('graph:topSkill', skill),
    personProfile: (name: string) => callIPC('graph:personProfile', name),
    meetingGraph: (meetingId: string) => callIPC('graph:meetingGraph', meetingId),
    listNodes: (type?: string) => callIPC('graph:listNodes', type),
    resolvePerson: (name: string) => callIPC('graph:resolvePerson', name),
  },

  // Context Graph — interactive visualization + neighborhood retrieval
  contextGraph: {
    getGraph: (limit?: number) => callIPC('contextGraph:getGraph', limit),
    getNeighborhood: (entityId: string, hops?: number) =>
      callIPC('contextGraph:getNeighborhood', entityId, hops),
    search: (query: string) => callIPC('contextGraph:search', query),
    rekey: () => callIPC('contextGraph:rekey'),
    prune: () => callIPC('contextGraph:prune'),
    getLens: (centerId: string | null, hops?: number, windowDays?: number | null, cap?: number) =>
      callIPC('contextGraph:getLens', centerId, hops, windowDays, cap),
    defaultCenter: (ownerContactId?: string | null) =>
      callIPC('contextGraph:defaultCenter', ownerContactId),
    provenance: (entityId: string) => callIPC('contextGraph:provenance', entityId),
    nodeDetail: (entityId: string) => callIPC('contextGraph:nodeDetail', entityId),
    rename: (entityId: string, newLabel: string) => callIPC('contextGraph:rename', entityId, newLabel),
    convertToContact: (
      entityId: string,
      opts?: { role?: string | null; company?: string | null; email?: string | null }
    ) => callIPC('contextGraph:convertToContact', entityId, opts),
    linkContact: (entityId: string, contactId: string) =>
      callIPC('contextGraph:linkContact', entityId, contactId),
    setPronouns: (entityId: string, pronouns: string) =>
      callIPC('contextGraph:setPronouns', entityId, pronouns),
    mergePreview: (keeperId: string, loserId: string) =>
      callIPC('contextGraph:mergePreview', keeperId, loserId),
    mergeNodes: (keeperId: string, loserId: string) =>
      callIPC('contextGraph:mergeNodes', keeperId, loserId),
    deleteNode: (entityId: string) => callIPC('contextGraph:deleteNode', entityId),
  },

  // Identity suggestions (Round 4a)
  identity: {
    getSuggestions: (status?: 'pending' | 'accepted' | 'rejected') => callIPC('identity:getSuggestions', status),
    acceptSuggestion: (id: string) => callIPC('identity:acceptSuggestion', id),
    rejectSuggestion: (id: string) => callIPC('identity:rejectSuggestion', id),
    supersedeOrphaned: (kind?: 'person' | 'project') => callIPC('identity:supersedeOrphaned', kind),
    discoverContacts: () => callIPC('identity:discoverContacts'),
    discoverProjects: () => callIPC('identity:discoverProjects'),
    getMergeJournal: (request) => callIPC('identity:getMergeJournal', request),
    getMergeImpact: (request) => callIPC('identity:getMergeImpact', request),
    getMentionSnippets: (name: string, limit?: number) =>
      callIPC('identity:getMentionSnippets', { name, limit }),
    getPersonContext: (idOrName: string) => callIPC('identity:getPersonContext', idOrName),
    getAliases: (contactId: string) => callIPC('identity:getAliases', contactId),
    getAmbiguousBuckets: () => callIPC('identity:getAmbiguousBuckets'),
    getBucketResolution: (contactId: string) => callIPC('identity:getBucketResolution', contactId),
    resolveMention: (request: { recordingId: string; sourceName: string; contactId: string | null; method?: string }) =>
      callIPC('identity:resolveMention', request),
    autoSplitBuckets: () => callIPC('identity:autoSplitBuckets')
  },

  // Domain Event Listener
  onDomainEvent: (callback: (event: any) => void) => {
    const handler = (_event: any, domainEvent: any) => callback(domainEvent)
    ipcRenderer.on('domain-event', handler)
    return () => {
      ipcRenderer.removeListener('domain-event', handler)
    }
  },

  // Recording Watcher Event Listener
  onRecordingAdded: (callback: (data: { recording: any }) => void) => {
    const handler = (_event: any, data: { recording: any }) => callback(data)
    ipcRenderer.on('recording:new', handler)
    return () => {
      ipcRenderer.removeListener('recording:new', handler)
    }
  },

  // Transcription Event Listeners
  onTranscriptionStarted: (callback: (data: { queueItemId?: string; recordingId: string }) => void) => {
    const handler = (_event: any, data: { queueItemId?: string; recordingId: string }) => callback(data)
    ipcRenderer.on('transcription:started', handler)
    return () => {
      ipcRenderer.removeListener('transcription:started', handler)
    }
  },

  onTranscriptionProgress: (callback: (data: { queueItemId: string; progress: number; stage: string }) => void) => {
    const handler = (_event: any, data: { queueItemId: string; progress: number; stage: string }) => callback(data)
    ipcRenderer.on('transcription:progress', handler)
    return () => {
      ipcRenderer.removeListener('transcription:progress', handler)
    }
  },

  onTranscriptionCompleted: (callback: (data: { queueItemId?: string; recordingId: string }) => void) => {
    const handler = (_event: any, data: { queueItemId?: string; recordingId: string }) => callback(data)
    ipcRenderer.on('transcription:completed', handler)
    return () => {
      ipcRenderer.removeListener('transcription:completed', handler)
    }
  },

  onTranscriptionFailed: (callback: (data: { queueItemId?: string; recordingId: string; error: string }) => void) => {
    const handler = (_event: any, data: { queueItemId?: string; recordingId: string; error: string }) => callback(data)
    ipcRenderer.on('transcription:failed', handler)
    return () => {
      ipcRenderer.removeListener('transcription:failed', handler)
    }
  },

  onTranscriptionCancelled: (callback: (data: { recordingId: string }) => void) => {
    const handler = (_event: any, data: { recordingId: string }) => callback(data)
    ipcRenderer.on('transcription:cancelled', handler)
    return () => {
      ipcRenderer.removeListener('transcription:cancelled', handler)
    }
  },

  onTranscriptionAllCancelled: (callback: (data: { count: number }) => void) => {
    const handler = (_event: any, data: { count: number }) => callback(data)
    ipcRenderer.on('transcription:all-cancelled', handler)
    return () => {
      ipcRenderer.removeListener('transcription:all-cancelled', handler)
    }
  },

  onTranscriptionQueueState: (callback: (state: TranscriptionQueueState) => void) => {
    const handler = (_event: any, state: TranscriptionQueueState) => callback(state)
    ipcRenderer.on('transcription:queueState', handler)
    return () => {
      ipcRenderer.removeListener('transcription:queueState', handler)
    }
  },

  // Security Warning Listener
  onSecurityWarning: (callback: (data: { type: string; message: string }) => void) => {
    const handler = (_event: any, data: { type: string; message: string }) => callback(data)
    ipcRenderer.on('security-warning', handler)
    return () => {
      ipcRenderer.removeListener('security-warning', handler)
    }
  },

  onActivityLogEntry: (callback) => {
    const handler = (_event: any, entry: { type: string; message: string; details?: string; timestamp: string }) =>
      callback(entry)
    ipcRenderer.on('activity-log:entry', handler)
    return () => {
      ipcRenderer.removeListener('activity-log:entry', handler)
    }
  }
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)

// Type augmentation for the window object
declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
