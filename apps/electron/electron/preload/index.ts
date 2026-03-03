import { contextBridge, ipcRenderer } from 'electron'

// --- IPC Logging Wrapper ---
const callIPC = async (channel: string, ...args: any[]) => {
  const isPolling = ['recordings:getTranscriptionStatus', 'db:get-recordings', 'knowledge:getAll'].includes(channel);

  try {
    const start = performance.now();
    const result = await ipcRenderer.invoke(channel, ...args);
    const duration = (performance.now() - start).toFixed(1);

    if (!isPolling) {
        console.log(`[QA-MONITOR][IPC] ${channel} (${duration}ms)`);
    }
    return result;
  } catch (error) {
    if (!isPolling) {
        console.error(`[QA-MONITOR][IPC-ERR] ${channel}:`, error);
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
  UpdateContactRequest,
  GetProjectsRequest,
  GetProjectsResponse,
  CreateProjectRequest,
  UpdateProjectRequest,
  TagMeetingRequest,
  OutputTemplate,
  GenerateOutputRequest,
  GenerateOutputResponse
} from '../main/types/api'
import type { Contact, ContactWithMeetings, Project, ProjectWithMeetings } from '../main/types/database'
import type { MigrationAPI } from './migration-types'
import type { 
  KnowledgeCapture, 
  Actionable, 
  Conversation, 
  Message 
} from '../../src/types/knowledge'

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
    update: (request: { id: string; subject?: string; start_time?: string; end_time?: string; location?: string | null; description?: string | null }) => Promise<Result<any>>
  }

  // Contacts
  contacts: {
    getAll: (request?: GetContactsRequest) => Promise<Result<GetContactsResponse>>
    getById: (id: string) => Promise<Result<ContactWithMeetings>>
    update: (request: UpdateContactRequest) => Promise<Result<Contact>>
    delete: (id: string) => Promise<Result<void>>
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
  }

  // Database - Recordings
  recordings: {
    getAll: () => Promise<any[]>
    getById: (id: string) => Promise<any>
    getForMeeting: (meetingId: string) => Promise<any[]>
    updateStatus: (id: string, status: string) => Promise<any>
    updateRecordingStatus: (id: string, status: string) => Promise<{ success: boolean; data?: any; error?: string }>
    updateTranscriptionStatus: (id: string, status: string) => Promise<{ success: boolean; data?: any; error?: string }>
    linkToMeeting: (recordingId: string, meetingId: string, confidence: number, method: string) => Promise<any>
    delete: (id: string) => Promise<boolean>
    deleteBatch: (ids: string[]) => Promise<{
      success: boolean
      deleted: number
      failed: number
      errors: Array<{ id: string; error: string }>
    }>
    // Recording-Meeting linking dialog methods
    getCandidates: (recordingId: string) => Promise<{ success: boolean; data: any[]; error?: string }>
    getMeetingsNearDate: (date: string) => Promise<{ success: boolean; data: any[]; error?: string }>
    selectMeeting: (recordingId: string, meetingId: string | null) => Promise<{ success: boolean; error?: string }>
    // External file import
    addExternal: () => Promise<{ success: boolean; recording?: any; error?: string }>
    addExternalByPath: (filePath: string) => Promise<{ success: boolean; recording?: any; error?: string }>
    // Transcription
    transcribe: (recordingId: string) => Promise<void>
    addToQueue: (recordingId: string) => Promise<string | false>
    processQueue: () => Promise<boolean>
    getTranscriptionStatus: () => Promise<{ isProcessing: boolean; pendingCount: number; processingCount: number }>
    getTranscriptionQueue: () => Promise<any[]>
    cancelTranscription: (recordingId: string) => Promise<{ success: boolean }>
    cancelAllTranscriptions: () => Promise<{ success: boolean; count: number }>
    updateQueueItem: (id: string, status: string, errorMessage?: string) => Promise<boolean>
  }

  // Database - Transcripts
  transcripts: {
    getByRecordingId: (recordingId: string) => Promise<any>
    getByRecordingIds: (recordingIds: string[]) => Promise<Record<string, any>>
    search: (query: string) => Promise<any[]>
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
    retryFailed: () => Promise<number>
    getStats: () => Promise<{ totalSynced: number; pendingInQueue: number; failedInQueue: number }>
    checkStalled: () => Promise<number>
    cancelActive: (reason?: string) => Promise<number>
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

  // Migration - Database schema migration to V11 (Knowledge Captures)
  migration: MigrationAPI


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

  // Security Warning Events
  onSecurityWarning: (callback: (data: { type: string; message: string }) => void) => () => void
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
    update: (request) => callIPC('meetings:update', request)
  },

  contacts: {
    getAll: (request) => callIPC('contacts:getAll', request),
    getById: (id) => callIPC('contacts:getById', id),
    update: (request) => callIPC('contacts:update', request),
    delete: (id) => callIPC('contacts:delete', id),
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
    getForMeeting: (meetingId) => callIPC('projects:getForMeeting', meetingId)
  },

  recordings: {
    getAll: () => callIPC('db:get-recordings'),
    getById: (id) => callIPC('db:get-recording', id),
    getForMeeting: (meetingId) => callIPC('db:get-recordings-for-meeting', meetingId),
    updateStatus: (id, status) => callIPC('db:update-recording-status', id, status),
    updateRecordingStatus: (id, status) => callIPC('recordings:updateStatus', id, status),
    updateTranscriptionStatus: (id, status) => callIPC('recordings:updateTranscriptionStatus', id, status),
    linkToMeeting: (recordingId, meetingId, confidence, method) =>
      callIPC('db:link-recording-to-meeting', recordingId, meetingId, confidence, method),
    delete: (id) => callIPC('recordings:delete', id),
    deleteBatch: (ids) => callIPC('recordings:deleteBatch', ids),
    // Recording-Meeting linking dialog methods
    getCandidates: (recordingId) => callIPC('recordings:getCandidates', recordingId),
    getMeetingsNearDate: (date) => callIPC('recordings:getMeetingsNearDate', date),
    selectMeeting: (recordingId, meetingId) => callIPC('recordings:selectMeeting', recordingId, meetingId),
    // External file import
    addExternal: () => callIPC('recordings:addExternal'),
    addExternalByPath: (filePath: string) => callIPC('recordings:addExternalByPath', filePath),
    // Transcription
    transcribe: (recordingId) => callIPC('recordings:transcribe', recordingId),
    addToQueue: (recordingId) => callIPC('recordings:addToQueue', recordingId),
    processQueue: () => callIPC('recordings:processQueue'),
    getTranscriptionStatus: () => callIPC('recordings:getTranscriptionStatus'),
    getTranscriptionQueue: () => callIPC('transcription:getQueue'),
    cancelTranscription: (recordingId: string) => callIPC('transcription:cancel', recordingId),
    cancelAllTranscriptions: () => callIPC('transcription:cancelAll'),
    updateQueueItem: (id: string, status: string, errorMessage?: string) => callIPC('transcription:updateQueueItem', id, status, errorMessage),
  },

  transcripts: {
    getByRecordingId: (recordingId) => callIPC('db:get-transcript', recordingId),
    getByRecordingIds: (recordingIds) => callIPC('db:get-transcripts-by-recording-ids', recordingIds),
    search: (query) => callIPC('db:search-transcripts', query)
  },

  queue: {
    getItems: (status) => callIPC('db:get-queue', status)
  },

  knowledge: {
    getAll: (options) => callIPC('knowledge:getAll', options),
    getById: (id) => callIPC('knowledge:getById', id),
    getByIds: (ids) => callIPC('knowledge:getByIds', ids), // B-CHAT-004
    update: (id, updates) => callIPC('knowledge:update', id, updates)
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

  migration: {
    previewCleanup: () => callIPC('migration:previewCleanup'),
    runCleanup: () => callIPC('migration:runCleanup'),
    runV11: () => callIPC('migration:runV11'),
    rollbackV11: () => callIPC('migration:rollbackV11'),
    getStatus: () => callIPC('migration:getStatus'),
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
    saveToFile: (content, suggestedName) => callIPC('outputs:saveToFile', content, suggestedName)
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
    retryFailed: () => callIPC('download-service:retry-failed'),
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

  // Security Warning Listener
  onSecurityWarning: (callback: (data: { type: string; message: string }) => void) => {
    const handler = (_event: any, data: { type: string; message: string }) => callback(data)
    ipcRenderer.on('security-warning', handler)
    return () => {
      ipcRenderer.removeListener('security-warning', handler)
    }
  }
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)

/**
 * B-SET-004: Expose QA logging check via localStorage bridge.
 * Preload scripts run in context isolation, so they cannot access Zustand stores directly.
 * Instead, read from the persisted localStorage key that the UI store writes to.
 */
function isQaLogsEnabled(): boolean {
  try {
    const stored = localStorage.getItem('hidock-ui-store')
    if (stored) {
      const { state } = JSON.parse(stored)
      return state?.qaLogsEnabled ?? false
    }
  } catch {
    /* fail silently */
  }
  return false
}

// Make isQaLogsEnabled available globally in preload context
contextBridge.exposeInMainWorld('isQaLogsEnabled', isQaLogsEnabled)

// Type augmentation for the window object
declare global {
  interface Window {
    electronAPI: ElectronAPI
    /** B-SET-004: Check if QA logging is enabled via localStorage bridge */
    isQaLogsEnabled: () => boolean
  }
}
