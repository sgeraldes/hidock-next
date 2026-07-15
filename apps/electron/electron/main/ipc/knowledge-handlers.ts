
import { ipcMain } from 'electron'
import { queryAll, queryOne, run, setKnowledgeProjects } from '../services/database'
import {
  filterEligibleCaptureIds,
  existingRecordings,
  CAPTURE_VALUE_EXCLUDED_RATINGS
} from '../services/recording-eligibility'
import type { KnowledgeCapture } from '@/types/knowledge'
import { success, error, Result } from '../types/api'
import { z } from 'zod'
import { UUIDSchema } from '../validation/common'

const SetKnowledgeProjectsRequestSchema = z.object({
  knowledgeCaptureId: UUIDSchema,
  projectIds: z.array(UUIDSchema)
})

// B-CHAT-007: Explicit column list instead of SELECT *
const KNOWLEDGE_CAPTURE_COLUMNS = `id, title, summary, category, status, quality_rating, quality_confidence, quality_assessed_at, quality_reasons, quality_source, storage_tier, retention_days, expires_at, meeting_id, correlation_confidence, correlation_method, source_recording_id, captured_at, created_at, updated_at, deleted_at`

// =============================================================================
// ROUND-15 RESIDUAL (ADV14 follow-up) — knowledge-capture DISPLAY-tier gating.
//
// knowledge:getAll / getById / getByIds expose AI-derived capture summary+title
// to NON-EXEMPT assistant / discovery surfaces (ContextPicker, Chat,
// ActionableDetail, Projects). A capture DERIVED from an excluded recording
// (personal / soft-deleted / value-excluded / hard-purged) must NOT surface its
// summary/title there. Captures relate to a recording via `source_recording_id`;
// value-exclusion for recording-derived captures lives on the RECORDING via the
// shared positive allowlist (filterEligibleRecordingIds → getEligibleRecordingIds,
// which UNIONs personal/deleted with the F16 capture value predicate). A
// standalone (manual/artifact) capture has NO source recording and follows its
// own lifecycle — excluded only when its OWN quality_rating is value-excluded.
//
// TWO TIERS (round-14 pattern):
//  • DEFAULT (gated, assistant/DISPLAY-safe): recording-derived capture kept iff
//    its source recording is ELIGIBLE; standalone kept unless its own rating is
//    value-excluded; fail-closed → drop everything.
//  • OWNER (knowledge:getAllOwner, owner Library): recording-derived capture kept
//    iff its source recording ROW EXISTS (soft-deleted/personal/value-excluded
//    allowed so the owner can still see+manage their own value badges; hard-purged
//    / orphan dropped). Standalone handling is IDENTICAL to the gated tier — the
//    owner store slice (useUnifiedRecordings) is ALSO read by an assistant DISPLAY
//    surface (Today via useTodayCaptures, which surfaces standalone non-audio
//    captures), so standalone results MUST match the gate to avoid a value-gate
//    bypass on Today. The owner tier differs ONLY for recording-derived captures,
//    which are audio and never shown on Today.
// =============================================================================

/** Raw capture row shape the eligibility gate needs (rest of the columns pass through). */
type CaptureRow = { id: string; source_recording_id: string | null; quality_rating: string | null; [k: string]: unknown }

/**
 * Apply the capture eligibility gate to a batch of raw capture rows.
 *
 * GATED (assistant/DISPLAY-safe) routes EVERY row through the ONE shared central
 * capture boundary {@link filterEligibleCaptureIds} (ADV15) — deleted_at +
 * recording-derived delegation to the recording allowlist + standalone value
 * quality, all fail-closed. This replaces the round-15b per-handler predicate
 * (which never checked the capture's own `deleted_at`, ADV15-2).
 *
 * OWNER is the narrow existence-scoped exemption for the owner Library: a
 * recording-derived capture is kept when its source recording ROW EXISTS
 * (soft-deleted/personal/value-excluded allowed so the owner sees their own value
 * badges; hard-purged/orphan dropped). Standalone captures use the SAME shared
 * value-excluded set as the gated boundary so the store slice's assistant DISPLAY
 * consumer (Today) can't leak value-excluded standalone captures.
 *
 * Any eligibility-lookup failure → failClosed=true with an empty kept set.
 */
function applyCaptureEligibility(rows: CaptureRow[], tier: 'gated' | 'owner'): { kept: CaptureRow[]; failClosed: boolean } {
  if (rows.length === 0) return { kept: [], failClosed: false }
  if (tier === 'gated') {
    const { eligible, failClosed } = filterEligibleCaptureIds(rows.map((r) => r.id))
    if (failClosed) return { kept: [], failClosed: true }
    return { kept: rows.filter((r) => eligible.has(r.id)), failClosed: false }
  }
  // OWNER tier — existence-scoped (unchanged).
  const sourceIds = rows.map((r) => r.source_recording_id).filter((id): id is string => !!id)
  const res = existingRecordings(sourceIds)
  if (res.failClosed) return { kept: [], failClosed: true }
  const kept = rows.filter((r) =>
    r.source_recording_id
      ? res.ids.has(r.source_recording_id)
      : !CAPTURE_VALUE_EXCLUDED_RATINGS.has(r.quality_rating ?? '')
  )
  return { kept, failClosed: false }
}

