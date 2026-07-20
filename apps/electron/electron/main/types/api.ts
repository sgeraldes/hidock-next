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
import type { Person } from '@/types/knowledge'

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
  | 'RATE_LIMITED'
  // ADV25-3 (round-26) — an identity merge suggestion whose supporting evidence
  // became excluded/deleted between surfacing and accept (accept-time TOCTOU guard).
  | 'SUGGESTION_STALE'
  // ADV27-4 (round-28) — a bucket-mention resolve targeting a recording that became
  // ineligible (excluded/deleted/hard-purged) between load and click (accept-time recheck).
  | 'RECORDING_INELIGIBLE'
  // ADV36-2 (round-38) — an entity merge refused because one/both sides are not
  // visible on the non-owner identity boundary (would launder a suppressed entity).
  | 'MERGE_NOT_ALLOWED'
  // ADV36-3 (round-38) — a duplicate-name visibility check could not be evaluated
  // (transient failure); the create is refused RETRYABLY rather than minting a twin.
  | 'RETRYABLE_ERROR'
  // ADV37 (round-39) — a bucket-mention resolve targeting a contact that is SUPPRESSED
  // on the non-owner identity boundary (linking it would reanimate the hidden entity).
  | 'CONTACT_INELIGIBLE'
  // ADV38-1 (round-40) — a mutation (actionItems:setAssignee) on an action item whose
  // SOURCE capture/recording is excluded (personal/deleted/value-excluded/hard-purged)
  // or cannot be verified; refused so the excluded derivative's content is not
  // read/updated/returned.
  | 'ACTIONABLE_INELIGIBLE'
  /** Unmerge rejected: a newer open merge depends on this journal's entities (undo it first). */
  | 'MERGE_ORDER_CONFLICT'

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
 * RAG chat response — CONTENT-FREE (ADV22-1, round-23).
 *
 * The RAG chat IPC returns ONLY a generation id + a non-content status. The
 * generated answer TEXT and its source excerpts stay in main's PendingGeneration
 * (keyed by `generationId`) and reach the renderer through EXACTLY ONE sanitized
 * path — assistant:addMessage(generationId) — which revalidates provenance at
 * persist time and redacts via the shared read boundary. Releasing the raw answer
 * here would bypass that final revalidation (a recording/capture can be excluded
 * DURING the provider await, after the pre-call eligibility check).
 */
export interface RAGChatResponse {
  /** ADV19-4 — unique id bound to this answer's provenance; pass to assistant:addMessage. */
  generationId?: string
  /** Generation outcome. Answer content is released ONLY via assistant:addMessage. */
  status: 'ok' | 'error'
  /** Non-content status/error message for a failed generation (never answer text or sources). */
  error?: string
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
  /** Non-transcript origin of the chunk, e.g. 'image' for a screenshot capture. */
  sourceType?: string
  /** knowledge_capture id backing a non-meeting source, so the renderer can link it. */
  captureId?: string
}

// =============================================================================
// Contacts API Types
// =============================================================================

/**
 * Request to get all contacts with optional search
 */
export interface GetContactsRequest {
  search?: string
  type?: 'team' | 'candidate' | 'customer' | 'external' | 'unknown' | 'all'
  sortBy?: 'name' | 'lastSeen' | 'interactions'
  limit?: number
  offset?: number
}

/**
 * Response with paginated contacts (server maps rows to Person before returning)
 */
export interface GetContactsResponse {
  contacts: Person[]
  total: number
}

/**
 * Request to get contact by ID
 */
export interface GetContactByIdRequest {
  id: string
}

/**
 * Request to create a new contact (manual "Add Person")
 */
export interface CreateContactRequest {
  name: string
  email?: string | null
  type?: 'team' | 'candidate' | 'customer' | 'external' | 'unknown'
  role?: string
  company?: string
}

/**
 * Request to update contact
 */
export interface UpdateContactRequest {
  id: string
  name?: string
  email?: string | null
  notes?: string
  type?: 'team' | 'candidate' | 'customer' | 'external' | 'unknown'
  role?: string
  company?: string
  tags?: string[]
}

// =============================================================================
// Projects API Types
// =============================================================================

/**
 * Request to get all projects
 */
export interface GetProjectsRequest {
  search?: string
  status?: 'active' | 'archived' | 'all'
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
  description?: string | null
  status?: 'active' | 'archived'
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
export type OutputTemplateId = 'meeting_minutes' | 'interview_feedback' | 'project_status' | 'action_items' | 'claude_code_prompt'

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
  knowledgeCaptureId?: string
  actionableId?: string
}

/**
 * Generated output response
 */
export interface GenerateOutputResponse {
  content: string
  templateId: OutputTemplateId
  generatedAt: string
  /** Absolute path of the auto-exported markdown file, when export succeeded */
  savedPath?: string
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
// Artifacts API Types (C0 entity-type foundation)
// =============================================================================

/** Slim view of an artifacts row returned to the renderer (no full text blob). */
export interface ArtifactSummary {
  id: string
  knowledgeCaptureId: string | null
  kind: string
  mime: string | null
  size: number | null
  storagePath: string | null
  hasText: boolean
  metadata: Record<string, unknown> | null
  createdAt: string
}

/** Import outcome for one file: the summary plus dedup + indexing info. */
export interface ArtifactImportSummary extends ArtifactSummary {
  deduped: boolean
  indexedChunks: number
}

/** Artifacts namespace for electronAPI */
export interface ArtifactsAPI {
  import: (filePaths: string[]) => Promise<Result<ArtifactImportSummary[]>>
  pickAndImport: () => Promise<Result<ArtifactImportSummary[]>>
  getForCapture: (knowledgeCaptureId: string) => Promise<Result<ArtifactSummary[]>>
  openInFolder: (id: string) => Promise<Result<void>>
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
  create: (request: CreateContactRequest) => Promise<Result<Person>>
  update: (request: UpdateContactRequest) => Promise<Result<Contact>>
  merge: (request: MergeContactsRequest) => Promise<Result<Person>>
}

/**
 * Request to merge one contact into another (keeper survives)
 */
export interface MergeContactsRequest {
  keeperId: string
  loserId: string
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
  /** Backend that will serve chat requests: 'gemini' | 'ollama' | 'none'. */
  backend: 'gemini' | 'ollama' | 'none'
  /** True when a chat backend (Gemini key or reachable Ollama) is available. */
  chatAvailable: boolean
  /** Retained for backward compatibility; true when local Ollama is reachable. */
  ollamaAvailable: boolean
  documentCount: number
  meetingCount: number
  ready: boolean
  /**
   * The ACTIVE embedding provider partition (2026-07 provider partitions).
   * Retrieval searches ONLY this partition — `embedDocumentCount` is the
   * honest "chunks the assistant can actually search" number, and `ready`
   * requires it to be > 0 (a just-switched provider with a pending reindex
   * shows 0 ⇒ not ready, instead of claiming the whole library is searchable).
   */
  embedProvider: string | null
  /** Badge-friendly short label ('Gemini', 'Ollama', 'Nemotron Local'). */
  embedProviderLabel: string | null
  /** Eligible chunks in the ACTIVE provider's partition. */
  embedDocumentCount: number
}
