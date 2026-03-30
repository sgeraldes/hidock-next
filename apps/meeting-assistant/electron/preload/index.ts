import { contextBridge, ipcRenderer } from "electron";

type Unsubscribe = () => void;

contextBridge.exposeInMainWorld("electronAPI", {
  app: {
    info: () => ipcRenderer.invoke("app:info"),
  },

  window: {
    minimize: () => ipcRenderer.invoke("window:minimize"),
    maximize: () => ipcRenderer.invoke("window:maximize"),
    close: () => ipcRenderer.invoke("window:close"),
    isMaximized: () => ipcRenderer.invoke("window:isMaximized"),
  },

  session: {
    list: () => ipcRenderer.invoke("session:list"),
    create: () => ipcRenderer.invoke("session:create"),
    get: (sessionId: string) =>
      ipcRenderer.invoke("session:get", { sessionId }),
    end: (sessionId: string) =>
      ipcRenderer.invoke("session:end", { sessionId }),
    delete: (sessionId: string) =>
      ipcRenderer.invoke("session:delete", { sessionId }),
    linkMeeting: (sessionId: string, meetingId: string) =>
      ipcRenderer.invoke("session:linkMeeting", { sessionId, meetingId }),
    onCreated: (callback: (data: unknown) => void): Unsubscribe => {
      const handler = (_: unknown, data: unknown) => callback(data);
      ipcRenderer.on("session:created", handler);
      return () => ipcRenderer.removeListener("session:created", handler);
    },
    onUpdated: (callback: (data: unknown) => void): Unsubscribe => {
      const handler = (_: unknown, data: unknown) => callback(data);
      ipcRenderer.on("session:updated", handler);
      return () => ipcRenderer.removeListener("session:updated", handler);
    },
    onDeleted: (callback: (data: unknown) => void): Unsubscribe => {
      const handler = (_: unknown, data: unknown) => callback(data);
      ipcRenderer.on("session:deleted", handler);
      return () => ipcRenderer.removeListener("session:deleted", handler);
    },
    onStatusChanged: (callback: (data: unknown) => void): Unsubscribe => {
      const handler = (_: unknown, data: unknown) => callback(data);
      ipcRenderer.on("session:statusChanged", handler);
      return () => ipcRenderer.removeListener("session:statusChanged", handler);
    },
  },

  transcript: {
    getSegments: (sessionId: string, offset?: number, limit?: number) =>
      ipcRenderer.invoke("transcript:getSegments", { sessionId, offset, limit }),
    getRecent: (sessionId: string, maxAgeSecs?: number, maxCount?: number) =>
      ipcRenderer.invoke("transcript:getRecent", { sessionId, maxAgeSecs, maxCount }),
    onNewSegments: (callback: (data: unknown) => void): Unsubscribe => {
      const handler = (_: unknown, data: unknown) => callback(data);
      ipcRenderer.on("transcript:newSegments", handler);
      return () => ipcRenderer.removeListener("transcript:newSegments", handler);
    },
    onInterimResult: (callback: (data: unknown) => void): Unsubscribe => {
      const handler = (_: unknown, data: unknown) => callback(data);
      ipcRenderer.on("transcript:interimResult", handler);
      return () => ipcRenderer.removeListener("transcript:interimResult", handler);
    },
    onError: (callback: (error: unknown) => void): Unsubscribe => {
      const handler = (_: unknown, error: unknown) => callback(error);
      ipcRenderer.on("transcript:error", handler);
      return () => ipcRenderer.removeListener("transcript:error", handler);
    },
    onStatus: (callback: (status: unknown) => void): Unsubscribe => {
      const handler = (_: unknown, status: unknown) => callback(status);
      ipcRenderer.on("transcript:status", handler);
      return () => ipcRenderer.removeListener("transcript:status", handler);
    },
  },

  suggestion: {
    getActive: (sessionId: string) =>
      ipcRenderer.invoke("suggestion:getActive", { sessionId }),
    dismiss: (suggestionId: string) =>
      ipcRenderer.invoke("suggestion:dismiss", { suggestionId }),
    onUpdated: (callback: (data: unknown) => void): Unsubscribe => {
      const handler = (_: unknown, data: unknown) => callback(data);
      ipcRenderer.on("suggestion:updated", handler);
      return () => ipcRenderer.removeListener("suggestion:updated", handler);
    },
    onCleared: (callback: (data: unknown) => void): Unsubscribe => {
      const handler = (_: unknown, data: unknown) => callback(data);
      ipcRenderer.on("suggestion:cleared", handler);
      return () => ipcRenderer.removeListener("suggestion:cleared", handler);
    },
  },

  notes: {
    generate: (sessionId: string, templateId?: string) =>
      ipcRenderer.invoke("notes:generate", { sessionId, templateId }),
    getForSession: (sessionId: string) =>
      ipcRenderer.invoke("notes:getForSession", { sessionId }),
    update: (notesId: string, content: string) =>
      ipcRenderer.invoke("notes:update", { notesId, content }),
    listTemplates: () => ipcRenderer.invoke("notes:listTemplates"),
    categorize: (notesId: string, category: string) =>
      ipcRenderer.invoke("notes:categorize", { notesId, category }),
    onGenerationProgress: (callback: (data: unknown) => void): Unsubscribe => {
      const handler = (_: unknown, data: unknown) => callback(data);
      ipcRenderer.on("notes:generationProgress", handler);
      return () => ipcRenderer.removeListener("notes:generationProgress", handler);
    },
  },

  screenshot: {
    capture: (sessionId: string) =>
      ipcRenderer.invoke("screenshot:capture", { sessionId }),
    listForSession: (sessionId: string) =>
      ipcRenderer.invoke("screenshot:listForSession", { sessionId }),
    getAnalysis: (screenshotId: string) =>
      ipcRenderer.invoke("screenshot:getAnalysis", { screenshotId }),
    configure: (config: {
      autoCapture?: boolean;
      intervalSeconds?: number;
      analyzeWithLLM?: boolean;
    }) => ipcRenderer.invoke("screenshot:configure", config),
    onCaptured: (callback: (data: unknown) => void): Unsubscribe => {
      const handler = (_: unknown, data: unknown) => callback(data);
      ipcRenderer.on("screenshot:captured", handler);
      return () => ipcRenderer.removeListener("screenshot:captured", handler);
    },
    onAnalysisReady: (callback: (data: unknown) => void): Unsubscribe => {
      const handler = (_: unknown, data: unknown) => callback(data);
      ipcRenderer.on("screenshot:analysisReady", handler);
      return () => ipcRenderer.removeListener("screenshot:analysisReady", handler);
    },
  },

  settings: {
    get: (key: string) =>
      ipcRenderer.invoke("settings:get", { key }),
    set: (key: string, value: unknown) =>
      ipcRenderer.invoke("settings:set", { key, value }),
    getAll: () => ipcRenderer.invoke("settings:getAll"),
    getCategory: (category: string) =>
      ipcRenderer.invoke("settings:getCategory", { category }),
    testConnection: () => ipcRenderer.invoke("settings:testConnection"),
    onChanged: (callback: (data: unknown) => void): Unsubscribe => {
      const handler = (_: unknown, data: unknown) => callback(data);
      ipcRenderer.on("settings:changed", handler);
      return () => ipcRenderer.removeListener("settings:changed", handler);
    },
  },

  knowledge: {
    addSource: (path: string) =>
      ipcRenderer.invoke("kb:addSource", { path }),
    removeSource: (sourcePath: string) =>
      ipcRenderer.invoke("kb:removeSource", { sourcePath }),
    search: (query: string, topK?: number) =>
      ipcRenderer.invoke("kb:search", { query, topK }),
    reindex: () => ipcRenderer.invoke("kb:reindex"),
    onIndexProgress: (callback: (data: unknown) => void): Unsubscribe => {
      const handler = (_: unknown, data: unknown) => callback(data);
      ipcRenderer.on("kb:indexProgress", handler);
      return () => ipcRenderer.removeListener("kb:indexProgress", handler);
    },
    onIndexComplete: (callback: (data: unknown) => void): Unsubscribe => {
      const handler = (_: unknown, data: unknown) => callback(data);
      ipcRenderer.on("kb:indexComplete", handler);
      return () => ipcRenderer.removeListener("kb:indexComplete", handler);
    },
  },
});
