/**
 * Data Integrity Service
 *
 * Ensures consistency between:
 * - Device files (HiDock)
 * - Local file system (recordings folder)
 * - Database records (recordings, synced_files tables)
 *
 * Runs checks on startup and provides on-demand health checks.
 */

import { existsSync, readdirSync, statSync, unlinkSync, utimesSync, renameSync } from 'fs'
import { join, extname, basename } from 'path'
import { BrowserWindow } from 'electron'
import {
  getDatabase,
  queryAll,
  run,
  saveDatabase,
  getRecordingByFilename,
  getSyncedFile,
  addSyncedFile,
  removeSyncedFile,
  Recording,
  SyncedFile
} from './database'
import { getRecordingsPath } from './file-storage'

// =============================================================================
// Types
// =============================================================================

export interface IntegrityIssue {
  id: string
  type: 'orphaned_download' | 'missing_file' | 'orphaned_file' | 'date_mismatch' | 'size_mismatch' | 'incomplete_download'
  severity: 'low' | 'medium' | 'high'
  description: string
  filePath?: string
  filename?: string
  recordingId?: string
  suggestedAction: 'delete' | 'repair' | 'ignore' | 'manual'
  autoRepairable: boolean
  details?: Record<string, unknown>
}

export interface IntegrityReport {
  scanStarted: string
  scanCompleted: string
  totalIssues: number
  issuesByType: Record<string, number>
  issuesBySeverity: Record<string, number>
  issues: IntegrityIssue[]
  autoRepairableCount: number
}

export interface RepairResult {
  issueId: string
  success: boolean
  action: string
  error?: string
}

// =============================================================================
// Filename Date Parsing
// =============================================================================

// Month name mapping for HiDock filename parsing
const MONTH_NAMES: Record<string, number> = {
  'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
  'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
}

/**
 * Parse recording date from HiDock filename formats.
 * Supports:
 * - 2025Jul08-160405-Rec59.hda (YYYYMonDD-HHMMSS format)
 * - 2025-07-08_1604.wav (YYYY-MM-DD_HHMM format, our saved format)
 * - HDA_20250708_160405.hda (HDA_YYYYMMDD_HHMMSS format)
 */
function parseHiDockFilenameDate(filename: string): Date | undefined {
  // Format 1: 2025Jul08-160405-Rec59.hda (YYYYMonDD-HHMMSS) - Device format
  const monthNameMatch = filename.match(/(\d{4})(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)(\d{1,2})-(\d{2})(\d{2})(\d{2})/)
  if (monthNameMatch) {
    const [, year, monthName, day, hour, minute, second] = monthNameMatch
    const month = MONTH_NAMES[monthName]
    if (month !== undefined) {
      return new Date(
        parseInt(year),
        month,
        parseInt(day),
        parseInt(hour),
        parseInt(minute),
        parseInt(second)
      )
    }
  }

  // Format 2: 2025-07-08_1604.wav (YYYY-MM-DD_HHMM) - Our saved format
  const savedMatch = filename.match(/(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})/)
  if (savedMatch) {
    const [, year, month, day, hour, minute] = savedMatch
    return new Date(
      parseInt(year),
      parseInt(month) - 1,
      parseInt(day),
      parseInt(hour),
      parseInt(minute),
      0
    )
  }

  // Format 3: HDA_20250708_160405.hda or YYYYMMDDHHMMSS
  const numericMatch = filename.match(/(\d{4})[-_]?(\d{2})[-_]?(\d{2})[-_]?(\d{2})(\d{2})(\d{2})/)
  if (numericMatch) {
    const [, year, month, day, hour, minute, second] = numericMatch
    return new Date(
      parseInt(year),
      parseInt(month) - 1,
      parseInt(day),
      parseInt(hour),
      parseInt(minute),
      parseInt(second)
    )
  }

  return undefined
}

/**
 * Generate a proper filename with date prefix from an original date
 */
