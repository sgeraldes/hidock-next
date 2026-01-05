/**
 * Source Type Definitions
 *
 * The Source model represents immutable evidence in the Knowledge App.
 * This is the evolution of UnifiedRecording toward a multi-type source system.
 */

// Source types supported by the Library
export type SourceType = 'audio' | 'pdf' | 'markdown' | 'image' | 'web_clip'

// Processing states for sources
export type ProcessingStatus = 'none' | 'queued' | 'processing' | 'ready' | 'error'

// Location/sync status
export type SourceLocation = 'device-only' | 'local-only' | 'both'

// Quality ratings
export type QualityRating = 'valuable' | 'archived' | 'low-value' | 'garbage' | 'unrated'

// Categories for recordings
export type SourceCategory = 'meeting' | 'interview' | '1:1' | 'brainstorm' | 'note' | 'other'

// Anchor types for citations
export type SourceAnchor =
  | { kind: 'audio_time'; startMs: number; endMs: number }
  | { kind: 'text_range'; startOffset: number; endOffset: number }
  | { kind: 'page_range'; startPage: number; endPage: number }

// Base source interface (common fields)
interface SourceBase {
  id: string
  type: SourceType
  title: string
  capturedAt: string // ISO 8601
  location: SourceLocation
  processingStatus: ProcessingStatus

  // Optional metadata
  parentId?: string // For organizing in notebooks/projects
  size?: number
  duration?: number // For audio/video

  // AI-generated metadata
  quality?: QualityRating
  category?: SourceCategory
  summary?: string
}

// Audio source (current primary type)
export interface AudioSource extends SourceBase {
  type: 'audio'
  filename: string
  localPath?: string
  deviceFilename?: string

  // Transcription
  transcriptionStatus: 'none' | 'pending' | 'processing' | 'complete' | 'error'
  transcript?: {
    fullText: string
    language: string
    summary?: string
    actionItems?: string[]
    keyPoints?: string[]
    topics?: string[]
  }

  // Linked entities
  meetingId?: string
  knowledgeCaptureId?: string
}

// PDF source (future)
export interface PDFSource extends SourceBase {
  type: 'pdf'
  filename: string
  localPath: string
  pageCount: number
}

// Markdown source (future)
export interface MarkdownSource extends SourceBase {
  type: 'markdown'
  filename: string
  localPath: string
  content?: string
}

// Image source (future)
export interface ImageSource extends SourceBase {
  type: 'image'
  filename: string
  localPath: string
  width?: number
  height?: number
}

// Web clip source (future)
export interface WebClipSource extends SourceBase {
  type: 'web_clip'
  url: string
  localPath?: string
  clippedAt: string
}

// Discriminated union of all source types
export type Source = AudioSource | PDFSource | MarkdownSource | ImageSource | WebClipSource

// Type guards
export function isAudioSource(source: Source): source is AudioSource {
  return source.type === 'audio'
}

export function isPDFSource(source: Source): source is PDFSource {
  return source.type === 'pdf'
}

export function isMarkdownSource(source: Source): source is MarkdownSource {
  return source.type === 'markdown'
}

export function isImageSource(source: Source): source is ImageSource {
  return source.type === 'image'
}

export function isWebClipSource(source: Source): source is WebClipSource {
  return source.type === 'web_clip'
}

export function hasLocalFile(source: Source): boolean {
  if ('localPath' in source && source.localPath) return true
  return false
}

export function isDeviceOnlySource(source: Source): boolean {
  return source.location === 'device-only'
}
