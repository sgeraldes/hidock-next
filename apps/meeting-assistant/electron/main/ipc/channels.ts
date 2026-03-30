/**
 * IPC channel definitions organized by domain.
 * All channels in one place to prevent typos and enable easy discovery.
 */

export const CHANNELS = {
  session: {
    // Invoke channels
    list: "session:list",
    create: "session:create",
    get: "session:get",
    end: "session:end",
    delete: "session:delete",
    linkMeeting: "session:linkMeeting",
    // Push events (main -> renderer)
    onCreated: "session:created",
    onUpdated: "session:updated",
    onDeleted: "session:deleted",
    onStatusChanged: "session:statusChanged",
  },

  transcript: {
    // Invoke channels
    getSegments: "transcript:getSegments",
    getRecent: "transcript:getRecent",
    // Push events
    onNewSegments: "transcript:newSegments",
    onInterimResult: "transcript:interimResult",
    onError: "transcript:error",
    onStatus: "transcript:status",
  },

  suggestion: {
    // Invoke channels
    getActive: "suggestion:getActive",
    dismiss: "suggestion:dismiss",
    // Push events
    onUpdated: "suggestion:updated",
    onCleared: "suggestion:cleared",
  },

  notes: {
    // Invoke channels
    generate: "notes:generate",
    getForSession: "notes:getForSession",
    update: "notes:update",
    listTemplates: "notes:listTemplates",
    categorize: "notes:categorize",
    // Push events
    onGenerationProgress: "notes:generationProgress",
  },

  screenshot: {
    // Invoke channels
    capture: "screenshot:capture",
    listForSession: "screenshot:listForSession",
    getAnalysis: "screenshot:getAnalysis",
    configure: "screenshot:configure",
    // Push events
    onCaptured: "screenshot:captured",
    onAnalysisReady: "screenshot:analysisReady",
  },

  settings: {
    // Invoke channels
    get: "settings:get",
    set: "settings:set",
    getAll: "settings:getAll",
    getCategory: "settings:getCategory",
    testConnection: "settings:testConnection",
    // Push events
    onChanged: "settings:changed",
  },

  knowledge: {
    // Invoke channels
    addSource: "kb:addSource",
    removeSource: "kb:removeSource",
    search: "kb:search",
    reindex: "kb:reindex",
    // Push events
    onIndexProgress: "kb:indexProgress",
    onIndexComplete: "kb:indexComplete",
  },
} as const;