function generateCorrectFilename(originalFilename: string, recordingDate: Date): string {
  const datePrefix = recordingDate.toISOString().split('T')[0]
  const timePrefix = `${String(recordingDate.getHours()).padStart(2, '0')}${String(recordingDate.getMinutes()).padStart(2, '0')}`

  // Extract existing suffix (like -meeting-name.wav) if present
  const ext = extname(originalFilename)
  const base = basename(originalFilename, ext)

  // Check if there's already a description suffix after the time
  const suffixMatch = base.match(/-([^-]+)$/)
  const suffix = suffixMatch ? `-${suffixMatch[1]}` : ''

  return `${datePrefix}_${timePrefix}${suffix}${ext === '.hda' ? '.wav' : ext}`
}

// =============================================================================
// Integrity Service
// =============================================================================

class IntegrityService {
  private lastReport: IntegrityReport | null = null

  /**
   * Run all startup integrity checks
   * Called when the app initializes
   */
  async runStartupChecks(): Promise<{ issuesFound: number; issuesFixed: number }> {
    console.log('[IntegrityService] Running startup integrity checks...')

    let issuesFound = 0
    let issuesFixed = 0

    // 1. Reset orphaned downloads (stuck in 'downloading' status)
    const orphanedResult = this.resetOrphanedDownloads()
    issuesFound += orphanedResult.found
    issuesFixed += orphanedResult.fixed

    // 2. Reset stuck transcriptions
    const transcriptionResult = this.resetStuckTranscriptions()
    issuesFound += transcriptionResult.found
    issuesFixed += transcriptionResult.fixed

    console.log(`[IntegrityService] Startup checks complete: ${issuesFound} issues found, ${issuesFixed} fixed`)
    return { issuesFound, issuesFixed }
  }

  /**
   * Reset downloads that are stuck in 'downloading' status
   * This happens when the app crashes during a download
   */
  resetOrphanedDownloads(): { found: number; fixed: number } {
    console.log('[IntegrityService] Checking for orphaned downloads...')

    // Check recordings table for any stuck in downloading-related states
    // Note: The main download state is in the DownloadService queue (in-memory)
    // But we also track in recordings table via on_local and file_path

    // Find recordings that claim to be downloading but have no file
    const stuckRecordings = queryAll<Recording>(`
      SELECT * FROM recordings
      WHERE on_local = 0
        AND file_path IS NOT NULL
        AND file_path != ''
    `)

    let fixed = 0
    for (const rec of stuckRecordings) {
      // File path is set but file doesn't exist - reset state
      if (rec.file_path && !existsSync(rec.file_path)) {
        console.log(`[IntegrityService] Resetting orphaned download: ${rec.filename}`)
        run(`UPDATE recordings SET file_path = NULL, on_local = 0 WHERE id = ?`, [rec.id])
        fixed++
      }
    }

    if (fixed > 0) {
      saveDatabase()
    }

    console.log(`[IntegrityService] Orphaned downloads: ${stuckRecordings.length} checked, ${fixed} fixed`)
    return { found: stuckRecordings.length, fixed }
  }

  /**
   * Reset transcriptions stuck in 'processing' or 'transcribing' status
   */
  resetStuckTranscriptions(): { found: number; fixed: number } {
    console.log('[IntegrityService] Checking for stuck transcriptions...')

    const db = getDatabase()

    // Reset stuck recordings
    const stuckRecordings = queryAll<{ id: string }>(`
      SELECT id FROM recordings WHERE status = 'transcribing'
    `)

    if (stuckRecordings.length > 0) {
      db.run(`UPDATE recordings SET status = 'pending' WHERE status = 'transcribing'`)
    }

    // Reset stuck queue items
    const stuckQueue = queryAll<{ id: string }>(`
      SELECT id FROM transcription_queue WHERE status = 'processing'
    `)

    if (stuckQueue.length > 0) {
      db.run(`UPDATE transcription_queue SET status = 'pending' WHERE status = 'processing'`)
    }

    const totalFixed = stuckRecordings.length + stuckQueue.length
    if (totalFixed > 0) {
      saveDatabase()
      console.log(`[IntegrityService] Reset ${stuckRecordings.length} recordings and ${stuckQueue.length} queue items`)
    }

    return { found: totalFixed, fixed: totalFixed }
  }

