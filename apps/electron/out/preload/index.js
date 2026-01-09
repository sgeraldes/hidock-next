"use strict";
const electron = require("electron");
const callIPC = async (channel, ...args) => {
  const isPolling = ["recordings:getTranscriptionStatus", "db:get-recordings", "knowledge:getAll"].includes(channel);
  try {
    const start = performance.now();
    const result = await electron.ipcRenderer.invoke(channel, ...args);
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
};
const electronAPI = {
  app: {
    restart: () => callIPC("app:restart"),
    info: () => callIPC("app:info")
  },
  config: {
    get: () => callIPC("config:get"),
    set: (config) => callIPC("config:set", config),
    updateSection: (section, values) => callIPC("config:update-section", section, values),
    getValue: (key) => callIPC("config:get-value", key)
  },
  meetings: {
    getAll: (startDate, endDate) => callIPC("db:get-meetings", startDate, endDate),
    getById: (id) => callIPC("db:get-meeting", id),
    getByIds: (ids) => callIPC("db:get-meetings-by-ids", ids),
    getDetails: (id) => callIPC("db:get-meeting-details", id)
  },
  contacts: {
    getAll: (request) => callIPC("contacts:getAll", request),
    getById: (id) => callIPC("contacts:getById", id),
    update: (request) => callIPC("contacts:update", request),
    getForMeeting: (meetingId) => callIPC("contacts:getForMeeting", meetingId)
  },
  projects: {
    getAll: (request) => callIPC("projects:getAll", request),
    getById: (id) => callIPC("projects:getById", id),
    create: (request) => callIPC("projects:create", request),
    update: (request) => callIPC("projects:update", request),
    delete: (id) => callIPC("projects:delete", { id }),
    tagMeeting: (request) => callIPC("projects:tagMeeting", request),
    untagMeeting: (request) => callIPC("projects:untagMeeting", request),
    getForMeeting: (meetingId) => callIPC("projects:getForMeeting", meetingId)
  },
  recordings: {
    getAll: () => callIPC("db:get-recordings"),
    getById: (id) => callIPC("db:get-recording", id),
    getForMeeting: (meetingId) => callIPC("db:get-recordings-for-meeting", meetingId),
    updateStatus: (id, status) => callIPC("db:update-recording-status", id, status),
    linkToMeeting: (recordingId, meetingId, confidence, method) => callIPC("db:link-recording-to-meeting", recordingId, meetingId, confidence, method),
    delete: (id) => callIPC("recordings:delete", id),
    // Recording-Meeting linking dialog methods
    getCandidates: (recordingId) => callIPC("recordings:getCandidates", recordingId),
    getMeetingsNearDate: (date) => callIPC("recordings:getMeetingsNearDate", date),
    selectMeeting: (recordingId, meetingId) => callIPC("recordings:selectMeeting", recordingId, meetingId),
    // External file import
    addExternal: () => callIPC("recordings:addExternal"),
    // Transcription
    transcribe: (recordingId) => callIPC("recordings:transcribe", recordingId),
    addToQueue: (recordingId) => callIPC("recordings:addToQueue", recordingId),
    processQueue: () => callIPC("recordings:processQueue"),
    getTranscriptionStatus: () => callIPC("recordings:getTranscriptionStatus")
  },
  transcripts: {
    getByRecordingId: (recordingId) => callIPC("db:get-transcript", recordingId),
    getByRecordingIds: (recordingIds) => callIPC("db:get-transcripts-by-recording-ids", recordingIds),
    search: (query) => callIPC("db:search-transcripts", query)
  },
  queue: {
    getItems: (status) => callIPC("db:get-queue", status)
  },
  knowledge: {
    getAll: (options) => callIPC("knowledge:getAll", options),
    getById: (id) => callIPC("knowledge:getById", id),
    update: (id, updates) => callIPC("knowledge:update", id, updates)
  },
  actionables: {
    getAll: (options) => callIPC("actionables:getAll", options),
    updateStatus: (id, status) => callIPC("actionables:updateStatus", id, status),
    generateOutput: (actionableId) => callIPC("actionables:generateOutput", actionableId)
  },
  assistant: {
    getConversations: () => callIPC("assistant:getConversations"),
    createConversation: (title) => callIPC("assistant:createConversation", title),
    deleteConversation: (id) => callIPC("assistant:deleteConversation", id),
    getMessages: (conversationId) => callIPC("assistant:getMessages", conversationId),
    addMessage: (conversationId, role, content, sources) => callIPC("assistant:addMessage", conversationId, role, content, sources),
    addContext: (conversationId, knowledgeCaptureId) => callIPC("assistant:addContext", conversationId, knowledgeCaptureId),
    removeContext: (conversationId, knowledgeCaptureId) => callIPC("assistant:removeContext", conversationId, knowledgeCaptureId),
    getContext: (conversationId) => callIPC("assistant:getContext", conversationId)
  },
  chat: {
    getHistory: (limit) => callIPC("db:get-chat-history", limit),
    addMessage: (role, content, sources) => callIPC("db:add-chat-message", role, content, sources),
    clearHistory: () => callIPC("db:clear-chat-history")
  },
  calendar: {
    sync: () => callIPC("calendar:sync"),
    clearAndSync: () => callIPC("calendar:clear-and-sync"),
    getLastSync: () => callIPC("calendar:get-last-sync"),
    setUrl: (url) => callIPC("calendar:set-url", url),
    toggleAutoSync: (enabled) => callIPC("calendar:toggle-auto-sync", enabled),
    setInterval: (minutes) => callIPC("calendar:set-interval", minutes),
    getSettings: () => callIPC("calendar:get-settings")
  },
  storage: {
    getInfo: () => callIPC("storage:get-info"),
    openFolder: (folder) => callIPC("storage:open-folder", folder),
    readRecording: (filePath) => callIPC("storage:read-recording", filePath),
    deleteRecording: (filePath) => callIPC("storage:delete-recording", filePath),
    saveRecording: (filename, data, recordingDateIso) => callIPC("storage:save-recording", filename, data, recordingDateIso)
  },
  syncedFiles: {
    isFileSynced: (originalFilename) => callIPC("db:is-file-synced", originalFilename),
    getSyncedFile: (originalFilename) => callIPC("db:get-synced-file", originalFilename),
    getAll: () => callIPC("db:get-all-synced-files"),
    add: (originalFilename, localFilename, filePath, fileSize) => callIPC("db:add-synced-file", originalFilename, localFilename, filePath, fileSize),
    remove: (originalFilename) => callIPC("db:remove-synced-file", originalFilename),
    getFilenames: () => callIPC("db:get-synced-filenames")
  },
  deviceCache: {
    getAll: () => callIPC("deviceCache:getAll"),
    saveAll: (files) => callIPC("deviceCache:saveAll", files),
    clear: () => callIPC("deviceCache:clear")
  },
  migration: {
    previewCleanup: () => callIPC("migration:previewCleanup"),
    runCleanup: () => callIPC("migration:runCleanup"),
    runV11: () => callIPC("migration:runV11"),
    rollbackV11: () => callIPC("migration:rollbackV11"),
    getStatus: () => callIPC("migration:getStatus"),
    onProgress: (callback) => {
      const handler = (_event, progress) => callback(progress);
      electron.ipcRenderer.on("migration:progress", handler);
      return () => {
        electron.ipcRenderer.removeListener("migration:progress", handler);
      };
    }
  },
  outputs: {
    getTemplates: () => callIPC("outputs:getTemplates"),
    generate: (request) => callIPC("outputs:generate", request),
    copyToClipboard: (content) => callIPC("outputs:copyToClipboard", content),
    saveToFile: (content, suggestedName) => callIPC("outputs:saveToFile", content, suggestedName)
  },
  rag: {
    status: () => callIPC("rag:status"),
    chat: (request) => callIPC("rag:chat", request),
    chatLegacy: (sessionId, message, meetingFilter) => callIPC("rag:chat-legacy", { sessionId, message, meetingFilter }),
    summarizeMeeting: (meetingId) => callIPC("rag:summarize-meeting", meetingId),
    findActionItems: (meetingId) => callIPC("rag:find-action-items", meetingId),
    clearSession: (sessionId) => callIPC("rag:clear-session", sessionId),
    stats: () => callIPC("rag:stats"),
    indexTranscript: (transcript, metadata) => callIPC("rag:index-transcript", { transcript, metadata }),
    search: (query, limit) => callIPC("rag:search", { query, limit }),
    getChunks: () => callIPC("rag:get-chunks")
  },
  downloadService: {
    getState: () => callIPC("download-service:get-state"),
    isFileSynced: (filename) => callIPC("download-service:is-file-synced", filename),
    getFilesToSync: (files) => callIPC("download-service:get-files-to-sync", files),
    queueDownloads: (files) => callIPC("download-service:queue-downloads", files),
    startSession: (files) => callIPC("download-service:start-session", files),
    processDownload: (filename, data) => callIPC("download-service:process-download", filename, data),
    updateProgress: (filename, bytesReceived) => callIPC("download-service:update-progress", filename, bytesReceived),
    markFailed: (filename, error) => callIPC("download-service:mark-failed", filename, error),
    clearCompleted: () => callIPC("download-service:clear-completed"),
    cancelAll: () => callIPC("download-service:cancel-all"),
    getStats: () => callIPC("download-service:get-stats"),
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
    get: (recordingId) => callIPC("quality:get", recordingId),
    set: (recordingId, quality, reason, assessedBy) => callIPC("quality:set", recordingId, quality, reason, assessedBy),
    autoAssess: (recordingId) => callIPC("quality:auto-assess", recordingId),
    getByQuality: (quality) => callIPC("quality:get-by-quality", quality),
    batchAutoAssess: (recordingIds) => callIPC("quality:batch-auto-assess", recordingIds),
    assessUnassessed: () => callIPC("quality:assess-unassessed")
  },
  // Storage Policy API
  storagePolicy: {
    getByTier: (tier) => callIPC("storage:get-by-tier", tier),
    getCleanupSuggestions: (minAgeOverride) => callIPC("storage:get-cleanup-suggestions", minAgeOverride),
    getCleanupSuggestionsForTier: (tier, minAgeDays) => callIPC("storage:get-cleanup-suggestions-for-tier", tier, minAgeDays),
    executeCleanup: (recordingIds, archive) => callIPC("storage:execute-cleanup", recordingIds, archive),
    getStats: () => callIPC("storage:get-stats"),
    initializeUntiered: () => callIPC("storage:initialize-untiered"),
    assignTier: (recordingId, quality) => callIPC("storage:assign-tier", recordingId, quality)
  },
  // Data Integrity Service API
  integrity: {
    runScan: () => callIPC("integrity:run-scan"),
    getReport: () => callIPC("integrity:get-report"),
    repairIssue: (issueId) => callIPC("integrity:repair-issue", issueId),
    repairAll: () => callIPC("integrity:repair-all"),
    runStartupChecks: () => callIPC("integrity:run-startup-checks"),
    cleanupWronglyNamed: () => callIPC("integrity:cleanup-wrongly-named"),
    purgeMissingFiles: () => callIPC("integrity:purge-missing-files"),
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
  },
  // Recording Watcher Event Listener
  onRecordingAdded: (callback) => {
    const handler = (_event, data) => callback(data);
    electron.ipcRenderer.on("recording:new", handler);
    return () => {
      electron.ipcRenderer.removeListener("recording:new", handler);
    };
  }
};
electron.contextBridge.exposeInMainWorld("electronAPI", electronAPI);
