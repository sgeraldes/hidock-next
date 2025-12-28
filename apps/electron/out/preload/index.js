"use strict";
const electron = require("electron");
const electronAPI = {
  app: {
    restart: () => electron.ipcRenderer.invoke("app:restart"),
    info: () => electron.ipcRenderer.invoke("app:info")
  },
  config: {
    get: () => electron.ipcRenderer.invoke("config:get"),
    set: (config) => electron.ipcRenderer.invoke("config:set", config),
    updateSection: (section, values) => electron.ipcRenderer.invoke("config:update-section", section, values),
    getValue: (key) => electron.ipcRenderer.invoke("config:get-value", key)
  },
  meetings: {
    getAll: (startDate, endDate) => electron.ipcRenderer.invoke("db:get-meetings", startDate, endDate),
    getById: (id) => electron.ipcRenderer.invoke("db:get-meeting", id),
    getByIds: (ids) => electron.ipcRenderer.invoke("db:get-meetings-by-ids", ids),
    getDetails: (id) => electron.ipcRenderer.invoke("db:get-meeting-details", id)
  },
  contacts: {
    getAll: (request) => electron.ipcRenderer.invoke("contacts:getAll", request),
    getById: (id) => electron.ipcRenderer.invoke("contacts:getById", id),
    update: (request) => electron.ipcRenderer.invoke("contacts:update", request),
    getForMeeting: (meetingId) => electron.ipcRenderer.invoke("contacts:getForMeeting", meetingId)
  },
  projects: {
    getAll: (request) => electron.ipcRenderer.invoke("projects:getAll", request),
    getById: (id) => electron.ipcRenderer.invoke("projects:getById", id),
    create: (request) => electron.ipcRenderer.invoke("projects:create", request),
    update: (request) => electron.ipcRenderer.invoke("projects:update", request),
    delete: (id) => electron.ipcRenderer.invoke("projects:delete", { id }),
    tagMeeting: (request) => electron.ipcRenderer.invoke("projects:tagMeeting", request),
    untagMeeting: (request) => electron.ipcRenderer.invoke("projects:untagMeeting", request),
    getForMeeting: (meetingId) => electron.ipcRenderer.invoke("projects:getForMeeting", meetingId)
  },
  recordings: {
    getAll: () => electron.ipcRenderer.invoke("db:get-recordings"),
    getById: (id) => electron.ipcRenderer.invoke("db:get-recording", id),
    getForMeeting: (meetingId) => electron.ipcRenderer.invoke("db:get-recordings-for-meeting", meetingId),
    updateStatus: (id, status) => electron.ipcRenderer.invoke("db:update-recording-status", id, status),
    linkToMeeting: (recordingId, meetingId, confidence, method) => electron.ipcRenderer.invoke("db:link-recording-to-meeting", recordingId, meetingId, confidence, method),
    delete: (id) => electron.ipcRenderer.invoke("recordings:delete", id),
    // Recording-Meeting linking dialog methods
    getCandidates: (recordingId) => electron.ipcRenderer.invoke("recordings:getCandidates", recordingId),
    getMeetingsNearDate: (date) => electron.ipcRenderer.invoke("recordings:getMeetingsNearDate", date),
    selectMeeting: (recordingId, meetingId) => electron.ipcRenderer.invoke("recordings:selectMeeting", recordingId, meetingId),
    // External file import
    addExternal: () => electron.ipcRenderer.invoke("recordings:addExternal"),
    // Transcription
    transcribe: (recordingId) => electron.ipcRenderer.invoke("recordings:transcribe", recordingId),
    addToQueue: (recordingId) => electron.ipcRenderer.invoke("recordings:addToQueue", recordingId),
    processQueue: () => electron.ipcRenderer.invoke("recordings:processQueue"),
    getTranscriptionStatus: () => electron.ipcRenderer.invoke("recordings:getTranscriptionStatus")
  },
  transcripts: {
    getByRecordingId: (recordingId) => electron.ipcRenderer.invoke("db:get-transcript", recordingId),
    getByRecordingIds: (recordingIds) => electron.ipcRenderer.invoke("db:get-transcripts-by-recording-ids", recordingIds),
    search: (query) => electron.ipcRenderer.invoke("db:search-transcripts", query)
  },
  queue: {
    getItems: (status) => electron.ipcRenderer.invoke("db:get-queue", status)
  },
  knowledge: {
    getAll: (options) => electron.ipcRenderer.invoke("knowledge:getAll", options),
    getById: (id) => electron.ipcRenderer.invoke("knowledge:getById", id),
    update: (id, updates) => electron.ipcRenderer.invoke("knowledge:update", id, updates)
  },
  actionables: {
    getAll: (options) => electron.ipcRenderer.invoke("actionables:getAll", options),
    updateStatus: (id, status) => electron.ipcRenderer.invoke("actionables:updateStatus", id, status)
  },
  assistant: {
    getConversations: () => electron.ipcRenderer.invoke("assistant:getConversations"),
    createConversation: (title) => electron.ipcRenderer.invoke("assistant:createConversation", title),
    deleteConversation: (id) => electron.ipcRenderer.invoke("assistant:deleteConversation", id),
    getMessages: (conversationId) => electron.ipcRenderer.invoke("assistant:getMessages", conversationId),
    addMessage: (conversationId, role, content, sources) => electron.ipcRenderer.invoke("assistant:addMessage", conversationId, role, content, sources),
    addContext: (conversationId, knowledgeCaptureId) => electron.ipcRenderer.invoke("assistant:addContext", conversationId, knowledgeCaptureId),
    removeContext: (conversationId, knowledgeCaptureId) => electron.ipcRenderer.invoke("assistant:removeContext", conversationId, knowledgeCaptureId),
    getContext: (conversationId) => electron.ipcRenderer.invoke("assistant:getContext", conversationId)
  },
  chat: {
    getHistory: (limit) => electron.ipcRenderer.invoke("db:get-chat-history", limit),
    addMessage: (role, content, sources) => electron.ipcRenderer.invoke("db:add-chat-message", role, content, sources),
    clearHistory: () => electron.ipcRenderer.invoke("db:clear-chat-history")
  },
  calendar: {
    sync: () => electron.ipcRenderer.invoke("calendar:sync"),
    clearAndSync: () => electron.ipcRenderer.invoke("calendar:clear-and-sync"),
    getLastSync: () => electron.ipcRenderer.invoke("calendar:get-last-sync"),
    setUrl: (url) => electron.ipcRenderer.invoke("calendar:set-url", url),
    toggleAutoSync: (enabled) => electron.ipcRenderer.invoke("calendar:toggle-auto-sync", enabled),
    setInterval: (minutes) => electron.ipcRenderer.invoke("calendar:set-interval", minutes),
    getSettings: () => electron.ipcRenderer.invoke("calendar:get-settings")
  },
  storage: {
    getInfo: () => electron.ipcRenderer.invoke("storage:get-info"),
    openFolder: (folder) => electron.ipcRenderer.invoke("storage:open-folder", folder),
    readRecording: (filePath) => electron.ipcRenderer.invoke("storage:read-recording", filePath),
    deleteRecording: (filePath) => electron.ipcRenderer.invoke("storage:delete-recording", filePath),
    saveRecording: (filename, data, recordingDateIso) => electron.ipcRenderer.invoke("storage:save-recording", filename, data, recordingDateIso)
  },
  syncedFiles: {
    isFileSynced: (originalFilename) => electron.ipcRenderer.invoke("db:is-file-synced", originalFilename),
    getSyncedFile: (originalFilename) => electron.ipcRenderer.invoke("db:get-synced-file", originalFilename),
    getAll: () => electron.ipcRenderer.invoke("db:get-all-synced-files"),
    add: (originalFilename, localFilename, filePath, fileSize) => electron.ipcRenderer.invoke("db:add-synced-file", originalFilename, localFilename, filePath, fileSize),
    remove: (originalFilename) => electron.ipcRenderer.invoke("db:remove-synced-file", originalFilename),
    getFilenames: () => electron.ipcRenderer.invoke("db:get-synced-filenames")
  },
  deviceCache: {
    getAll: () => electron.ipcRenderer.invoke("deviceCache:getAll"),
    saveAll: (files) => electron.ipcRenderer.invoke("deviceCache:saveAll", files),
    clear: () => electron.ipcRenderer.invoke("deviceCache:clear")
  },
  migration: {
    previewCleanup: () => electron.ipcRenderer.invoke("migration:previewCleanup"),
    runCleanup: () => electron.ipcRenderer.invoke("migration:runCleanup"),
    runV11: () => electron.ipcRenderer.invoke("migration:runV11"),
    rollbackV11: () => electron.ipcRenderer.invoke("migration:rollbackV11"),
    getStatus: () => electron.ipcRenderer.invoke("migration:getStatus"),
    onProgress: (callback) => {
      const handler = (_event, progress) => callback(progress);
      electron.ipcRenderer.on("migration:progress", handler);
      return () => {
        electron.ipcRenderer.removeListener("migration:progress", handler);
      };
    }
  },
  outputs: {
    getTemplates: () => electron.ipcRenderer.invoke("outputs:getTemplates"),
    generate: (request) => electron.ipcRenderer.invoke("outputs:generate", request),
    copyToClipboard: (content) => electron.ipcRenderer.invoke("outputs:copyToClipboard", content),
    saveToFile: (content, suggestedName) => electron.ipcRenderer.invoke("outputs:saveToFile", content, suggestedName)
  },
  rag: {
    status: () => electron.ipcRenderer.invoke("rag:status"),
    chat: (request) => electron.ipcRenderer.invoke("rag:chat", request),
    chatLegacy: (sessionId, message, meetingFilter) => electron.ipcRenderer.invoke("rag:chat-legacy", { sessionId, message, meetingFilter }),
    summarizeMeeting: (meetingId) => electron.ipcRenderer.invoke("rag:summarize-meeting", meetingId),
    findActionItems: (meetingId) => electron.ipcRenderer.invoke("rag:find-action-items", meetingId),
    clearSession: (sessionId) => electron.ipcRenderer.invoke("rag:clear-session", sessionId),
    stats: () => electron.ipcRenderer.invoke("rag:stats"),
    indexTranscript: (transcript, metadata) => electron.ipcRenderer.invoke("rag:index-transcript", { transcript, metadata }),
    search: (query, limit) => electron.ipcRenderer.invoke("rag:search", { query, limit }),
    getChunks: () => electron.ipcRenderer.invoke("rag:get-chunks")
  },
  downloadService: {
    getState: () => electron.ipcRenderer.invoke("download-service:get-state"),
    isFileSynced: (filename) => electron.ipcRenderer.invoke("download-service:is-file-synced", filename),
    getFilesToSync: (files) => electron.ipcRenderer.invoke("download-service:get-files-to-sync", files),
    queueDownloads: (files) => electron.ipcRenderer.invoke("download-service:queue-downloads", files),
    startSession: (files) => electron.ipcRenderer.invoke("download-service:start-session", files),
    processDownload: (filename, data) => electron.ipcRenderer.invoke("download-service:process-download", filename, data),
    updateProgress: (filename, bytesReceived) => electron.ipcRenderer.invoke("download-service:update-progress", filename, bytesReceived),
    markFailed: (filename, error) => electron.ipcRenderer.invoke("download-service:mark-failed", filename, error),
    clearCompleted: () => electron.ipcRenderer.invoke("download-service:clear-completed"),
    cancelAll: () => electron.ipcRenderer.invoke("download-service:cancel-all"),
    getStats: () => electron.ipcRenderer.invoke("download-service:get-stats"),
    onStateUpdate: (callback) => {
      const handler = (_event, state) => callback(state);
      electron.ipcRenderer.on("download-service:state-update", handler);
      return () => {
        electron.ipcRenderer.removeListener("download-service:state-update", handler);
      };
    }
  },
  // Quality Assessment API
  quality: {
    get: (recordingId) => electron.ipcRenderer.invoke("quality:get", recordingId),
    set: (recordingId, quality, reason, assessedBy) => electron.ipcRenderer.invoke("quality:set", recordingId, quality, reason, assessedBy),
    autoAssess: (recordingId) => electron.ipcRenderer.invoke("quality:auto-assess", recordingId),
    getByQuality: (quality) => electron.ipcRenderer.invoke("quality:get-by-quality", quality),
    batchAutoAssess: (recordingIds) => electron.ipcRenderer.invoke("quality:batch-auto-assess", recordingIds),
    assessUnassessed: () => electron.ipcRenderer.invoke("quality:assess-unassessed")
  },
  // Storage Policy API
  storagePolicy: {
    getByTier: (tier) => electron.ipcRenderer.invoke("storage:get-by-tier", tier),
    getCleanupSuggestions: (minAgeOverride) => electron.ipcRenderer.invoke("storage:get-cleanup-suggestions", minAgeOverride),
    getCleanupSuggestionsForTier: (tier, minAgeDays) => electron.ipcRenderer.invoke("storage:get-cleanup-suggestions-for-tier", tier, minAgeDays),
    executeCleanup: (recordingIds, archive) => electron.ipcRenderer.invoke("storage:execute-cleanup", recordingIds, archive),
    getStats: () => electron.ipcRenderer.invoke("storage:get-stats"),
    initializeUntiered: () => electron.ipcRenderer.invoke("storage:initialize-untiered"),
    assignTier: (recordingId, quality) => electron.ipcRenderer.invoke("storage:assign-tier", recordingId, quality)
  },
  // Data Integrity Service API
  integrity: {
    runScan: () => electron.ipcRenderer.invoke("integrity:run-scan"),
    getReport: () => electron.ipcRenderer.invoke("integrity:get-report"),
    repairIssue: (issueId) => electron.ipcRenderer.invoke("integrity:repair-issue", issueId),
    repairAll: () => electron.ipcRenderer.invoke("integrity:repair-all"),
    runStartupChecks: () => electron.ipcRenderer.invoke("integrity:run-startup-checks"),
    cleanupWronglyNamed: () => electron.ipcRenderer.invoke("integrity:cleanup-wrongly-named"),
    purgeMissingFiles: () => electron.ipcRenderer.invoke("integrity:purge-missing-files"),
    onProgress: (callback) => {
      const handler = (_event, progress) => callback(progress);
      electron.ipcRenderer.on("integrity:progress", handler);
      return () => {
        electron.ipcRenderer.removeListener("integrity:progress", handler);
      };
    }
  },
  // Domain Event Listener
  onDomainEvent: (callback) => {
    const handler = (_event, domainEvent) => callback(domainEvent);
    electron.ipcRenderer.on("domain-event", handler);
    return () => {
      electron.ipcRenderer.removeListener("domain-event", handler);
    };
  }
};
electron.contextBridge.exposeInMainWorld("electronAPI", electronAPI);