  /**
   * Run a full integrity scan
   * Returns a detailed report of all issues found
   */
  async runFullScan(): Promise<IntegrityReport> {
    console.log('[IntegrityService] Starting full integrity scan...')
    const startTime = new Date()
    const issues: IntegrityIssue[] = []

    // 1. Check for orphaned downloads
    issues.push(...this.findOrphanedDownloads())

    // 2. Check for missing files (in DB but not on disk)
    issues.push(...this.findMissingFiles())

    // 3. Check for orphaned files (on disk but not in DB)
    issues.push(...this.findOrphanedFiles())

    // 4. Check for date mismatches
    issues.push(...this.findDateMismatches())

    // 5. Check for size mismatches
    issues.push(...this.findSizeMismatches())

    // 6. Check for incomplete downloads (partial files)
    issues.push(...this.findIncompleteDownloads())

    const endTime = new Date()

    // Build report
    const issuesByType: Record<string, number> = {}
    const issuesBySeverity: Record<string, number> = {}
    let autoRepairableCount = 0

    for (const issue of issues) {
      issuesByType[issue.type] = (issuesByType[issue.type] || 0) + 1
      issuesBySeverity[issue.severity] = (issuesBySeverity[issue.severity] || 0) + 1
      if (issue.autoRepairable) autoRepairableCount++
    }

    const report: IntegrityReport = {
      scanStarted: startTime.toISOString(),
      scanCompleted: endTime.toISOString(),
      totalIssues: issues.length,
      issuesByType,
      issuesBySeverity,
      issues,
      autoRepairableCount
    }

    this.lastReport = report
    console.log(`[IntegrityService] Scan complete: ${issues.length} issues found`)
    return report
  }

  /**
   * Find downloads stuck in downloading state
   */
  private findOrphanedDownloads(): IntegrityIssue[] {
    const issues: IntegrityIssue[] = []

    // Check for recordings with file_path set but file doesn't exist
    const recordings = queryAll<Recording>(`
      SELECT * FROM recordings
      WHERE file_path IS NOT NULL AND file_path != ''
    `)

    for (const rec of recordings) {
      if (rec.file_path && !existsSync(rec.file_path)) {
        issues.push({
          id: `orphaned_download_${rec.id}`,
          type: 'orphaned_download',
          severity: 'medium',
          description: `Recording "${rec.filename}" has file_path set but file does not exist`,
          filename: rec.filename,
          filePath: rec.file_path,
          recordingId: rec.id,
          suggestedAction: 'repair',
          autoRepairable: true,
          details: {
            expected_path: rec.file_path,
            on_local: rec.on_local,
            location: rec.location
          }
        })
      }
    }

    return issues
  }

  /**
   * Find files that are in the database but missing from disk
   */
  private findMissingFiles(): IntegrityIssue[] {
    const issues: IntegrityIssue[] = []

    // Check synced_files table
    const syncedFiles = queryAll<SyncedFile>('SELECT * FROM synced_files')

    for (const sf of syncedFiles) {
      if (!existsSync(sf.file_path)) {
        issues.push({
          id: `missing_file_synced_${sf.id}`,
          type: 'missing_file',
          severity: 'medium',
          description: `Synced file "${sf.local_filename}" is missing from disk`,
          filename: sf.original_filename,
          filePath: sf.file_path,
          suggestedAction: 'repair',
          autoRepairable: true,
          details: {
            synced_at: sf.synced_at,
            expected_size: sf.file_size
          }
        })
      }
    }

    return issues
  }

