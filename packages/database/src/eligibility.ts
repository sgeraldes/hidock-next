/**
 * Pure, shared eligibility policy for every HiDock read surface.
 *
 * Database adapters resolve positive allowlists; these functions combine those
 * results without knowing how the rows were loaded. Keeping the policy here lets
 * Electron and standalone read-only clients use exactly the same fail-closed
 * decisions.
 */

export interface EligibilityResult {
  eligible: Set<string>
  failClosed: boolean
}

export interface ExistenceResult {
  ids: Set<string>
  failClosed: boolean
}

export interface CaptureEligibilityRow {
  id: string
  source_recording_id: string | null
  quality_rating: string | null
  deleted_at: string | null
}

export interface CaptureEligibilityRowsResult {
  rows: CaptureEligibilityRow[]
  failClosed: boolean
}

export const CAPTURE_VALUE_EXCLUDED_RATINGS: ReadonlySet<string> = new Set(['garbage', 'low-value'])

export function evaluateCaptureEligibility(
  captureRows: CaptureEligibilityRowsResult,
  recordingEligibility: EligibilityResult
): EligibilityResult {
  if (captureRows.failClosed) return { eligible: new Set(), failClosed: true }

  const eligible = new Set<string>()
  for (const row of captureRows.rows) {
    if (row.deleted_at != null) continue
    if (row.source_recording_id) {
      if (!recordingEligibility.failClosed && recordingEligibility.eligible.has(row.source_recording_id)) {
        eligible.add(row.id)
      }
    } else if (!CAPTURE_VALUE_EXCLUDED_RATINGS.has(row.quality_rating ?? '')) {
      eligible.add(row.id)
    }
  }

  // A recording lookup failure affects only recording-derived captures. The
  // returned set is still complete for standalone captures and never leaks.
  return { eligible, failClosed: false }
}

export interface ActionableEligibilityInputs {
  existingCaptures: ExistenceResult
  captureEligibility: EligibilityResult
  recordingEligibility: EligibilityResult
}

export function evaluateActionableEligibility<T>(
  rows: T[],
  sourceIdOf: (row: T) => string | null | undefined,
  inputs: ActionableEligibilityInputs
): T[] {
  if (rows.length === 0) return rows
  if (inputs.existingCaptures.failClosed) return rows.filter((row) => !sourceIdOf(row))

  return rows.filter((row) => {
    const sourceId = sourceIdOf(row)
    if (!sourceId) return true
    if (inputs.existingCaptures.ids.has(sourceId)) {
      return !inputs.captureEligibility.failClosed && inputs.captureEligibility.eligible.has(sourceId)
    }
    return !inputs.recordingEligibility.failClosed && inputs.recordingEligibility.eligible.has(sourceId)
  })
}
