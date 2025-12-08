import { contextBridge, ipcRenderer } from 'electron'

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
    getDetails: (id: string) => Promise<any>
  }

  // Database - Recordings
  recordings: {
    getAll: () => Promise<any[]>
    getById: (id: string) => Promise<any>
    getForMeeting: (meetingId: string) => Promise<any[]>
    updateStatus: (id: string, status: string) => Promise<any>
    linkToMeeting: (recordingId: string, meetingId: string, confidence: number, method: string) => Promise<any>
  }

  // Database - Transcripts
  transcripts: {
    getByRecordingId: (recordingId: string) => Promise<any>
    search: (query: string) => Promise<any[]>
  }

  // Database - Queue
  queue: {
    getItems: (status?: string) => Promise<any[]>
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
    saveRecording: (filename: string, data: number[]) => Promise<string>
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

  // RAG Chatbot
  rag: {
    status: () => Promise<{
      ollamaAvailable: boolean
      documentCount: number
      meetingCount: number
      ready: boolean
    }>
    chat: (sessionId: string, message: string, meetingFilter?: string) => Promise<{
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
    summarizeMeeting: (meetingId: string) => Promise<string | null>
    findActionItems: (meetingId?: string) => Promise<string | null>
    clearSession: (sessionId: string) => Promise<boolean>
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
    getDetails: (id) => ipcRenderer.invoke('db:get-meeting-details', id)
  },

  recordings: {
    getAll: () => ipcRenderer.invoke('db:get-recordings'),
    getById: (id) => ipcRenderer.invoke('db:get-recording', id),
    getForMeeting: (meetingId) => ipcRenderer.invoke('db:get-recordings-for-meeting', meetingId),
    updateStatus: (id, status) => ipcRenderer.invoke('db:update-recording-status', id, status),
    linkToMeeting: (recordingId, meetingId, confidence, method) =>
      ipcRenderer.invoke('db:link-recording-to-meeting', recordingId, meetingId, confidence, method)
  },

  transcripts: {
    getByRecordingId: (recordingId) => ipcRenderer.invoke('db:get-transcript', recordingId),
    search: (query) => ipcRenderer.invoke('db:search-transcripts', query)
  },

  queue: {
    getItems: (status) => ipcRenderer.invoke('db:get-queue', status)
  },

  chat: {
    getHistory: (limit) => ipcRenderer.invoke('db:get-chat-history', limit),
    addMessage: (role, content, sources) => ipcRenderer.invoke('db:add-chat-message', role, content, sources),
    clearHistory: () => ipcRenderer.invoke('db:clear-chat-history')
  },

  calendar: {
    sync: () => ipcRenderer.invoke('calendar:sync'),
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
    saveRecording: (filename, data) => ipcRenderer.invoke('storage:save-recording', filename, data)
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

  rag: {
    status: () => ipcRenderer.invoke('rag:status'),
    chat: (sessionId, message, meetingFilter) =>
      ipcRenderer.invoke('rag:chat', { sessionId, message, meetingFilter }),
    summarizeMeeting: (meetingId) => ipcRenderer.invoke('rag:summarize-meeting', meetingId),
    findActionItems: (meetingId) => ipcRenderer.invoke('rag:find-action-items', meetingId),
    clearSession: (sessionId) => ipcRenderer.invoke('rag:clear-session', sessionId),
    stats: () => ipcRenderer.invoke('rag:stats'),
    indexTranscript: (transcript, metadata) =>
      ipcRenderer.invoke('rag:index-transcript', { transcript, metadata }),
    search: (query, limit) => ipcRenderer.invoke('rag:search', { query, limit }),
    getChunks: () => ipcRenderer.invoke('rag:get-chunks')
  }
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)

// Type augmentation for the window object
declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
