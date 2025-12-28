import { contextBridge, ipcRenderer } from 'electron'

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
  }

  // Contacts
  contacts: {
    getAll: (request?: GetContactsRequest) => Promise<Result<GetContactsResponse>>
    getById: (id: string) => Promise<Result<ContactWithMeetings>>
    update: (request: UpdateContactRequest) => Promise<Result<Contact>>
    getForMeeting: (meetingId: string) => Promise<Result<Contact[]>>
  }

  // Projects
  projects: {
    getAll: (request?: GetProjectsRequest) => Promise<Result<GetProjectsResponse>>
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
    linkToMeeting: (recordingId: string, meetingId: string, confidence: number, method: string) => Promise<any>
    delete: (id: string) => Promise<boolean>
    // Recording-Meeting linking dialog methods
    getCandidates: (recordingId: string) => Promise<{ success: boolean; data: any[]; error?: string }>
    getMeetingsNearDate: (date: string) => Promise<{ success: boolean; data: any[]; error?: string }>
    selectMeeting: (recordingId: string, meetingId: string | null) => Promise<{ success: boolean; error?: string }>
    // External file import
    addExternal: () => Promise<{ success: boolean; recording?: any; error?: string }>
    // Transcription
    transcribe: (recordingId: string) => Promise<void>
    addToQueue: (recordingId: string) => Promise<boolean>
    processQueue: () => Promise<boolean>
    getTranscriptionStatus: () => Promise<{ isProcessing: boolean; pendingCount: number; processingCount: number }>
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
    update: (id: string, updates: Partial<KnowledgeCapture>) => Promise<{ success: boolean; error?: string }>
  }

  // Actionables
  actionables: {
    getAll: (options?: { status?: string }) => Promise<Actionable[]>
    updateStatus: (id: string, status: string) => Promise<{ success: boolean; error?: string }>
  }

  // Assistant
  assistant: {
    getConversations: () => Promise<Conversation[]>
    createConversation: (title?: string) => Promise<Conversation>
    deleteConversation: (id: string) => Promise<{ success: boolean; error?: string }>
    getMessages: (conversationId: string) => Promise<Message[]>
    addMessage: (conversationId: string, role: 'user' | 'assistant', content: string, sources?: string) => Promise<Message>
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
    readRecording: (filePath: string) => Promise<string | null>
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
  }

  // Download Service - Centralized background download manager
  downloadService: {
    getState: () => Promise<{
      queue: Array<{
        id: string
        filename: string
        fileSize: number
        progress: number
        status: 'pending' | 'downloading' | 'completed' | 'failed'
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
    processDownload: (filename: string, data: number[]) => Promise<{ success: boolean; filePath?: string; error?: string }>
    updateProgress: (filename: string, bytesReceived: number) => Promise<void>
    markFailed: (filename: string, error: string) => Promise<void>
    clearCompleted: () => Promise<void>
    cancelAll: () => Promise<void>
    getStats: () => Promise<{ totalSynced: number; pendingInQueue: number; failedInQueue: number }>
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
}

// Expose the API to the renderer process
const electronAPI: ElectronAPI = {
  app: {
    restart: () => ipcRenderer.invoke('app:restart'),
    info: () => ipcRenderer.invoke('app:info')
  },

  config: {
    get: () => ipcRenderer.invoke('config:get'),
    set: (config) => ipcRenderer.invoke('config:set', config),
    updateSection: (section, values) => ipcRenderer.invoke('config:update-section', section, values),
    getValue: (key) => ipcRenderer.invoke('config:get-value', key)
  },

  meetings: {
    getAll: (startDate, endDate) => ipcRenderer.invoke('db:get-meetings', startDate, endDate),
    getById: (id) => ipcRenderer.invoke('db:get-meeting', id),
    getByIds: (ids) => ipcRenderer.invoke('db:get-meetings-by-ids', ids),
    getDetails: (id) => ipcRenderer.invoke('db:get-meeting-details', id)
  },

  contacts: {
    getAll: (request) => ipcRenderer.invoke('contacts:getAll', request),
    getById: (id) => ipcRenderer.invoke('contacts:getById', id),
    update: (request) => ipcRenderer.invoke('contacts:update', request),
    getForMeeting: (meetingId) => ipcRenderer.invoke('contacts:getForMeeting', meetingId)
  },

  projects: {
    getAll: (request) => ipcRenderer.invoke('projects:getAll', request),
    getById: (id) => ipcRenderer.invoke('projects:getById', id),
    create: (request) => ipcRenderer.invoke('projects:create', request),
    update: (request) => ipcRenderer.invoke('projects:update', request),
    delete: (id) => ipcRenderer.invoke('projects:delete', { id }),
    tagMeeting: (request) => ipcRenderer.invoke('projects:tagMeeting', request),
    untagMeeting: (request) => ipcRenderer.invoke('projects:untagMeeting', request),
    getForMeeting: (meetingId) => ipcRenderer.invoke('projects:getForMeeting', meetingId)
  },

  recordings: {
    getAll: () => ipcRenderer.invoke('db:get-recordings'),
    getById: (id) => ipcRenderer.invoke('db:get-recording', id),
    getForMeeting: (meetingId) => ipcRenderer.invoke('db:get-recordings-for-meeting', meetingId),
    updateStatus: (id, status) => ipcRenderer.invoke('db:update-recording-status', id, status),
    linkToMeeting: (recordingId, meetingId, confidence, method) =>
      ipcRenderer.invoke('db:link-recording-to-meeting', recordingId, meetingId, confidence, method),
    delete: (id) => ipcRenderer.invoke('recordings:delete', id),
    // Recording-Meeting linking dialog methods
    getCandidates: (recordingId) => ipcRenderer.invoke('recordings:getCandidates', recordingId),
    getMeetingsNearDate: (date) => ipcRenderer.invoke('recordings:getMeetingsNearDate', date),
    selectMeeting: (recordingId, meetingId) => ipcRenderer.invoke('recordings:selectMeeting', recordingId, meetingId),
    // External file import
    addExternal: () => ipcRenderer.invoke('recordings:addExternal'),
    // Transcription
    transcribe: (recordingId) => ipcRenderer.invoke('recordings:transcribe', recordingId),
    addToQueue: (recordingId) => ipcRenderer.invoke('recordings:addToQueue', recordingId),
    processQueue: () => ipcRenderer.invoke('recordings:processQueue'),
    getTranscriptionStatus: () => ipcRenderer.invoke('recordings:getTranscriptionStatus')
  },

  transcripts: {
    getByRecordingId: (recordingId) => ipcRenderer.invoke('db:get-transcript', recordingId),
    getByRecordingIds: (recordingIds) => ipcRenderer.invoke('db:get-transcripts-by-recording-ids', recordingIds),
    search: (query) => ipcRenderer.invoke('db:search-transcripts', query)
  },

  queue: {
    getItems: (status) => ipcRenderer.invoke('db:get-queue', status)
  },

  knowledge: {
    getAll: (options) => ipcRenderer.invoke('knowledge:getAll', options),
    getById: (id) => ipcRenderer.invoke('knowledge:getById', id),
    update: (id, updates) => ipcRenderer.invoke('knowledge:update', id, updates)
  },

  actionables: {
    getAll: (options) => ipcRenderer.invoke('actionables:getAll', options),
    updateStatus: (id, status) => ipcRenderer.invoke('actionables:updateStatus', id, status)
  },

  assistant: {
    getConversations: () => ipcRenderer.invoke('assistant:getConversations'),
    createConversation: (title) => ipcRenderer.invoke('assistant:createConversation', title),
    deleteConversation: (id) => ipcRenderer.invoke('assistant:deleteConversation', id),
    getMessages: (conversationId) => ipcRenderer.invoke('assistant:getMessages', conversationId),
    addMessage: (conversationId, role, content, sources) => ipcRenderer.invoke('assistant:addMessage', conversationId, role, content, sources),
    addContext: (conversationId, knowledgeCaptureId) => ipcRenderer.invoke('assistant:addContext', conversationId, knowledgeCaptureId),
    removeContext: (conversationId, knowledgeCaptureId) => ipcRenderer.invoke('assistant:removeContext', conversationId, knowledgeCaptureId),
    getContext: (conversationId) => ipcRenderer.invoke('assistant:getContext', conversationId)
  },

  chat: {
    getHistory: (limit) => ipcRenderer.invoke('db:get-chat-history', limit),
    addMessage: (role, content, sources) => ipcRenderer.invoke('db:add-chat-message', role, content, sources),
    clearHistory: () => ipcRenderer.invoke('db:clear-chat-history')
  },

  calendar: {
    sync: () => ipcRenderer.invoke('calendar:sync'),
    clearAndSync: () => ipcRenderer.invoke('calendar:clear-and-sync'),
    getLastSync: () => ipcRenderer.invoke('calendar:get-last-sync'),
    setUrl: (url) => ipcRenderer.invoke('calendar:set-url', url),
    toggleAutoSync: (enabled) => ipcRenderer.invoke('calendar:toggle-auto-sync', enabled),
    setInterval: (minutes) => ipcRenderer.invoke('calendar:set-interval', minutes),
    getSettings: () => ipcRenderer.invoke('calendar:get-settings')
  },

  storage: {
    getInfo: () => ipcRenderer.invoke('storage:get-info'),
    openFolder: (folder) => ipcRenderer.invoke('storage:open-folder', folder),
    readRecording: (filePath) => ipcRenderer.invoke('storage:read-recording', filePath),
    deleteRecording: (filePath) => ipcRenderer.invoke('storage:delete-recording', filePath),
    saveRecording: (filename, data, recordingDateIso) => ipcRenderer.invoke('storage:save-recording', filename, data, recordingDateIso)
  },

  syncedFiles: {
    isFileSynced: (originalFilename) => ipcRenderer.invoke('db:is-file-synced', originalFilename),
    getSyncedFile: (originalFilename) => ipcRenderer.invoke('db:get-synced-file', originalFilename),
    getAll: () => ipcRenderer.invoke('db:get-all-synced-files'),
    add: (originalFilename, localFilename, filePath, fileSize) =>
      ipcRenderer.invoke('db:add-synced-file', originalFilename, localFilename, filePath, fileSize),
    remove: (originalFilename) => ipcRenderer.invoke('db:remove-synced-file', originalFilename),
    getFilenames: () => ipcRenderer.invoke('db:get-synced-filenames')
  },

  deviceCache: {
    getAll: () => ipcRenderer.invoke('deviceCache:getAll'),
    saveAll: (files) => ipcRenderer.invoke('deviceCache:saveAll', files),
    clear: () => ipcRenderer.invoke('deviceCache:clear')
  },

  migration: {
    previewCleanup: () => ipcRenderer.invoke('migration:previewCleanup'),
    runCleanup: () => ipcRenderer.invoke('migration:runCleanup'),
    runV11: () => ipcRenderer.invoke('migration:runV11'),
    rollbackV11: () => ipcRenderer.invoke('migration:rollbackV11'),
    getStatus: () => ipcRenderer.invoke('migration:getStatus'),
    onProgress: (callback) => {
      const handler = (_event: any, progress: any) => callback(progress)
      ipcRenderer.on('migration:progress', handler)
      return () => {
        ipcRenderer.removeListener('migration:progress', handler)
      }
    }
  },

  outputs: {
    getTemplates: () => ipcRenderer.invoke('outputs:getTemplates'),
    generate: (request) => ipcRenderer.invoke('outputs:generate', request),
    copyToClipboard: (content) => ipcRenderer.invoke('outputs:copyToClipboard', content),
    saveToFile: (content, suggestedName) => ipcRenderer.invoke('outputs:saveToFile', content, suggestedName)
  },

  rag: {
    status: () => ipcRenderer.invoke('rag:status'),
    chat: (request) => ipcRenderer.invoke('rag:chat', request),
    chatLegacy: (sessionId, message, meetingFilter) =>
      ipcRenderer.invoke('rag:chat-legacy', { sessionId, message, meetingFilter }),
    summarizeMeeting: (meetingId) => ipcRenderer.invoke('rag:summarize-meeting', meetingId),
    findActionItems: (meetingId) => ipcRenderer.invoke('rag:find-action-items', meetingId),
    clearSession: (sessionId) => ipcRenderer.invoke('rag:clear-session', sessionId),
    stats: () => ipcRenderer.invoke('rag:stats'),
    indexTranscript: (transcript, metadata) =>
      ipcRenderer.invoke('rag:index-transcript', { transcript, metadata }),
    search: (query, limit) => ipcRenderer.invoke('rag:search', { query, limit }),
    getChunks: () => ipcRenderer.invoke('rag:get-chunks')
  },

  downloadService: {
    getState: () => ipcRenderer.invoke('download-service:get-state'),
    isFileSynced: (filename) => ipcRenderer.invoke('download-service:is-file-synced', filename),
    getFilesToSync: (files) => ipcRenderer.invoke('download-service:get-files-to-sync', files),
    queueDownloads: (files) => ipcRenderer.invoke('download-service:queue-downloads', files),
    startSession: (files) => ipcRenderer.invoke('download-service:start-session', files),
    processDownload: (filename, data) => ipcRenderer.invoke('download-service:process-download', filename, data),
    updateProgress: (filename, bytesReceived) => ipcRenderer.invoke('download-service:update-progress', filename, bytesReceived),
    markFailed: (filename, error) => ipcRenderer.invoke('download-service:mark-failed', filename, error),
    clearCompleted: () => ipcRenderer.invoke('download-service:clear-completed'),
    cancelAll: () => ipcRenderer.invoke('download-service:cancel-all'),
    getStats: () => ipcRenderer.invoke('download-service:get-stats'),
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
    get: (recordingId: string) => ipcRenderer.invoke('quality:get', recordingId),
    set: (recordingId: string, quality: 'high' | 'medium' | 'low', reason?: string, assessedBy?: string) =>
      ipcRenderer.invoke('quality:set', recordingId, quality, reason, assessedBy),
    autoAssess: (recordingId: string) => ipcRenderer.invoke('quality:auto-assess', recordingId),
    getByQuality: (quality: 'high' | 'medium' | 'low') => ipcRenderer.invoke('quality:get-by-quality', quality),
    batchAutoAssess: (recordingIds: string[]) => ipcRenderer.invoke('quality:batch-auto-assess', recordingIds),
    assessUnassessed: () => ipcRenderer.invoke('quality:assess-unassessed')
  },

  // Storage Policy API
  storagePolicy: {
    getByTier: (tier: 'hot' | 'warm' | 'cold' | 'archive') => ipcRenderer.invoke('storage:get-by-tier', tier),
    getCleanupSuggestions: (minAgeOverride?: Partial<Record<'hot' | 'warm' | 'cold' | 'archive', number>>) =>
      ipcRenderer.invoke('storage:get-cleanup-suggestions', minAgeOverride),
    getCleanupSuggestionsForTier: (tier: 'hot' | 'warm' | 'cold' | 'archive', minAgeDays?: number) =>
      ipcRenderer.invoke('storage:get-cleanup-suggestions-for-tier', tier, minAgeDays),
    executeCleanup: (recordingIds: string[], archive?: boolean) =>
      ipcRenderer.invoke('storage:execute-cleanup', recordingIds, archive),
    getStats: () => ipcRenderer.invoke('storage:get-stats'),
    initializeUntiered: () => ipcRenderer.invoke('storage:initialize-untiered'),
    assignTier: (recordingId: string, quality: 'high' | 'medium' | 'low') =>
      ipcRenderer.invoke('storage:assign-tier', recordingId, quality)
  },

  // Data Integrity Service API
  integrity: {
    runScan: () => ipcRenderer.invoke('integrity:run-scan'),
    getReport: () => ipcRenderer.invoke('integrity:get-report'),
    repairIssue: (issueId: string) => ipcRenderer.invoke('integrity:repair-issue', issueId),
    repairAll: () => ipcRenderer.invoke('integrity:repair-all'),
    runStartupChecks: () => ipcRenderer.invoke('integrity:run-startup-checks'),
    cleanupWronglyNamed: () => ipcRenderer.invoke('integrity:cleanup-wrongly-named'),
    purgeMissingFiles: () => ipcRenderer.invoke('integrity:purge-missing-files'),
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
  }
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)

// Type augmentation for the window object
declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
