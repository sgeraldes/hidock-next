interface ElectronAPI {
  app: {
    info: () => Promise<{ version: string; platform: string }>;
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
    onNewSegments: (callback: (segments: unknown[]) => void) => () => void;
    onTopicsUpdated: (callback: (topics: string[]) => void) => () => void;
    onActionItemsUpdated: (callback: (items: unknown[]) => void) => () => void;
    onError: (callback: (error: string) => void) => () => void;
    onStatus: (callback: (status: string) => void) => () => void;
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
  settings: {
    get: (key: string) => Promise<string | null>;
    set: (key: string, value: string) => Promise<void>;
    getAll: () => Promise<Record<string, string>>;
    testConnection: () => Promise<{ valid: boolean; error?: string }>;
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
