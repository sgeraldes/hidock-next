// Database types matching SQLite schema

// =============================================================================
// Re-export store types
// =============================================================================

export * from './stores'

// =============================================================================
// Existing Types
// =============================================================================

export interface Meeting {
  id: string
  subject: string
  start_time: string
  end_time: string
  location?: string | null
  organizer_name?: string | null
  organizer_email?: string | null
  attendees?: string | null // JSON string of attendee array
  description?: string | null
  is_recurring: number
  recurrence_rule?: string | null
  meeting_url?: string | null
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
    calendarView: 'day' | 'workweek' | 'week' | 'month'
    hideEmptyMeetings: boolean
    showListView: boolean
    officeHoursStart: number
    officeHoursEnd: number
    workDays: number[]
  }
}

// =============================================================================
// New Types (Phase 0 - Meeting Intelligence Platform)
// =============================================================================

/**
 * Contact extracted from meeting attendees
 */
export interface Contact {
  id: string
  name: string
  email: string | null
  notes: string | null
  first_seen_at: string
  last_seen_at: string
  meeting_count: number
  created_at: string
}

/**
 * Role a contact has in a meeting
 */
export type ContactRole = 'organizer' | 'attendee'

/**
 * Junction table: Meeting-Contact relationship
 */
export interface MeetingContact {
  meeting_id: string
  contact_id: string
  role: ContactRole
}

/**
 * User-created project for organizing meetings
 */
export interface Project {
  id: string
  name: string
  description: string | null
  created_at: string
}

/**
 * Junction table: Meeting-Project relationship
 */
export interface MeetingProject {
  meeting_id: string
  project_id: string
}

/**
 * Contact with associated meetings
 */
export interface ContactWithMeetings {
  contact: Contact
  meetings: Meeting[]
  totalMeetingTimeMinutes: number
}

/**
 * Project with associated meetings and extracted topics
 */
export interface ProjectWithMeetings {
  project: Project
  meetings: Meeting[]
  topics: string[] // Extracted from transcripts.topics JSON
}

/**
 * Meeting with contact and project associations
 */
export interface MeetingWithAssociations extends Meeting {
  contacts: Contact[]
  projects: Project[]
  recording?: RecordingWithTranscript
}

// =============================================================================
// Output Types
// =============================================================================

/**
 * Available output template identifiers
 */
export type OutputTemplateId = 'meeting_minutes' | 'interview_feedback' | 'project_status' | 'action_items'

/**
 * Output template definition
 */
export interface OutputTemplate {
  id: OutputTemplateId
  name: string
  description: string
}

// =============================================================================
// Recording-Meeting Linking Types
// =============================================================================

/**
 * Meeting candidate for recording linking dialog
 * Transformed from database snake_case to TypeScript camelCase
 */
export interface MeetingCandidate {
  id: string
  recordingId: string
  meetingId: string
  subject: string
  startTime: string
  endTime: string
  confidenceScore: number
  matchReason: string | null
  isAiSelected: boolean
  isUserConfirmed: boolean
}

/**
 * Result type for IPC operations
 */
export interface RecordingLinkResult {
  success: boolean
  error?: string
}

// =============================================================================
// RAG Filter Types
// =============================================================================

/**
 * Discriminated union for RAG query filtering
 */
export type RAGFilter =
  | { type: 'none' }
  | { type: 'meeting'; meetingId: string }
  | { type: 'contact'; contactId: string }
  | { type: 'project'; projectId: string }
  | { type: 'dateRange'; startDate: string; endDate: string }

// =============================================================================
// Helper Functions
// =============================================================================

// Helper to parse attendees JSON
export function parseAttendees(attendeesJson?: string | null): MeetingAttendee[] {
  if (!attendeesJson) return []
  try {
    return JSON.parse(attendeesJson)
  } catch {
    return []
  }
}

// Helper to parse JSON arrays
export function parseJsonArray<T>(json?: string | null): T[] {
  if (!json) return []
  try {
    return JSON.parse(json)
  } catch {
    return []
  }
}

// Helper to serialize array to JSON string
export function serializeJsonArray<T>(array: T[]): string {
  return JSON.stringify(array)
}
