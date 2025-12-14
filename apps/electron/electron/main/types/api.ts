/**
 * API Types
 *
 * Type definitions for IPC request/response patterns and API contracts.
 * All IPC handlers should use these types for consistent, type-safe communication.
 */

import type {
  Contact,
  ContactWithMeetings,
  MeetingWithAssociations,
  Project,
  ProjectWithMeetings
} from './database'

// =============================================================================
// Result Wrapper Pattern
// =============================================================================

/**
 * Standardized success response
 */
export interface SuccessResult<T> {
  success: true
  data: T
}

/**
 * Standardized error response
 */
export interface ErrorResult {
  success: false
  error: {
    code: ErrorCode
    message: string
    details?: unknown
  }
}

/**
 * Union type for all IPC responses
 */
export type Result<T> = SuccessResult<T> | ErrorResult

/**
 * Helper to create success result
 */
export function success<T>(data: T): SuccessResult<T> {
  return { success: true, data }
}

/**
 * Helper to create error result
 */
export function error(code: ErrorCode, message: string, details?: unknown): ErrorResult {
  return { success: false, error: { code, message, details } }
}

/**
 * Type guard to check if result is success
 */
export function isSuccess<T>(result: Result<T>): result is SuccessResult<T> {
  return result.success === true
}

/**
 * Type guard to check if result is error
 */
export function isError<T>(result: Result<T>): result is ErrorResult {
  return result.success === false
}

// =============================================================================
// Error Codes
// =============================================================================

export type ErrorCode =
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'DATABASE_ERROR'
  | 'DUPLICATE_ENTRY'
  | 'INVALID_INPUT'
  | 'SERVICE_UNAVAILABLE'
  | 'OLLAMA_UNAVAILABLE'
  | 'TRANSCRIPTION_ERROR'
  | 'INTERNAL_ERROR'
  | 'UNAUTHORIZED'

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

/**
 * RAG chat request parameters
 */
export interface RAGChatRequest {
  sessionId: string
  message: string
  filter?: RAGFilter
}

/**
 * RAG chat response with sources
 */
export interface RAGChatResponse {
  answer: string
  sources: RAGSource[]
}

/**
 * Source reference from RAG search
 */
export interface RAGSource {
  content: string
  meetingId?: string
  subject?: string
  timestamp?: string
  score: number
}

// =============================================================================
// Contacts API Types
// =============================================================================

/**
 * Request to get all contacts with optional search
 */
export interface GetContactsRequest {
  search?: string
  limit?: number
  offset?: number
}

/**
 * Response with paginated contacts
 */
export interface GetContactsResponse {
  contacts: Contact[]
  total: number
}

/**
 * Request to get contact by ID
 */
export interface GetContactByIdRequest {
  id: string
}

/**
 * Request to update contact
 */
export interface UpdateContactRequest {
  id: string
  notes?: string
}

// =============================================================================
// Projects API Types
// =============================================================================

/**
 * Request to get all projects
 */
export interface GetProjectsRequest {
  search?: string
  limit?: number
  offset?: number
}

/**
 * Response with paginated projects
 */
export interface GetProjectsResponse {
  projects: Project[]
  total: number
}

/**
 * Request to get project by ID
 */
export interface GetProjectByIdRequest {
  id: string
}

/**
 * Request to create new project
 */
export interface CreateProjectRequest {
  name: string
  description?: string
}

/**
 * Request to update project
 */
export interface UpdateProjectRequest {
  id: string
  name?: string
  description?: string
}

/**
 * Request to tag/untag meeting to project
 */
export interface TagMeetingRequest {
  meetingId: string
  projectId: string
}

// =============================================================================
// Output Generation API Types
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
  prompt: string
}

/**
 * Request to generate output
 */
export interface GenerateOutputRequest {
  templateId: OutputTemplateId
  meetingId?: string
  projectId?: string
  contactId?: string
}

/**
 * Generated output response
 */
export interface GenerateOutputResponse {
  content: string
  templateId: OutputTemplateId
  generatedAt: string
}

// =============================================================================
// Meetings API Types (Extended)
// =============================================================================

/**
 * Extended meeting query with filters
 */
export interface GetMeetingsRequest {
  startDate?: string
  endDate?: string
  contactId?: string
  projectId?: string
  status?: 'all' | 'recorded' | 'transcribed'
  search?: string
  limit?: number
  offset?: number
}

/**
 * Response with paginated meetings
 */
export interface GetMeetingsResponse {
  meetings: MeetingWithAssociations[]
  total: number
}

// =============================================================================
// Preload API Type Exports
// =============================================================================

/**
 * Contacts namespace for electronAPI
 */
export interface ContactsAPI {
  getAll: (request?: GetContactsRequest) => Promise<Result<GetContactsResponse>>
  getById: (id: string) => Promise<Result<ContactWithMeetings>>
  update: (request: UpdateContactRequest) => Promise<Result<Contact>>
}

/**
 * Projects namespace for electronAPI
 */
export interface ProjectsAPI {
  getAll: (request?: GetProjectsRequest) => Promise<Result<GetProjectsResponse>>
  getById: (id: string) => Promise<Result<ProjectWithMeetings>>
  create: (request: CreateProjectRequest) => Promise<Result<Project>>
  update: (request: UpdateProjectRequest) => Promise<Result<Project>>
  delete: (id: string) => Promise<Result<void>>
  tagMeeting: (request: TagMeetingRequest) => Promise<Result<void>>
  untagMeeting: (request: TagMeetingRequest) => Promise<Result<void>>
}

/**
 * Outputs namespace for electronAPI
 */
export interface OutputsAPI {
  getTemplates: () => Promise<Result<OutputTemplate[]>>
  generate: (request: GenerateOutputRequest) => Promise<Result<GenerateOutputResponse>>
}

/**
 * Extended RAG namespace for electronAPI
 */
export interface ExtendedRAGAPI {
  status: () => Promise<Result<RAGStatus>>
  chat: (request: RAGChatRequest) => Promise<Result<RAGChatResponse>>
  summarizeMeeting: (meetingId: string) => Promise<Result<string>>
  findActionItems: (meetingId?: string) => Promise<Result<string>>
  clearSession: (sessionId: string) => Promise<Result<void>>
}

/**
 * RAG service status
 */
export interface RAGStatus {
  ollamaAvailable: boolean
  documentCount: number
  meetingCount: number
  ready: boolean
}
