// Migration API type definitions
export interface MigrationCleanupPreview {
  orphanedTranscripts: Array<{ id: string; recording_id: string }>
  duplicateRecordings: Array<{ id: string; filename: string; count: number }>
  invalidMeetingRefs: Array<{ id: string; meeting_id: string }>
  error?: string
}

export interface MigrationCleanupResult {
  success: boolean
  orphanedTranscriptsRemoved: number
  duplicateRecordingsRemoved: number
  invalidMeetingRefsFixed: number
  errors: string[]
}

export interface MigrationResult {
  success: boolean
  capturesCreated: number
  errors: string[]
}

export interface MigrationRollbackResult {
  success: boolean
  errors: string[]
}

export interface MigrationStatus {
  pending: number
  migrated: number
  skipped: number
  total: number
  error?: string
}

export interface MigrationProgress {
  phase: 'creating_tables' | 'migrating_data' | 'complete' | 'error'
  progress: number
  processed?: number
  total?: number
  error?: string
}

// BUG A — misbundled-recording repair (stale-data cleanup).
export interface MisbundledRecording {
  recordingId: string
  filename: string | null
  dateRecorded: string
  currentMeetingId: string
  currentMeetingSubject: string | null
  currentMeetingStart: string
  currentMeetingEnd: string
  gapHours: number
  action: 'rebundle' | 'unlink'
  targetMeetingId: string | null
  targetMeetingStart: string | null
}

export interface MisbundleRepairReport {
  dryRun: boolean
  totalCount: number
  applied: number
  sample: MisbundledRecording[]
  sampleTruncated: boolean
  error?: string
}

export interface MigrationAPI {
  previewCleanup: () => Promise<MigrationCleanupPreview>
  runCleanup: () => Promise<MigrationCleanupResult>
  runV11: () => Promise<MigrationResult>
  rollbackV11: () => Promise<MigrationRollbackResult>
  getStatus: () => Promise<MigrationStatus>
  onProgress: (callback: (progress: MigrationProgress) => void) => () => void
  /** BUG A: dry-run — returns count + sample of misbundled recordings, rewrites nothing. */
  previewMisbundledRecordings: () => Promise<MisbundleRepairReport>
  /** BUG A: applies the repair (rebundle onto matching sibling occurrence, or unlink). */
  applyMisbundledRecordings: () => Promise<MisbundleRepairReport>
}
