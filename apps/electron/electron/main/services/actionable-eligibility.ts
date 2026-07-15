/**
 * ADV15 (round-16) — shared, capture-aware actionable-eligibility filter.
 *
 * Actionables are an assistant-facing DISPLAY of capture-derived derivatives
 * (title/description extracted from a capture's transcript). An actionable's
 * `source_knowledge_id` (skid) is a knowledge_captures.id — OR, for legacy rows
 * where no capture exists, a recording id. Every actionable list surface
 * (actionables:getAll / getByMeeting, the Today briefing pending-actionables
 * path, projects:getActionables) MUST route through THIS one filter so they all
 * inherit the SAME central capture boundary instead of re-deriving a per-handler
 * predicate (ADV15-3/-5: the "null source ⇒ unconditionally keep" branch leaked
 * standalone garbage/low-value/soft-deleted captures).
 *
 * Per row:
 *   • skid null → truly STANDALONE actionable (no capture at all) → KEEP.
 *   • skid names a live capture → keep iff that capture passes
 *     {@link filterEligibleCaptureIds} (deleted_at + recording-derived delegation
 *     OR standalone quality) — a standalone capture is NO LONGER kept blindly.
 *   • skid names a legacy recording id (no capture row) → keep iff that recording
 *     passes {@link filterEligibleRecordingIds}.
 *   • skid names nothing (hard-purged capture/recording orphan) → DROP.
 * FAIL-CLOSED: if a class's eligibility lookup can't complete, that class's rows
 * are dropped; null-skid standalone actionables are always kept.
 */
import {
  existingCaptures,
  filterEligibleCaptureIds,
  filterEligibleRecordingIds
} from './recording-eligibility'

export function filterEligibleActionableRows<T>(
  rows: T[],
  skidOf: (row: T) => string | null | undefined
): T[] {
  if (rows.length === 0) return rows

  const skids = [...new Set(rows.map(skidOf).filter((x): x is string => !!x))]
  if (skids.length === 0) return rows // every row is a standalone actionable

  // Classify each skid: a live capture id vs a legacy recording id.
  const capExist = existingCaptures(skids)
  if (capExist.failClosed) {
    // Can't classify → drop every recording/capture-backed row; keep standalone.
    return rows.filter((r) => !skidOf(r))
  }
  const captureSkids = skids.filter((id) => capExist.ids.has(id))
  const recordingSkids = skids.filter((id) => !capExist.ids.has(id))

  const capElig = filterEligibleCaptureIds(captureSkids)
  const recElig = filterEligibleRecordingIds(recordingSkids)

  return rows.filter((row) => {
    const skid = skidOf(row)
    if (!skid) return true // standalone actionable → keep
    if (capExist.ids.has(skid)) return !capElig.failClosed && capElig.eligible.has(skid)
    return !recElig.failClosed && recElig.eligible.has(skid)
  })
}