  /**
   * Find files on disk that aren't tracked in the database
   */
  private findOrphanedFiles(): IntegrityIssue[] {
    const issues: IntegrityIssue[] = []
    const recordingsPath = getRecordingsPath()

    if (!existsSync(recordingsPath)) {
      return issues
    }

    const files = readdirSync(recordingsPath)
    const audioExtensions = ['.wav', '.mp3', '.m4a', '.ogg', '.webm', '.hda']

    for (const file of files) {
      const ext = extname(file).toLowerCase()
      if (!audioExtensions.includes(ext)) continue

      const filePath = join(recordingsPath, file)

      // Check if it's in synced_files
      const synced = getSyncedFile(file)
      if (synced) continue

      // Check if it's in recordings (by filename or wav equivalent)
      const hdaName = file.replace(/\.wav$/i, '.hda')
      const recording = getRecordingByFilename(file) || getRecordingByFilename(hdaName)

      if (!recording) {
        const stats = statSync(filePath)
        issues.push({
          id: `orphaned_file_${file}`,
          type: 'orphaned_file',
          severity: 'low',
          description: `File "${file}" exists on disk but is not tracked in database`,
          filename: file,
          filePath,
          suggestedAction: 'repair',
          autoRepairable: true,
          details: {
            size: stats.size,
            modified: stats.mtime.toISOString()
          }
        })
      }
    }

    return issues
  }

  /**
   * Find recordings with suspicious dates (e.g., year 2000, far future dates)
   * Also detects files where the filename date doesn't match the file mtime
   */
  private findDateMismatches(): IntegrityIssue[] {
    const issues: IntegrityIssue[] = []
    const now = new Date()
    const minValidDate = new Date('2020-01-01') // HiDock devices weren't made before 2020
    const maxValidDate = new Date(now.getTime() + 24 * 60 * 60 * 1000) // 1 day in future max

    // 1. Check database recordings for invalid/suspicious dates
    const recordings = queryAll<Recording>('SELECT * FROM recordings')

    for (const rec of recordings) {
      const dateRecorded = new Date(rec.date_recorded)

      if (isNaN(dateRecorded.getTime())) {
        issues.push({
          id: `date_invalid_${rec.id}`,
          type: 'date_mismatch',
          severity: 'high',
          description: `Recording "${rec.filename}" has invalid date: ${rec.date_recorded}`,
          filename: rec.filename,
          recordingId: rec.id,
          suggestedAction: 'manual',
          autoRepairable: false,
          details: { raw_date: rec.date_recorded }
        })
        continue
      }

      if (dateRecorded < minValidDate) {
        issues.push({
          id: `date_too_old_${rec.id}`,
          type: 'date_mismatch',
          severity: 'medium',
          description: `Recording "${rec.filename}" has suspicious old date: ${dateRecorded.toISOString()}`,
          filename: rec.filename,
          recordingId: rec.id,
          suggestedAction: 'repair',
          autoRepairable: true,
          details: {
            recorded_date: dateRecorded.toISOString(),
            suggested_date: rec.created_at // Use created_at as fallback
          }
        })
      } else if (dateRecorded > maxValidDate) {
        issues.push({
          id: `date_future_${rec.id}`,
          type: 'date_mismatch',
          severity: 'medium',
          description: `Recording "${rec.filename}" has future date: ${dateRecorded.toISOString()}`,
          filename: rec.filename,
          recordingId: rec.id,
          suggestedAction: 'repair',
          autoRepairable: true,
          details: {
            recorded_date: dateRecorded.toISOString(),
            suggested_date: now.toISOString()
          }
        })
      }
    }

    // 2. Scan recordings folder for files where mtime doesn't match filename date
    // This catches files that were downloaded with wrong dates (bug prior to fix)
    const recordingsPath = getRecordingsPath()
    if (existsSync(recordingsPath)) {
      const files = readdirSync(recordingsPath)
      const audioExtensions = ['.wav', '.mp3', '.m4a', '.ogg', '.webm']

      for (const file of files) {
        const ext = extname(file).toLowerCase()
        if (!audioExtensions.includes(ext)) continue

        const filePath = join(recordingsPath, file)
        const filenameDate = parseHiDockFilenameDate(file)

        if (!filenameDate) {
          // Can't parse date from filename, skip
          continue
        }

        try {
          const stats = statSync(filePath)
          const mtimeDiff = Math.abs(stats.mtime.getTime() - filenameDate.getTime())

          // If mtime differs from filename date by more than 1 hour, flag it
          // (small differences can happen due to timezone issues or processing time)
          const oneHourMs = 60 * 60 * 1000
          const oneDayMs = 24 * 60 * 60 * 1000

          if (mtimeDiff > oneDayMs) {
            // File mtime is more than a day off from filename date - likely wrong date bug
            issues.push({
              id: `file_mtime_mismatch_${file}`,
              type: 'date_mismatch',
              severity: 'high',
              description: `File "${file}" has mtime (${stats.mtime.toISOString()}) that doesn't match filename date (${filenameDate.toISOString()})`,
              filename: file,
              filePath,
              suggestedAction: 'repair',
              autoRepairable: true,
              details: {
                file_mtime: stats.mtime.toISOString(),
                filename_date: filenameDate.toISOString(),
                difference_hours: Math.round(mtimeDiff / oneHourMs),
                correct_filename: generateCorrectFilename(file, filenameDate)
              }
            })
          } else if (mtimeDiff > oneHourMs) {
            // Minor mismatch, still worth noting
            issues.push({
              id: `file_mtime_minor_${file}`,
              type: 'date_mismatch',
              severity: 'low',
              description: `File "${file}" has minor time mismatch (${Math.round(mtimeDiff / 60000)} minutes)`,
              filename: file,
              filePath,
              suggestedAction: 'repair',
              autoRepairable: true,
              details: {
                file_mtime: stats.mtime.toISOString(),
                filename_date: filenameDate.toISOString(),
                difference_minutes: Math.round(mtimeDiff / 60000)
              }
            })
          }
        } catch {
          // Skip files we can't stat
        }
      }
    }

    return issues
  }

