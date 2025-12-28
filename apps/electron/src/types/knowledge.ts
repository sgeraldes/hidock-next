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



export interface Conversation {

  id: string

  title?: string

  contextIds: string[]

  createdAt: string

  updatedAt: string

}



export interface Message {



  id: string



  conversationId?: string



  role: 'user' | 'assistant'



  content: string



  sources?: string // JSON string of source info



  createdAt: string



  



  // New fields from spec



  editedAt?: string



  originalContent?: string



  createdOutputId?: string



  savedAsInsightId?: string



}







export type PersonType = 'team' | 'candidate' | 'customer' | 'external' | 'unknown'







export interface Person {







  id: string







  name: string







  email?: string | null







  type: PersonType







  role?: string | null







  company?: string | null







  notes?: string | null







  tags: string[]







  firstSeenAt: string







  lastSeenAt: string







  interactionCount: number







  createdAt: string







  







  // Knowledge connections (computed or fetched separately)







  knowledgeIds?: string[]







  topicFrequencies?: Record<string, number>







  relatedPeople?: string[]







}















export interface Project {















  id: string















  name: string















  status: 'active' | 'archived'















  description?: string | null















  createdAt: string















  















  // Aggregated data















  knowledgeIds?: string[]















  personIds?: string[]















}































export type ActionableStatus = 'pending' | 'in_progress' | 'generated' | 'shared' | 'dismissed'































export interface Actionable {















  id: string















  type: string















  title: string















  description?: string | null















  sourceKnowledgeId: string















  sourceActionItemId?: string | null















  suggestedTemplate?: string | null















  suggestedRecipients: string[]















  status: ActionableStatus















  artifactId?: string | null















  generatedAt?: string | null















  sharedAt?: string | null















  createdAt: string















  updatedAt: string















}




