interface CaptureQuery {
  limit: number
  offset: number
  status?: string
  quality?: string
  category?: string
  tier: 'gated' | 'owner'
}

/**
 * Fetch up to `limit` ELIGIBLE captures (fill-until-limit, NO
 * truncate-before-filter): excluded captures that precede eligible ones must not
 * shrink the page. Over-fetches in batches from `offset` and applies the tier
 * gate to each batch until `limit` eligible are collected or the source is
 * exhausted (mirrors the round-9 briefing/globalSearch fill-until-limit pattern).
 * Fail-closed → [].
 */
function collectEligibleCaptures(q: CaptureQuery): KnowledgeCapture[] {
  const conditions: string[] = []
  const params: (string | number)[] = []
  if (q.status) { conditions.push('status = ?'); params.push(q.status) }
  if (q.quality) { conditions.push('quality_rating = ?'); params.push(q.quality) }
  if (q.category) { conditions.push('category = ?'); params.push(q.category) }
  const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : ''
  const sql = `SELECT ${KNOWLEDGE_CAPTURE_COLUMNS} FROM knowledge_captures${where} ORDER BY captured_at DESC LIMIT ? OFFSET ?`
  try {
    const kept: CaptureRow[] = []
    const batchSize = Math.max(q.limit, 50)
    let curOffset = q.offset
    let scanned = 0
    const MAX_SCAN = 10000 // safety bound against pathological all-excluded data
    while (kept.length < q.limit && scanned < MAX_SCAN) {
      const batch = queryAll<CaptureRow>(sql, [...params, batchSize, curOffset])
      if (batch.length === 0) break
      scanned += batch.length
      const { kept: batchKept, failClosed } = applyCaptureEligibility(batch, q.tier)
      if (failClosed) return []
      for (const row of batchKept) {
        kept.push(row)
        if (kept.length >= q.limit) break
      }
      if (batch.length < batchSize) break // source exhausted
      curOffset += batchSize
    }
    return kept.slice(0, q.limit).map(mapToKnowledgeCapture)
  } catch (err) {
    console.error('Failed to get knowledge captures:', err)
    return []
  }
}