  /**
   * Find files where database size doesn't match actual file size
   */
  private findSizeMismatches(): IntegrityIssue[] {
    const issues: IntegrityIssue[] = []

    const recordings = queryAll<Recording>(`
      SELECT * FROM recordings
      WHERE file_path IS NOT NULL AND file_size IS NOT NULL
    `)

    for (const rec of recordings) {
      if (!rec.file_path || !existsSync(rec.file_path)) continue

      try {
        const stats = statSync(rec.file_path)
        const sizeDiff = Math.abs(stats.size - (rec.file_size || 0))

        // Allow 5% tolerance for metadata differences
        const tolerance = (rec.file_size || 0) * 0.05

        if (sizeDiff > tolerance && sizeDiff > 1024) { // More than 1KB difference
          issues.push({
            id: `size_mismatch_${rec.id}`,
            type: 'size_mismatch',
            severity: 'low',
            description: `Recording "${rec.filename}" size mismatch: DB=${rec.file_size}, Disk=${stats.size}`,
            filename: rec.filename,
            filePath: rec.file_path,
            recordingId: rec.id,
            suggestedAction: 'repair',
            autoRepairable: true,
            details: {
              db_size: rec.file_size,
              disk_size: stats.size,
              difference: sizeDiff
            }
          })
        }
      } catch {
        // File may have been deleted, skip
      }
    }

    return issues
  }

