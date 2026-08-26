/**
 * Regression tests for OWED #58 — "months-apart bundling".
 *
 * ROOT CAUSE (Mechanism B): recordings whose filename doesn't parse AND have no
 * valid device/db date were stamped with `new Date()` (render-time NOW) by
 * getBestDate's fallback. Every undated item then got ~the current instant, so
 * genuinely months-apart recordings all collapsed to "today", clustered at the
 * TOP of the newest-first list, and visually bundled together.
 *
 * FIX: undated items now get the stable UNKNOWN_DATE (Unix epoch) sentinel, which
 * sorts them to the BOTTOM (they are not "newest") and renders "Unknown date"
 * (via smartDate) instead of a fake today. See useUnifiedRecordings.ts.
 */
import { describe, it, expect } from 'vitest'
import { buildRecordingMap, getBestDate, UNKNOWN_DATE } from '../useUnifiedRecordings'

// Minimal DatabaseRecording-shaped fixture (interface is module-private; buildRecordingMap
// is structurally typed, so a compatible literal is accepted).
function dbRec(over: Record<string, unknown>) {
  return {
    id: 'id-' + Math.random().toString(36).slice(2),
    filename: 'x.hda',
    file_path: '/tmp/x.hda',
    file_size: 1000,
    status: 'completed',
    ...over
  }
}

describe('#58 months-apart bundling — getBestDate does not fabricate render-time now', () => {
  it('returns the UNKNOWN_DATE epoch sentinel (NOT now) for an unparseable, dateless recording', () => {
    const before = Date.now()
    const d = getBestDate('Recording (3).hda', null)
    // Must be the epoch sentinel, never a fresh `new Date()` near now.
    expect(d.getTime()).toBe(0)
    expect(d).toBe(UNKNOWN_DATE)
    expect(Math.abs(d.getTime() - before)).toBeGreaterThan(1_000_000_000) // nowhere near now
  })

  it('parses a real HiDock filename to its true date', () => {
    const d = getBestDate('2026Jul06-100000-Rec1.hda', null)
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(6) // July (0-indexed)
    expect(d.getDate()).toBe(6)
    expect(d.getTime()).toBeGreaterThan(0)
  })

  it('falls back to a valid device date before the sentinel', () => {
    const deviceDate = new Date('2025-03-15T12:00:00')
    const d = getBestDate('garbled-name.hda', deviceDate)
    expect(d).toBe(deviceDate)
  })
})

describe('#58 months-apart bundling — undated recordings do not cluster at the top', () => {
  it('sorts undated (sentinel) recordings to the BOTTOM and keeps them off "today"', () => {
    const recs = [
      // Two undated recordings whose REAL dates are months apart, but neither
      // filename parses and neither has date_recorded. Pre-fix both got `new Date()`.
      dbRec({ id: 'undated-mar', filename: 'Recording (3).hda' }),
      dbRec({ id: 'undated-jul', filename: 'voice_memo_final.hda' }),
      // A normal, parseable recording.
      dbRec({ id: 'dated', filename: '2026Jul06-100000-Rec1.hda' })
    ]

    const out = buildRecordingMap([], recs as never, [], [], false)

    // Newest-first: the dated recording is on top, undated ones sink to the bottom.
    expect(out[0].id).toBe('dated')
    const undated = out.filter((r) => r.id === 'undated-mar' || r.id === 'undated-jul')
    expect(undated).toHaveLength(2)

    // The core of #58: undated items are NOT stamped with "now" (they'd otherwise
    // sort to the top and all read as today). They carry the epoch sentinel.
    for (const r of undated) {
      expect(r.dateRecorded.getTime()).toBe(0)
    }
    // And they are strictly below the dated recording.
    const datedIdx = out.findIndex((r) => r.id === 'dated')
    const undatedIdxs = out
      .map((r, i) => ({ id: r.id, i }))
      .filter((x) => x.id.startsWith('undated'))
      .map((x) => x.i)
    for (const i of undatedIdxs) expect(i).toBeGreaterThan(datedIdx)
  })
})
