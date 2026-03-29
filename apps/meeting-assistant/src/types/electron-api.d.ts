type Unsubscribe = () => void;

export interface ElectronAPI {
  app: {
    info: () => Promise<unknown>;
  };

  window: {
    minimize: () => Promise<void>;
    maximize: () => Promise<void>;
    close: () => Promise<void>;
    isMaximized: () => Promise<boolean>;
  };

  session: {
    list: () => Promise<unknown[]>;
    create: () => Promise<unknown>;
    get: (sessionId: string) => Promise<unknown>;
    end: (sessionId: string) => Promise<unknown>;
    delete: (sessionId: string) => Promise<unknown>;
    linkMeeting: (sessionId: string, meetingId: string) => Promise<unknown>;
    onCreated: (callback: (data: unknown) => void) => Unsubscribe;
    onUpdated: (callback: (data: unknown) => void) => Unsubscribe;
    onDeleted: (callback: (data: unknown) => void) => Unsubscribe;
    onStatusChanged: (callback: (data: unknown) => void) => Unsubscribe;
  };

  transcript: {
    getSegments: (sessionId: string, offset?: number, limit?: number) => Promise<unknown[]>;
    getRecent: (sessionId: string, maxAgeSecs?: number, maxCount?: number) => Promise<unknown[]>;
    onNewSegments: (callback: (data: unknown) => void) => Unsubscribe;
    onInterimResult: (callback: (data: unknown) => void) => Unsubscribe;
    onError: (callback: (error: unknown) => void) => Unsubscribe;
    onStatus: (callback: (status: unknown) => void) => Unsubscribe;
  };

  suggestion: {
    getActive: (sessionId: string) => Promise<unknown[]>;
    dismiss: (suggestionId: string) => Promise<unknown>;
    onUpdated: (callback: (data: unknown) => void) => Unsubscribe;
    onCleared: (callback: (data: unknown) => void) => Unsubscribe;
  };

  notes: {
    generate: (sessionId: string, templateId?: string) => Promise<unknown>;
    getForSession: (sessionId: string) => Promise<unknown>;
    update: (notesId: string, content: string) => Promise<unknown>;
    listTemplates: () => Promise<unknown[]>;
    categorize: (notesId: string, category: string) => Promise<unknown>;
    onGenerationProgress: (callback: (data: unknown) => void) => Unsubscribe;
  };

  screenshot: {
    capture: (sessionId: string) => Promise<unknown>;
    listForSession: (sessionId: string) => Promise<unknown[]>;
    getAnalysis: (screenshotId: string) => Promise<unknown>;
    configure: (config: {
      autoCapture?: boolean;
      intervalSeconds?: number;
      analyzeWithLLM?: boolean;
    }) => Promise<unknown>;
    onCaptured: (callback: (data: unknown) => void) => Unsubscribe;
    onAnalysisReady: (callback: (data: unknown) => void) => Unsubscribe;
  };

  settings: {
    get: (key: string) => Promise<unknown>;
    set: (key: string, value: unknown) => Promise<unknown>;
    getAll: () => Promise<Record<string, unknown>>;
    getCategory: (category: string) => Promise<unknown>;
    testConnection: () => Promise<{ success: boolean; error?: string }>;
    onChanged: (callback: (data: unknown) => void) => Unsubscribe;
  };
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
