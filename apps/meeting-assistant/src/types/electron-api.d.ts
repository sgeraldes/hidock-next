import type {
  AppInfo,
  Session,
  TranscriptSegment,
  TranscriptStatus,
  Suggestion,
  Note,
  NoteTemplate,
  Screenshot,
  KnowledgeSearchResult,
  KnowledgeIndexProgress,
  KnowledgeIndexComplete,
  SettingsKey,
  SettingsMap,
  SettingsCategoryGroup,
} from "./models";

export interface KbSourceRecord {
  id: number;
  path: string;
  status: 'pending' | 'indexing' | 'indexed' | 'error';
  chunk_count: number;
  added_at: number;
  indexed_at: number | null;
}

type Unsubscribe = () => void;

export interface ElectronAPI {
  app: {
    info: () => Promise<AppInfo>;
  };

  window: {
    minimize: () => Promise<void>;
    maximize: () => Promise<void>;
    close: () => Promise<void>;
    isMaximized: () => Promise<boolean>;
  };

  session: {
    list: () => Promise<Session[]>;
    create: () => Promise<Session>;
    get: (sessionId: string) => Promise<Session | null>;
    end: (sessionId: string) => Promise<Session | null>;
    delete: (sessionId: string) => Promise<null>;
    linkMeeting: (sessionId: string, meetingId: string) => Promise<Session | null>;
    stats: () => Promise<{ totalSessions: number; totalRecordingMinutes: number; notesCount: number }>;
    onCreated: (callback: (data: Session) => void) => Unsubscribe;
    onUpdated: (callback: (data: Session) => void) => Unsubscribe;
    onDeleted: (callback: (data: { sessionId: string }) => void) => Unsubscribe;
    onStatusChanged: (callback: (data: Session) => void) => Unsubscribe;
  };

  transcript: {
    getSegments: (sessionId: string, offset?: number, limit?: number) => Promise<TranscriptSegment[]>;
    getRecent: (sessionId: string, maxAgeSecs?: number, maxCount?: number) => Promise<TranscriptSegment[]>;
    onNewSegments: (callback: (data: TranscriptSegment[]) => void) => Unsubscribe;
    onInterimResult: (callback: (data: { text: string; isFinal: boolean }) => void) => Unsubscribe;
    onError: (callback: (error: { message: string }) => void) => Unsubscribe;
    onStatus: (callback: (status: TranscriptStatus) => void) => Unsubscribe;
  };

  suggestion: {
    getActive: (sessionId: string) => Promise<Suggestion[]>;
    dismiss: (suggestionId: string) => Promise<null>;
    onUpdated: (callback: (data: Suggestion[]) => void) => Unsubscribe;
    onCleared: (callback: (data: { sessionId: string }) => void) => Unsubscribe;
  };

  notes: {
    generate: (sessionId: string, templateId?: string) => Promise<Note | null>;
    getForSession: (sessionId: string) => Promise<Note | null>;
    update: (notesId: string, content: string) => Promise<null>;
    listTemplates: () => Promise<NoteTemplate[]>;
    categorize: (notesId: string, category: string) => Promise<null>;
    onGenerationProgress: (callback: (data: { sessionId: string; progress: number; stage: string }) => void) => Unsubscribe;
  };

  screenshot: {
    capture: (sessionId: string) => Promise<Screenshot | null>;
    listForSession: (sessionId: string) => Promise<Screenshot[]>;
    getAnalysis: (screenshotId: string) => Promise<{ analysis: string | null } | null>;
    configure: (config: {
      autoCapture?: boolean;
      intervalSeconds?: number;
      analyzeWithLLM?: boolean;
    }) => Promise<null>;
    onCaptured: (callback: (data: Screenshot) => void) => Unsubscribe;
    onAnalysisReady: (callback: (data: { screenshotId: number; analysis: string }) => void) => Unsubscribe;
  };

  settings: {
    get: <K extends SettingsKey>(key: K) => Promise<SettingsMap[K] | null>;
    set: <K extends SettingsKey>(key: K, value: SettingsMap[K]) => Promise<null>;
    getAll: () => Promise<Partial<SettingsMap>>;
    getCategory: (category: string) => Promise<SettingsCategoryGroup | null>;
    testConnection: () => Promise<{ success: boolean; error?: string }>;
    onChanged: (callback: (data: { key: SettingsKey; value: SettingsMap[SettingsKey] }) => void) => Unsubscribe;
  };

  knowledge: {
    addSource: (path: string) => Promise<null>;
    removeSource: (sourcePath: string) => Promise<null>;
    search: (query: string, topK?: number) => Promise<KnowledgeSearchResult[]>;
    reindex: () => Promise<null>;
    listSources: () => Promise<KbSourceRecord[]>;
    onIndexProgress: (callback: (data: KnowledgeIndexProgress) => void) => Unsubscribe;
    onIndexComplete: (callback: (data: KnowledgeIndexComplete) => void) => Unsubscribe;
  };

  audio: {
    sendChunk: (data: Uint8Array, timestamp: number, index: number) => Promise<{ ok: boolean; reason?: string }>;
    onStartCapture: (cb: (data: { sessionId: string }) => void) => Unsubscribe;
    onStopCapture: (cb: () => void) => Unsubscribe;
  };

  meeting: {
    onUpcoming: (callback: (data: unknown) => void) => Unsubscribe;
    onMicDetected: (callback: (data: unknown) => void) => Unsubscribe;
    onCorrelation: (callback: (data: unknown) => void) => Unsubscribe;
  };

  dialog: {
    openFile: (opts?: {
      title?: string;
      properties?: string[];
      filters?: Array<{ name: string; extensions: string[] }>;
    }) => Promise<string[] | null>;
  };
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
