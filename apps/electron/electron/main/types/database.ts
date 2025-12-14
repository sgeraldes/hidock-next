/**
 * Database Entity Types
 *
 * Type definitions for all database entities in the HiDock Meeting Intelligence platform.
 * These types mirror the SQLite schema and provide type safety across the application.
 */

// =============================================================================
// Existing Entities (from current schema)
// =============================================================================

/**
 * Calendar meeting from ICS sync
 */
export interface Meeting {
  id: string
  subject: string
  start_time: string
  end_time: string
  location: string | null
  organizer_name: string | null
  organizer_email: string | null
  attendees: string | null // JSON string of MeetingAttendee[]
  description: string | null
  is_recurring: number // SQLite boolean (0 or 1)
  recurrence_rule: string | null
  meeting_url: string | null
  created_at: string
  updated_at: string
}

/**
 * Attendee parsed from meeting.attendees JSON
 */
export interface MeetingAttendee {
  name?: string
  email?: string
  status?: 'accepted' | 'declined' | 'tentative' | 'unknown'
}

/**
 * Audio recording from HiDock device
 */
export interface Recording {
  id: string
  filename: string
  original_filename: string | null
  file_path: string
  file_size: number | null
  duration_seconds: number | null
  date_recorded: string
  meeting_id: string | null
  correlation_confidence: number | null
  correlation_method: string | null
  status: RecordingStatus
  created_at: string
}

export type RecordingStatus = 'pending' | 'transcribing' | 'transcribed' | 'error'

/**
 * AI-generated transcript from recording
 */
export interface Transcript {
  id: string
  recording_id: string
  full_text: string
  language: string
  summary: string | null
  action_items: string | null // JSON string of string[]
  topics: string | null // JSON string of string[]
  key_points: string | null // JSON string of string[]
  sentiment: string | null
  speakers: string | null // JSON string of speaker data
  word_count: number | null
  transcription_provider: string | null
  transcription_model: string | null
  created_at: string
}

/**
 * Vector embedding chunk for RAG
 */
export interface Embedding {
  id: string
  transcript_id: string
  chunk_index: number
  chunk_text: string
  embedding: Uint8Array
  created_at: string
}

/**
 * Transcription processing queue item
 */
export interface QueueItem {
  id: string
  recording_id: string
  status: QueueStatus
  attempts: number
  error_message: string | null
  created_at: string
  started_at: string | null
  completed_at: string | null
}

export type QueueStatus = 'pending' | 'processing' | 'completed' | 'failed'

/**
 * Chat message in RAG conversation
 */
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  sources: string | null // JSON string of source references
  created_at: string
}

/**
 * Synced file tracking (device files downloaded)
 */
export interface SyncedFile {
  id: string
  original_filename: string
  local_filename: string
  file_path: string
  file_size: number | null
  synced_at: string
}

// =============================================================================
// New Entities (Phase 0 - Meeting Intelligence Platform)
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

// =============================================================================
// Composite Types (joins and aggregates)
// =============================================================================

/**
 * Recording with its transcript included
 */
export interface RecordingWithTranscript extends Recording {
  transcript?: Transcript
}

/**
 * Full meeting details including recordings
 */
export interface MeetingDetails {
  meeting: Meeting
  recordings: RecordingWithTranscript[]
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
// Helper Functions
// =============================================================================

/**
 * Parse attendees JSON string into typed array
 */
export function parseAttendees(attendeesJson: string | null): MeetingAttendee[] {
  if (!attendeesJson) return []
  try {
    return JSON.parse(attendeesJson)
  } catch {
    return []
  }
}

/**
 * Parse generic JSON array string
 */
export function parseJsonArray<T>(json: string | null): T[] {
  if (!json) return []
  try {
    return JSON.parse(json)
  } catch {
    return []
  }
}

/**
 * Serialize array to JSON string for database storage
 */
export function serializeJsonArray<T>(array: T[]): string {
  return JSON.stringify(array)
}
