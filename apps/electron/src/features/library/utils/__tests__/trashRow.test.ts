import { describe, it, expect } from 'vitest'
import { trashRowToUnified } from '../trashRow'
import { UNKNOWN_DATE } from '@/hooks/useUnifiedRecordings'
import type { DatabaseRecording } from '@/hooks/useUnifiedRecordings'

function makeRow(overrides: Partial<DatabaseRecording> = {}): DatabaseRecording {
  return {
    id: 'r1',
    filename: 'trashed.wav',
    file_path: '/data/trashed.wav',
    file_size: 2048,
    duration_seconds: 120,
    date_recorded: '2026-01-05T10:00:00.000Z',
    status: 'complete',
    ...overrides
  }
}

describe('trashRowToUnified', () => {
  it('maps the core fields (§D5 type-complete mapper)', () => {
    const unified = trashRowToUnified(makeRow())
    expect(unified.id).toBe('r1')
    expect(unified.filename).toBe('trashed.wav')
    expect(unified.size).toBe(2048)
    expect(unified.duration).toBe(120)
  })

  it('is always location "local-only" with syncStatus "synced" (types/unified-recording.ts REQUIRES both)', () => {
    const unified = trashRowToUnified(makeRow())
    expect(unified.location).toBe('local-only')
    expect(unified.syncStatus).toBe('synced')
  })

  it('CX-T5-3: sourceKind is ALWAYS "recording" — even with an empty/missing file_path', () => {
    // Trash rows come from the recordings table by construction; the explicit
    // stamp (not path shape) is what keeps an empty-path tombstone restorable.
    expect(trashRowToUnified(makeRow()).sourceKind).toBe('recording')
    expect(trashRowToUnified(makeRow({ file_path: '' })).sourceKind).toBe('recording')
    expect(trashRowToUnified(makeRow({ file_path: undefined as unknown as string })).sourceKind).toBe('recording')
  })

  it('sets localPath from file_path', () => {
    const unified = trashRowToUnified(makeRow({ file_path: '/data/custom.wav' }))
    expect(unified.localPath).toBe('/data/custom.wav')
  })

  it('falls back to an empty localPath when file_path is missing', () => {
    const unified = trashRowToUnified(makeRow({ file_path: undefined as unknown as string }))
    expect(unified.localPath).toBe('')
  })

  it('personal is always false — Trash bypasses the personal filter (display-only)', () => {
    const unified = trashRowToUnified(makeRow({ personal: 1 }))
    expect(unified.personal).toBe(false)
  })

  it('defaults size/duration to 0 when absent', () => {
    const unified = trashRowToUnified(makeRow({ file_size: undefined as unknown as number, duration_seconds: undefined }))
    expect(unified.size).toBe(0)
    expect(unified.duration).toBe(0)
  })

  it('prefers a HiDock filename-parsed date over date_recorded', () => {
    const unified = trashRowToUnified(makeRow({
      filename: '2026Jul08-190246-Rec49.hda',
      date_recorded: '2020-01-01T00:00:00.000Z'
    }))
    expect(unified.dateRecorded.getFullYear()).toBe(2026)
    expect(unified.dateRecorded.getMonth()).toBe(6) // July (0-indexed)
    expect(unified.dateRecorded.getDate()).toBe(8)
  })

  it('falls back to date_recorded (converted to a Date, not the raw string) when the filename is unparseable', () => {
    const unified = trashRowToUnified(makeRow({
      filename: 'imported-file.wav',
      date_recorded: '2025-03-15T08:30:00.000Z'
    }))
    expect(unified.dateRecorded.toISOString()).toBe('2025-03-15T08:30:00.000Z')
  })

  it('falls back to UNKNOWN_DATE when neither filename nor date_recorded yield a valid date', () => {
    const unified = trashRowToUnified(makeRow({
      filename: 'imported-file.wav',
      date_recorded: undefined
    }))
    expect(unified.dateRecorded.getTime()).toBe(UNKNOWN_DATE.getTime())
  })

  it('maps transcriptionStatus via transcription_status, falling back to status', () => {
    const complete = trashRowToUnified(makeRow({ transcription_status: 'complete', status: 'none' }))
    expect(complete.transcriptionStatus).toBe('complete')

    const fallback = trashRowToUnified(makeRow({ transcription_status: undefined, status: 'processing' }))
    expect(fallback.transcriptionStatus).toBe('processing')
  })

  it('preserves array order when mapped with a plain .map() (order-preservation contract, §D5)', () => {
    const rows: DatabaseRecording[] = [
      makeRow({ id: 'newest', date_recorded: '2026-01-03T00:00:00.000Z' }),
      makeRow({ id: 'middle', date_recorded: '2026-01-02T00:00:00.000Z' }),
      makeRow({ id: 'oldest', date_recorded: '2026-01-01T00:00:00.000Z' })
    ]
    const mapped = rows.map(trashRowToUnified)
    expect(mapped.map((r) => r.id)).toEqual(['newest', 'middle', 'oldest'])
  })
})