export function registerKnowledgeHandlers(): void {
  // Get all knowledge captures — ROUND-15 RESIDUAL: DEFAULT (gated) tier. This is
  // the assistant/DISPLAY-safe accessor: recording-derived captures of excluded
  // recordings and value-excluded standalone captures are dropped (fail-closed),
  // fill-until-limit so excluded rows can't shrink the page. ContextPicker / Chat
  // / ActionableDetail / Projects inherit the gate transparently.
  ipcMain.handle('knowledge:getAll', async (_, { limit = 100, offset = 0, status, quality, category }: { limit?: number; offset?: number; status?: string; quality?: string; category?: string } = {}) => {
    return collectEligibleCaptures({ limit, offset, status, quality, category, tier: 'gated' })
  })

  // ROUND-15 RESIDUAL — NARROW OWNER-MANAGEMENT accessor for the owner Library
  // (useUnifiedRecordings). Recording-derived captures are kept when the source
  // recording ROW EXISTS (existence-scoped: soft-deleted/personal/value-excluded
  // allowed so the owner sees their own value badges; hard-purged/orphan dropped).
  // Standalone captures use the SAME value gate as the default tier so the shared
  // store slice's assistant DISPLAY consumer (Today) cannot leak value-excluded
  // standalone captures. Only the owner Library may call this.
  ipcMain.handle('knowledge:getAllOwner', async (_, { limit = 100, offset = 0, status, quality, category }: { limit?: number; offset?: number; status?: string; quality?: string; category?: string } = {}) => {
    return collectEligibleCaptures({ limit, offset, status, quality, category, tier: 'owner' })
  })

  // B-CHAT-004: Get multiple knowledge captures by IDs — gated (ADV14 residual):
  // omit ineligible ids (excluded source recording / value-excluded standalone);
  // fail-closed → [].
  ipcMain.handle('knowledge:getByIds', async (_, ids: string[]) => {
    try {
      if (!Array.isArray(ids) || ids.length === 0) return []
      // Build parameterized WHERE IN clause
      const placeholders = ids.map(() => '?').join(',')
      const captures = queryAll<CaptureRow>(
        `SELECT ${KNOWLEDGE_CAPTURE_COLUMNS} FROM knowledge_captures WHERE id IN (${placeholders})`,
        ids
      )
      const { kept, failClosed } = applyCaptureEligibility(captures, 'gated')
      if (failClosed) return []
      return kept.map(mapToKnowledgeCapture)
    } catch (error) {
      console.error('Failed to get knowledge captures by IDs:', error)
      return []
    }
  })

  // Get by ID — gated (ADV14 residual): null when the capture's source recording
  // is ineligible / the standalone capture is value-excluded / lookup fails.
  ipcMain.handle('knowledge:getById', async (_, id: string) => {
    try {
      const capture = queryOne<CaptureRow>(`SELECT ${KNOWLEDGE_CAPTURE_COLUMNS} FROM knowledge_captures WHERE id = ?`, [id])
      if (!capture) return null
      const { kept, failClosed } = applyCaptureEligibility([capture], 'gated')
      if (failClosed || kept.length === 0) return null
      return mapToKnowledgeCapture(kept[0])
    } catch (error) {
      console.error('Failed to get knowledge capture:', error)
      return null
    }
  })

  // Update
  ipcMain.handle('knowledge:update', async (_, id: string, updates: Partial<KnowledgeCapture>) => {
    try {
      // Construct UPDATE query dynamically
      const fields: string[] = []
      const values: any[] = []

      // Map camelCase updates to snake_case DB columns
      if (updates.title !== undefined) { fields.push('title = ?'); values.push(updates.title); }
      if (updates.summary !== undefined) { fields.push('summary = ?'); values.push(updates.summary); }
      if (updates.category !== undefined) { fields.push('category = ?'); values.push(updates.category); }
      if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
      if (updates.quality !== undefined) {
        fields.push('quality_rating = ?')
        values.push(updates.quality)
        // F16/spec-001: stamp this as a user-set rating (never overwrite an
        // assessed_at implicitly) so the AI value classifier's never-downgrade
        // guard leaves it alone on any later re-analysis.
        fields.push('quality_source = ?')
        values.push('user')
        fields.push('quality_assessed_at = CURRENT_TIMESTAMP')
        // CX-T1-2: a manual rating supersedes any prior AI classification —
        // clear the AI reason tags (they justified the OLD rating, not this
        // one) and record full confidence, mirroring spec-003's
        // recordings:setValueRating semantics so both user paths behave
        // identically.
        fields.push('quality_reasons = NULL')
        fields.push('quality_confidence = ?')
        values.push(1.0)
      }
      if (updates.storageTier !== undefined) { fields.push('storage_tier = ?'); values.push(updates.storageTier); }
      
      if (fields.length === 0) return { success: true }

      fields.push('updated_at = CURRENT_TIMESTAMP')
      
      const sql = `UPDATE knowledge_captures SET ${fields.join(', ')} WHERE id = ?`
      values.push(id)

      run(sql, values)
      return { success: true }
    } catch (error) {
      console.error('Failed to update knowledge capture:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Replace the full set of projects directly assigned to a knowledge capture (v26)
  ipcMain.handle(
    'knowledge:setProjects',
    async (_, request: unknown): Promise<Result<void>> => {
      try {
        const parsed = SetKnowledgeProjectsRequestSchema.safeParse(request)
        if (!parsed.success) {
          return error('VALIDATION_ERROR', 'Invalid setProjects request', parsed.error.format())
        }

        const capture = queryOne<{ id: string }>('SELECT id FROM knowledge_captures WHERE id = ?', [
          parsed.data.knowledgeCaptureId
        ])
        if (!capture) {
          return error('NOT_FOUND', `Knowledge capture ${parsed.data.knowledgeCaptureId} not found`)
        }

        setKnowledgeProjects(parsed.data.knowledgeCaptureId, parsed.data.projectIds)
        return success(undefined)
      } catch (err) {
        console.error('knowledge:setProjects error:', err)
        return error('DATABASE_ERROR', 'Failed to set knowledge projects', err)
      }
    }
  )
}

// F16/spec-001: quality_reasons is persisted as a JSON array of fixed tags
// (see VALUE_REASON_TAGS in value-classification.ts). Parse defensively so one
// corrupted row can't take down an entire knowledge:getAll response.
function safeParseReasons(raw: string | null): string[] | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

// Mapper from DB snake_case to Interface camelCase
function mapToKnowledgeCapture(row: any): KnowledgeCapture {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    category: row.category,
    status: row.status,
    quality: row.quality_rating,
    qualityConfidence: row.quality_confidence,
    qualityAssessedAt: row.quality_assessed_at,
    qualityReasons: safeParseReasons(row.quality_reasons),
    qualitySource: row.quality_source,
    storageTier: row.storage_tier,
    retentionDays: row.retention_days,
    expiresAt: row.expires_at,
    meetingId: row.meeting_id,
    correlationConfidence: row.correlation_confidence,
    correlationMethod: row.correlation_method,
    sourceRecordingId: row.source_recording_id,
    capturedAt: row.captured_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at
  }
}
