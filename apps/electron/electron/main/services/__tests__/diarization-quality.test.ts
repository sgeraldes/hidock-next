import { describe, expect, it } from 'vitest'
import { assessDiarizationQuality, parseAndAssessDiarization } from '../diarization-quality'

describe('diarization quality gate', () => {
  it('accepts valid, well-covered timestamped turns', () => {
    const report = assessDiarizationQuality([
      { speaker: 'Speaker 1', start: 0, end: 29, text: 'Hello' },
      { speaker: 'Speaker 2', start: 29, end: 60, text: 'Hi' }
    ], 60)
    expect(report.status).toBe('high')
    expect(report.speakerCount).toBe(2)
    expect(report.coverageRatio).toBe(1)
  })

  it('degrades low-coverage output instead of presenting it as reliable', () => {
    const report = assessDiarizationQuality([
      { speaker: 'Speaker 1', start: 10, end: 20, text: 'Brief speech' }
    ], 100)
    expect(report.status).toBe('degraded')
    expect(report.reasons).toContain('Timestamped speech covers less than 55% of the recording')
  })

  it('fails when every segment is malformed', () => {
    const report = assessDiarizationQuality([
      { speaker: 'Speaker 1', start: 20, end: 10, text: 'Bad range' }
    ], 60)
    expect(report.status).toBe('failed')
  })

  it('fails closed on invalid JSON', () => {
    expect(parseAndAssessDiarization('{oops', 60).status).toBe('failed')
  })

  it('reports unavailable when the provider returns no diarization', () => {
    expect(parseAndAssessDiarization(undefined, 60).status).toBe('unavailable')
  })

  it('fails when provider turns are not grounded in independently detected audio activity', () => {
    const report = assessDiarizationQuality([
      { speaker: 'Speaker 1', start: 0, end: 30, text: 'Invented opening' },
      { speaker: 'Speaker 2', start: 41, end: 80, text: 'Invented response' },
      { speaker: 'Speaker 1', start: 90, end: 120, text: 'Invented continuation' }
    ], 120, [{ start: 0, end: 1.2 }])

    expect(report.status).toBe('failed')
    expect(report.groundedSegments).toBe(1)
    expect(report.groundingRatio).toBeCloseTo(1 / 3, 3)
  })
})