  /**
   * Find downloads that may be incomplete (very small files, 0 bytes, etc.)
   */
  private findIncompleteDownloads(): IntegrityIssue[] {
    const issues: IntegrityIssue[] = []
    const recordingsPath = getRecordingsPath()

    if (!existsSync(recordingsPath)) return issues

    const files = readdirSync(recordingsPath)
    const audioExtensions = ['.wav', '.mp3', '.m4a']

    for (const file of files) {
      const ext = extname(file).toLowerCase()
      if (!audioExtensions.includes(ext)) continue

      const filePath = join(recordingsPath, file)

      try {
        const stats = statSync(filePath)

        // WAV files should have at least a header (44 bytes) + some data
        // Files under 1KB are likely incomplete
        if (stats.size < 1024) {
          issues.push({
            id: `incomplete_${file}`,
            type: 'incomplete_download',
            severity: 'high',
            description: `File "${file}" appears incomplete (${stats.size} bytes)`,
            filename: file,
            filePath,
            suggestedAction: 'delete',
            autoRepairable: true,
            details: {
              size: stats.size,
              modified: stats.mtime.toISOString()
            }
          })
        }
      } catch {
        // Skip files we can't stat
      }
    }

    return issues
  }

  /**
   * Repair a specific issue
   */
  async repairIssue(issueId: string): Promise<RepairResult> {
    if (!this.lastReport) {
      return { issueId, success: false, action: 'none', error: 'No scan report available' }
    }

    const issue = this.lastReport.issues.find(i => i.id === issueId)
    if (!issue) {
      return { issueId, success: false, action: 'none', error: 'Issue not found' }
    }

    if (!issue.autoRepairable) {
      return { issueId, success: false, action: 'none', error: 'Issue requires manual repair' }
    }

    try {
      switch (issue.type) {
        case 'orphaned_download':
          return this.repairOrphanedDownload(issue)
        case 'missing_file':
          return this.repairMissingFile(issue)
        case 'orphaned_file':
          return this.repairOrphanedFile(issue)
        case 'date_mismatch':
          return this.repairDateMismatch(issue)
        case 'size_mismatch':
          return this.repairSizeMismatch(issue)
        case 'incomplete_download':
          return this.repairIncompleteDownload(issue)
        default:
          return { issueId, success: false, action: 'none', error: 'Unknown issue type' }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      return { issueId, success: false, action: 'repair', error: errorMsg }
    }
  }

  /**
   * Repair all auto-repairable issues
   */
  async repairAllAuto(): Promise<RepairResult[]> {
    if (!this.lastReport) {
      return []
    }

    const results: RepairResult[] = []
    const autoRepairable = this.lastReport.issues.filter(i => i.autoRepairable)

    for (const issue of autoRepairable) {
      const result = await this.repairIssue(issue.id)
      results.push(result)
    }

    return results
  }

  // ==========================================================================
  // Repair Methods
  // ==========================================================================

  private repairOrphanedDownload(issue: IntegrityIssue): RepairResult {
    if (!issue.recordingId) {
      return { issueId: issue.id, success: false, action: 'repair', error: 'No recording ID' }
    }

    // Reset the file_path and on_local flag
    run(`UPDATE recordings SET file_path = NULL, on_local = 0, location =
      CASE WHEN on_device = 1 THEN 'device-only' ELSE 'deleted' END
      WHERE id = ?`, [issue.recordingId])
    saveDatabase()

    return { issueId: issue.id, success: true, action: 'Reset file path and local status' }
  }

  private repairMissingFile(issue: IntegrityIssue): RepairResult {
    if (!issue.filename) {
      return { issueId: issue.id, success: false, action: 'repair', error: 'No filename' }
    }

    // Remove from synced_files since the file doesn't exist
    removeSyncedFile(issue.filename)

    // Also update recording if it exists
    const recording = getRecordingByFilename(issue.filename)
    if (recording) {
      run(`UPDATE recordings SET file_path = NULL, on_local = 0, location =
        CASE WHEN on_device = 1 THEN 'device-only' ELSE 'deleted' END
        WHERE id = ?`, [recording.id])
    }
    saveDatabase()

    return { issueId: issue.id, success: true, action: 'Removed missing file from database tracking' }
  }

  private repairOrphanedFile(issue: IntegrityIssue): RepairResult {
    if (!issue.filename || !issue.filePath) {
      return { issueId: issue.id, success: false, action: 'repair', error: 'No filename or path' }
    }

    // Add the orphaned file to synced_files
    const stats = statSync(issue.filePath)
    addSyncedFile(issue.filename, issue.filename, issue.filePath, stats.size)
    saveDatabase()

    return { issueId: issue.id, success: true, action: 'Added orphaned file to database' }
  }

  private repairDateMismatch(issue: IntegrityIssue): RepairResult {
    // Handle file mtime mismatch (fix file modification time)
    if (issue.id.startsWith('file_mtime_')) {
      if (!issue.filePath || !issue.details?.filename_date) {
        return { issueId: issue.id, success: false, action: 'repair', error: 'No file path or filename date' }
      }

      try {
        const correctDate = new Date(issue.details.filename_date as string)

        // Fix the file's modification time
        utimesSync(issue.filePath, correctDate, correctDate)

        // Also update the database if there's a recording entry
        if (issue.filename) {
          const recording = getRecordingByFilename(issue.filename)
          if (recording) {
            run(`UPDATE recordings SET date_recorded = ? WHERE id = ?`, [correctDate.toISOString(), recording.id])
            saveDatabase()
          }
        }

        return { issueId: issue.id, success: true, action: `Fixed file mtime to ${correctDate.toISOString()}` }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error'
        return { issueId: issue.id, success: false, action: 'repair', error: errorMsg }
      }
    }

    // Handle database date mismatch (original logic)
    if (!issue.recordingId || !issue.details?.suggested_date) {
      return { issueId: issue.id, success: false, action: 'repair', error: 'No recording ID or suggested date' }
    }

    const suggestedDate = issue.details.suggested_date as string
    run(`UPDATE recordings SET date_recorded = ? WHERE id = ?`, [suggestedDate, issue.recordingId])
    saveDatabase()

    return { issueId: issue.id, success: true, action: `Updated date to ${suggestedDate}` }
  }

  private repairSizeMismatch(issue: IntegrityIssue): RepairResult {
    if (!issue.recordingId || !issue.details?.disk_size) {
      return { issueId: issue.id, success: false, action: 'repair', error: 'No recording ID or disk size' }
    }

    const diskSize = issue.details.disk_size as number
    run(`UPDATE recordings SET file_size = ? WHERE id = ?`, [diskSize, issue.recordingId])
    saveDatabase()

    return { issueId: issue.id, success: true, action: `Updated size to ${diskSize} bytes` }
  }

  private repairIncompleteDownload(issue: IntegrityIssue): RepairResult {
    if (!issue.filePath || !issue.filename) {
      return { issueId: issue.id, success: false, action: 'repair', error: 'No file path' }
    }

    // Delete the incomplete file
    try {
      unlinkSync(issue.filePath)
    } catch {
      // File may already be gone
    }

    // Remove from synced_files if present
    removeSyncedFile(issue.filename)

    // Reset recording if it exists
    const recording = getRecordingByFilename(issue.filename)
    if (recording) {
      run(`UPDATE recordings SET file_path = NULL, on_local = 0, location =
        CASE WHEN on_device = 1 THEN 'device-only' ELSE 'deleted' END
        WHERE id = ?`, [recording.id])
    }
    saveDatabase()

    return { issueId: issue.id, success: true, action: 'Deleted incomplete file and reset tracking' }
  }

  /**
   * Get the last scan report
   */
  getLastReport(): IntegrityReport | null {
    return this.lastReport
  }

  /**
   * Emit progress to renderer windows
   */
  private emitProgress(message: string, progress: number): void {
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send('integrity:progress', { message, progress })
      }
    }
  }
}

// =============================================================================
// Singleton
// =============================================================================

let integrityServiceInstance: IntegrityService | null = null

export function getIntegrityService(): IntegrityService {
  if (!integrityServiceInstance) {
    integrityServiceInstance = new IntegrityService()
  }
  return integrityServiceInstance
}
