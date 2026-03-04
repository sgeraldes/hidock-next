interface ElectronAPI {
  app: {
    info: () => Promise<{ name: string; version: string; path: string }>;
  };
  session: {
    list: () => Promise<unknown[]>;
    create: () => Promise<{ id: string }>;
    end: (sessionId: string) => Promise<void>;
    delete: (sessionId: string) => Promise<void>;
    openFileLocation: (sessionId: string) => Promise<void>;
    deleteTranscript: (sessionId: string) => Promise<void>;
    retranscribe: (sessionId: string) => Promise<void>;
    get: (sessionId: string) => Promise<unknown>;
    getTranscript: (sessionId: string) => Promise<unknown[]>;
    getTopics: (sessionId: string) => Promise<string[]>;
    getActionItems: (sessionId: string) => Promise<unknown[]>;
    getSummary: (sessionId: string) => Promise<string | null>;
    renameSpeaker: (
      sessionId: string,
      oldName: string,
      newName: string,
    ) => Promise<{ success: boolean; count: number }>;
    onCreated: (callback: (session: unknown) => void) => () => void;
    onStatusChanged: (callback: (data: unknown) => void) => () => void;
  };
  audio: {
    sendChunk: (
      data: ArrayBuffer,
      sessionId: string,
      chunkIndex: number,
      mimeType: string,
    ) => void;
    getPath: (sessionId: string) => Promise<string | null>;
    readFile: (sessionId: string) => Promise<{ data: ArrayBuffer; mimeType: string } | null>;
    onMicStatus: (
      callback: (status: { active: boolean; appName?: string }) => void,
    ) => () => void;
    onChunkAck: (
      callback: (data: { sessionId: string; chunkIndex: number }) => void,
    ) => () => void;
    onChunkError: (
      callback: (data: {
        sessionId: string;
        chunkIndex: number;
        error: string;
      }) => void,
    ) => () => void;
  };
  transcription: {
    start: (sessionId: string) => Promise<void>;
    stop: (sessionId: string) => Promise<void>;
    onNewSegments: (
      callback: (data: {
        chunkIndex: number;
        segments: Array<{
          speaker: string;
          text: string;
          sentiment?: string;
        }>;
      }) => void,
    ) => () => void;
    onTopicsUpdated: (
      callback: (data: { sessionId: string; topics: string[] }) => void,
    ) => () => void;
    onActionItemsUpdated: (
      callback: (data: {
        sessionId: string;
        actionItems: Array<{ text: string; assignee?: string }>;
      }) => void,
    ) => () => void;
    onError: (callback: (error: string) => void) => () => void;
    onStatus: (callback: (status: string) => void) => () => void;
    onInterimResult: (
      callback: (data: {
        sessionId: string;
        transcript: string;
        resultEndTimeMs: number;
        speaker?: string;
        sequence: number;
        isFinal: boolean;
      }) => void,
    ) => () => void;
  };
  ai: {
    configure: (
      config: unknown,
    ) => Promise<{ provider: string; model: string }>;
    getActiveProvider: () => Promise<string | null>;
    isAudioCapable: () => Promise<boolean>;
    transcribe: (text: string) => Promise<unknown>;
    transcribeAudio: (
      audioData: ArrayBuffer,
      mimeType: string,
    ) => Promise<unknown>;
    summarize: (transcript: string) => Promise<unknown>;
    validateApiKey: (
      provider: string,
      apiKey: string,
      extras?: Record<string, string>,
    ) => Promise<{ valid: boolean; error?: string }>;
  };
  attachment: {
    addFile: (
      sessionId: string,
      sourcePath: string,
      filename: string,
      mimeType: string,
    ) => Promise<unknown>;
    addNote: (sessionId: string, text: string) => Promise<unknown>;
    list: (sessionId: string) => Promise<unknown[]>;
  };
  speaker: {
    list: () => Promise<unknown[]>;
    create: (name: string, displayName?: string) => Promise<unknown>;
    getForSession: (sessionId: string) => Promise<unknown[]>;
    linkToSession: (sessionId: string, speakerId: string) => Promise<void>;
  };
  translation: {
    translateBatch: (
      texts: string[],
      targetLanguage: string,
    ) => Promise<
      Array<{
        originalText: string;
        translatedText: string;
        targetLanguage: string;
      }>
    >;
  };
  summarization: {
    generate: (sessionId: string) => Promise<{
      summary: string;
      keyPoints: string[];
    }>;
    onChunk: (
      callback: (data: { sessionId: string; text: string }) => void,
    ) => () => void;
  };
  meetingType: {
    list: () => Promise<unknown[]>;
    create: (params: {
      name: string;
      description?: string;
      prompt_template?: string;
      icon?: string;
    }) => Promise<unknown>;
    setForSession: (
      sessionId: string,
      meetingTypeId: string | null,
    ) => Promise<void>;
    processSession: (sessionId: string) => Promise<void>;
  };
  models: {
    getConfig: () => Promise<{
      version: number;
      providers: Record<string, {
        name: string;
        audioCapable: boolean;
        models: Array<{
          id: string;
          name: string;
          description: string;
          costMultiplier: number;
          contexts: string[];
          capabilities: string[];
          deprecated?: boolean;
          recommended?: boolean;
          migratesTo?: string;
          sunset?: string;
        }>;
        defaultModel: string;
        requiresTranscription?: boolean;
        transcriptionProvider?: string;
        allowCustomModels?: boolean;
      }>;
      contexts: Record<string, {
        name: string;
        description: string;
        priority: "speed" | "quality" | "cost";
      }>;
    }>;
    getForProvider: (providerId: string) => Promise<Array<{
      id: string;
      name: string;
      description: string;
      costMultiplier: number;
      contexts: string[];
      capabilities: string[];
      deprecated?: boolean;
      recommended?: boolean;
      migratesTo?: string;
      sunset?: string;
    }>>;
    getActiveForProvider: (providerId: string) => Promise<Array<{
      id: string;
      name: string;
      description: string;
      costMultiplier: number;
      contexts: string[];
      capabilities: string[];
      recommended?: boolean;
    }>>;
    getForContext: (context: string) => Promise<string>;
    getContexts: () => Promise<Record<string, {
      name: string;
      description: string;
      priority: "speed" | "quality" | "cost";
    }>>;
    validate: (providerId: string, modelId: string) => Promise<{
      valid: boolean;
      deprecated: boolean;
      migratesTo: string | null;
    }>;
    getCostMultiplier: (providerId: string, modelId: string) => Promise<number>;
  };
  settings: {
    get: (key: string) => Promise<string | null>;
    set: (key: string, value: string) => Promise<void>;
    getAll: () => Promise<Record<string, string>>;
    testConnection: () => Promise<{ valid: boolean; error?: string }>;
    getModelForContext: (context: string) => Promise<string>;
    getChirp3Config: () => Promise<{
      projectId: string;
      authType: string;
      location: string;
      languageCode: string;
      confidenceThreshold: number;
      hasApiKey: boolean;
      hasServiceAccount: boolean;
      backend: string;
      isConfigured: boolean;
    }>;
    testChirp3Connection: () => Promise<{ valid: boolean; error?: string }>;
  };
  history: {
    search: (query: string) => Promise<unknown[]>;
    delete: (sessionId: string) => Promise<void>;
  };
  window: {
    minimize: () => Promise<void>;
    maximize: () => Promise<void>;
    close: () => Promise<void>;
    isMaximized: () => Promise<boolean>;
    closeControlBar: () => Promise<void>;
  };
}

interface Window {
  electronAPI: ElectronAPI;
}
