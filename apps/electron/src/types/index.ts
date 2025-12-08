// Database types matching SQLite schema

export interface Meeting {
  id: string
  subject: string
  start_time: string
  end_time: string
  location?: string
  organizer_name?: string
  organizer_email?: string
  attendees?: string // JSON string of attendee array
  description?: string
  is_recurring: number
  recurrence_rule?: string
  meeting_url?: string
  created_at: string
  updated_at: string
}

export interface MeetingAttendee {
  name?: string
  email?: string
  status?: string
}

export interface Recording {
  id: string
  filename: string
  original_filename?: string
  file_path: string
  file_size?: number
  duration_seconds?: number
  date_recorded: string
  meeting_id?: string
  correlation_confidence?: number
  correlation_method?: string
  status: 'pending' | 'transcribing' | 'transcribed' | 'error'
  created_at: string
}

export interface Transcript {
  id: string
  recording_id: string
  full_text: string
  language: string
  summary?: string
  action_items?: string // JSON string
  topics?: string // JSON string
  key_points?: string // JSON string
  sentiment?: string
  speakers?: string // JSON string
  word_count?: number
  transcription_provider?: string
  transcription_model?: string
  created_at: string
}

export interface RecordingWithTranscript extends Recording {
  transcript?: Transcript
}

export interface MeetingDetails {
  meeting: Meeting
  recordings: RecordingWithTranscript[]
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  sources?: string // JSON string of source references
  created_at: string
}

export interface QueueItem {
  id: string
  recording_id: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  attempts: number
  error_message?: string
  created_at: string
  started_at?: string
  completed_at?: string
}

export interface StorageInfo {
  dataPath: string
  recordingsPath: string
  transcriptsPath: string
  cachePath: string
  databasePath: string
  totalSizeBytes: number
  recordingsCount: number
}

export interface CalendarSettings {
  icsUrl: string
  syncEnabled: boolean
  syncIntervalMinutes: number
  lastSyncAt: string | null
}

export interface CalendarSyncResult {
  success: boolean
  meetingsCount: number
  error?: string
  lastSync?: string
}

export interface AppConfig {
  version: string
  storage: {
    dataPath: string
    maxRecordingsGB: number
  }
  calendar: CalendarSettings
  transcription: {
    provider: 'gemini'
    geminiApiKey: string
    geminiModel: string
    autoTranscribe: boolean
    language: string
  }
  embeddings: {
    provider: 'ollama'
    ollamaBaseUrl: string
    ollamaModel: string
    chunkSize: number
    chunkOverlap: number
  }
  chat: {
    provider: 'gemini' | 'ollama'
    geminiModel: string
    ollamaModel: string
    maxContextChunks: number
  }
  device: {
    autoConnect: boolean
    autoDownload: boolean
  }
  ui: {
    theme: 'light' | 'dark' | 'system'
    defaultView: 'week' | 'month'
    startOfWeek: number
  }
}

// Helper to parse attendees JSON
export function parseAttendees(attendeesJson?: string): MeetingAttendee[] {
  if (!attendeesJson) return []
  try {
    return JSON.parse(attendeesJson)
  } catch {
    return []
  }
}

// Helper to parse JSON arrays
export function parseJsonArray<T>(json?: string): T[] {
  if (!json) return []
  try {
    return JSON.parse(json)
  } catch {
    return []
  }
}
