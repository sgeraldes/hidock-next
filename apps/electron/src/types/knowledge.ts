export type QualityRating = 'valuable' | 'archived' | 'low-value' | 'garbage' | 'unrated'
export type StorageTier = 'hot' | 'cold' | 'expiring' | 'deleted'
export type AudioSourceType = 'device' | 'local' | 'imported' | 'cloud'
export type ActionItemPriority = 'low' | 'medium' | 'high' | 'urgent'
export type ActionItemStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled'
export type KnowledgeCaptureStatus = 'processing' | 'ready' | 'enriched'

export interface KnowledgeCapture {
  id: string
  title: string
  summary?: string | null

  // Processing status (from spec)
  status?: KnowledgeCaptureStatus

  // Quality assessment
  quality: QualityRating
  qualityConfidence?: number | null
  qualityAssessedAt?: string | null

  // Storage tier and retention
  storageTier: StorageTier
  retentionDays?: number | null
  expiresAt?: string | null

  // Meeting correlation
  meetingId?: string | null
  correlationConfidence?: number | null
  correlationMethod?: string | null

  // Source tracking
  sourceRecordingId?: string | null

  // Timestamps
  capturedAt: string
  createdAt?: string
  updatedAt?: string
  deletedAt?: string | null
}

export interface AudioSource {
  id: string
  knowledgeCaptureId: string

  // Source type and paths
  type: AudioSourceType
  devicePath?: string | null
  localPath?: string | null
  cloudUrl?: string | null

  // File metadata
  filename: string
  fileSize?: number | null
  durationSeconds?: number | null
  format?: string | null

  // Sync tracking
  syncedFromDeviceAt?: string | null
  uploadedToCloudAt?: string | null

  createdAt?: string
  updatedAt?: string
}

export interface ActionItem {
  id: string
  knowledgeCaptureId: string

  // Action item content
  content: string
  assignee?: string | null
  dueDate?: string | null

  // Priority and status
  priority: ActionItemPriority
  status: ActionItemStatus

  // Extraction metadata
  extractedFrom?: string | null
  confidence?: number | null

  createdAt: string
  updatedAt?: string
}