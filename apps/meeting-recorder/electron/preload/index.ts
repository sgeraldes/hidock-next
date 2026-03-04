import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  app: {
    info: () => ipcRenderer.invoke("app:info"),
  },

  session: {
    list: () => ipcRenderer.invoke("session:list"),
    create: () => ipcRenderer.invoke("session:create"),
    end: (sessionId: string) => ipcRenderer.invoke("session:end", sessionId),
    get: (sessionId: string) => ipcRenderer.invoke("session:get", sessionId),
    delete: (sessionId: string) =>
      ipcRenderer.invoke("session:delete", sessionId),
    openFileLocation: (sessionId: string) =>
      ipcRenderer.invoke("session:openFileLocation", sessionId),
    deleteTranscript: (sessionId: string) =>
      ipcRenderer.invoke("session:deleteTranscript", sessionId),
    retranscribe: (sessionId: string) =>
      ipcRenderer.invoke("session:retranscribe", sessionId),
    getTranscript: (sessionId: string) =>
      ipcRenderer.invoke("session:getTranscript", sessionId),
    getTopics: (sessionId: string) =>
      ipcRenderer.invoke("session:getTopics", sessionId),
    getActionItems: (sessionId: string) =>
      ipcRenderer.invoke("session:getActionItems", sessionId),
    getSummary: (sessionId: string) =>
      ipcRenderer.invoke("session:getSummary", sessionId),
    renameSpeaker: (sessionId: string, oldName: string, newName: string) =>
      ipcRenderer.invoke("session:renameSpeaker", sessionId, oldName, newName),
    onCreated: (callback: (session: unknown) => void) => {
      const handler = (_: unknown, session: unknown) => callback(session);
      ipcRenderer.on("session:created", handler);
      return () => ipcRenderer.removeListener("session:created", handler);
    },
    onStatusChanged: (callback: (data: unknown) => void) => {
      const handler = (_: unknown, data: unknown) => callback(data);
      ipcRenderer.on("session:statusChanged", handler);
      return () => ipcRenderer.removeListener("session:statusChanged", handler);
    },
  },

  audio: {
    sendChunk: (
      data: ArrayBuffer,
      sessionId: string,
      chunkIndex: number,
      mimeType: string,
    ) => {
      ipcRenderer.send("audio:chunk", data, sessionId, chunkIndex, mimeType);
    },
    getPath: (sessionId: string) =>
      ipcRenderer.invoke("audio:getPath", sessionId),
    readFile: (sessionId: string) =>
      ipcRenderer.invoke("audio:readFile", sessionId),
    onMicStatus: (
      callback: (status: { active: boolean; appName?: string }) => void,
    ) => {
      const handler = (
        _: unknown,
        status: { active: boolean; appName?: string },
      ) => callback(status);
      ipcRenderer.on("audio:micStatus", handler);
      return () => ipcRenderer.removeListener("audio:micStatus", handler);
    },
    onChunkAck: (
      callback: (data: { sessionId: string; chunkIndex: number }) => void,
    ) => {
      const handler = (
        _: unknown,
        data: { sessionId: string; chunkIndex: number },
      ) => callback(data);
      ipcRenderer.on("audio:chunkAck", handler);
      return () => ipcRenderer.removeListener("audio:chunkAck", handler);
    },
    onChunkError: (
      callback: (data: {
        sessionId: string;
        chunkIndex: number;
        error: string;
      }) => void,
    ) => {
      const handler = (
        _: unknown,
        data: { sessionId: string; chunkIndex: number; error: string },
      ) => callback(data);
      ipcRenderer.on("audio:chunkError", handler);
      return () => ipcRenderer.removeListener("audio:chunkError", handler);
    },
  },

  transcription: {
    start: (sessionId: string) =>
      ipcRenderer.invoke("transcription:start", sessionId),
    stop: (sessionId: string) =>
      ipcRenderer.invoke("transcription:stop", sessionId),
    onNewSegments: (callback: (segments: unknown[]) => void) => {
      const handler = (_: unknown, segments: unknown[]) => callback(segments);
      ipcRenderer.on("transcription:newSegments", handler);
      return () =>
        ipcRenderer.removeListener("transcription:newSegments", handler);
    },
    onTopicsUpdated: (callback: (data: { sessionId: string; topics: string[] }) => void) => {
      const handler = (_: unknown, data: { sessionId: string; topics: string[] }) => callback(data);
      ipcRenderer.on("transcription:topicsUpdated", handler);
      return () =>
        ipcRenderer.removeListener("transcription:topicsUpdated", handler);
    },
    onActionItemsUpdated: (callback: (data: { sessionId: string; actionItems: unknown[] }) => void) => {
      const handler = (_: unknown, data: { sessionId: string; actionItems: unknown[] }) => callback(data);
      ipcRenderer.on("transcription:actionItemsUpdated", handler);
      return () =>
        ipcRenderer.removeListener("transcription:actionItemsUpdated", handler);
    },
    onError: (callback: (error: string) => void) => {
      const handler = (_: unknown, error: string) => callback(error);
      ipcRenderer.on("transcription:error", handler);
      return () => ipcRenderer.removeListener("transcription:error", handler);
    },
    onStatus: (callback: (status: string) => void) => {
      const handler = (_: unknown, status: string) => callback(status);
      ipcRenderer.on("transcription:status", handler);
      return () => ipcRenderer.removeListener("transcription:status", handler);
    },
    onInterimResult: (callback: (data: {
      sessionId: string;
      transcript: string;
      resultEndTimeMs: number;
      speaker?: string;
      sequence: number;
      isFinal: boolean;
    }) => void) => {
      const handler = (_: unknown, data: {
        sessionId: string;
        transcript: string;
        resultEndTimeMs: number;
        speaker?: string;
        sequence: number;
        isFinal: boolean;
      }) => callback(data);
      ipcRenderer.on("transcription:interimResult", handler);
      return () => ipcRenderer.removeListener("transcription:interimResult", handler);
    },
  },

  ai: {
    configure: (config: unknown) => ipcRenderer.invoke("ai:configure", config),
    getActiveProvider: () => ipcRenderer.invoke("ai:getActiveProvider"),
    isAudioCapable: () => ipcRenderer.invoke("ai:isAudioCapable"),
    transcribe: (text: string) => ipcRenderer.invoke("ai:transcribe", text),
    transcribeAudio: (audioData: ArrayBuffer, mimeType: string) =>
      ipcRenderer.invoke("ai:transcribeAudio", audioData, mimeType),
    summarize: (transcript: string) =>
      ipcRenderer.invoke("ai:summarize", transcript),
    validateApiKey: (
      provider: string,
      apiKey: string,
      extras?: Record<string, string>,
    ) => ipcRenderer.invoke("ai:validateApiKey", provider, apiKey, extras),
  },

  attachment: {
    addFile: (
      sessionId: string,
      sourcePath: string,
      filename: string,
      mimeType: string,
    ) =>
      ipcRenderer.invoke(
        "attachment:addFile",
        sessionId,
        sourcePath,
        filename,
        mimeType,
      ),
    addNote: (sessionId: string, text: string) =>
      ipcRenderer.invoke("attachment:addNote", sessionId, text),
    list: (sessionId: string) =>
      ipcRenderer.invoke("attachment:list", sessionId),
  },

  speaker: {
    list: () => ipcRenderer.invoke("speaker:list"),
    create: (name: string, displayName?: string) =>
      ipcRenderer.invoke("speaker:create", name, displayName),
    getForSession: (sessionId: string) =>
      ipcRenderer.invoke("speaker:getForSession", sessionId),
    linkToSession: (sessionId: string, speakerId: string) =>
      ipcRenderer.invoke("speaker:linkToSession", sessionId, speakerId),
  },

  meetingType: {
    list: () => ipcRenderer.invoke("meetingType:list"),
    create: (params: {
      name: string;
      description?: string;
      prompt_template?: string;
      icon?: string;
    }) => ipcRenderer.invoke("meetingType:create", params),
    setForSession: (sessionId: string, meetingTypeId: string | null) =>
      ipcRenderer.invoke("meetingType:setForSession", sessionId, meetingTypeId),
    processSession: (sessionId: string) =>
      ipcRenderer.invoke("meetingType:processSession", sessionId),
  },

  translation: {
    translateBatch: (texts: string[], targetLanguage: string) =>
      ipcRenderer.invoke("translation:translateBatch", texts, targetLanguage),
  },

  summarization: {
    generate: (sessionId: string) =>
      ipcRenderer.invoke("summarization:generate", sessionId),
    onChunk: (
      callback: (data: { sessionId: string; text: string }) => void,
    ) => {
      const handler = (_: unknown, data: { sessionId: string; text: string }) =>
        callback(data);
      ipcRenderer.on("summarization:chunk", handler);
      return () => ipcRenderer.removeListener("summarization:chunk", handler);
    },
  },

  models: {
    getConfig: () => ipcRenderer.invoke("models:getConfig"),
    getForProvider: (providerId: string) =>
      ipcRenderer.invoke("models:getForProvider", providerId),
    getActiveForProvider: (providerId: string) =>
      ipcRenderer.invoke("models:getActiveForProvider", providerId),
    getForContext: (context: string) =>
      ipcRenderer.invoke("models:getForContext", context),
    getContexts: () => ipcRenderer.invoke("models:getContexts"),
    validate: (providerId: string, modelId: string) =>
      ipcRenderer.invoke("models:validate", providerId, modelId),
    getCostMultiplier: (providerId: string, modelId: string) =>
      ipcRenderer.invoke("models:getCostMultiplier", providerId, modelId),
  },

  settings: {
    get: (key: string) => ipcRenderer.invoke("settings:get", key),
    set: (key: string, value: string) =>
      ipcRenderer.invoke("settings:set", key, value),
    getAll: () => ipcRenderer.invoke("settings:getAll"),
    testConnection: () => ipcRenderer.invoke("settings:testConnection"),
    getModelForContext: (context: string) =>
      ipcRenderer.invoke("settings:getModelForContext", context),
    getChirp3Config: () => ipcRenderer.invoke("settings:getChirp3Config"),
    testChirp3Connection: () =>
      ipcRenderer.invoke("settings:testChirp3Connection"),
  },

  history: {
    search: (query: string) => ipcRenderer.invoke("history:search", query),
    delete: (sessionId: string) =>
      ipcRenderer.invoke("history:delete", sessionId),
  },

  window: {
    minimize: () => ipcRenderer.invoke("window:minimize"),
    maximize: () => ipcRenderer.invoke("window:maximize"),
    close: () => ipcRenderer.invoke("window:close"),
    isMaximized: () => ipcRenderer.invoke("window:isMaximized"),
    closeControlBar: () => ipcRenderer.invoke("window:closeControlBar"),
  },
});
