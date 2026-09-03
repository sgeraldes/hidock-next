import { describe, expect, it } from 'vitest'
import { evaluateActionableEligibility, evaluateCaptureEligibility } from '../src/eligibility.js'

describe('shared eligibility policy', () => {
  it('drops unverifiable recording captures while retaining verifiable standalone captures', () => {
    const result = evaluateCaptureEligibility(
      {
        failClosed: false,
        rows: [
          { id: 'recording', source_recording_id: 'rec', quality_rating: 'valuable', deleted_at: null },
          { id: 'standalone', source_recording_id: null, quality_rating: 'valuable', deleted_at: null },
          { id: 'garbage', source_recording_id: null, quality_rating: 'garbage', deleted_at: null },
        ],
      },
      { eligible: new Set(), failClosed: true }
    )
    expect([...result.eligible]).toEqual(['standalone'])
    expect(result.failClosed).toBe(false)
  })

  it('keeps only standalone actionables when source classification fails', () => {
    const rows = [{ source: null }, { source: 'capture' }]
    expect(
      evaluateActionableEligibility(rows, (row) => row.source, {
        existingCaptures: { ids: new Set(), failClosed: true },
        captureEligibility: { eligible: new Set(), failClosed: true },
        recordingEligibility: { eligible: new Set(), failClosed: true },
      })
    ).toEqual([{ source: null }])
  })
})
