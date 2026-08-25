// @vitest-environment node

import { describe, it, expect, vi } from 'vitest'
import { join } from 'path'
import { tmpdir } from 'os'

// speaker-linking pulls in config/file-storage, which reach for electron's app
// singleton at import time. These pure label functions need neither.
vi.mock('../file-storage', () => ({
  getDatabasePath: () => join(tmpdir(), `hidock-label-reconciliation-${process.pid}.sqlite`)
}))
vi.mock('../config', () => ({
  getConfig: () => ({
    transcription: {
      speakerLinkingEnabled: true,
      speakerLinkingPythonPath: 'python',
      speakerLinkingWorkerPath: '',
      speakerLinkingModel: 'pyannote/speaker-diarization-community-1',
      speakerLinkingMatchThreshold: 0.72,
      speakerLinkingMatchMargin: 0.08,
      speakerLinkingMinSpeechSeconds: 4,
      speakerLinkingTimeoutSeconds: 600,
      localAsrHfToken: ''
    }
  })
}))

import {
  reconcileProviderSpeakers,
  buildSpeakerLinkingContext,
  UNRESOLVED_SPEAKER_LABEL,
  type SpeakerLinkingResult,
  type VoiceMatch
} from '../speaker-linking'
import { countDistinctSpeakers, assessDiarizationQuality } from '../diarization-quality'

function match(local: string, stable: string): VoiceMatch {
  return {
    localSpeakerLabel: local,
    voiceClusterId: `cluster-${local}`,
    stableLabel: stable,
    status: 'matched',
    similarity: 0.9,
    runnerUpMargin: 0.3,
    contactId: null,
    contactName: null,
    speechSeconds: 100
  }
}

/** A 1:1 call: two acoustic voices, alternating turns. */
const LINKING: SpeakerLinkingResult = {
  available: true,
  model: 'pyannote/community-1',
  modelVersion: '1.0',
  device: 'cpu',
  segments: [
    { start: 0, end: 30, speaker: 'SPEAKER_00' },
    { start: 30, end: 60, speaker: 'SPEAKER_01' },
    { start: 60, end: 90, speaker: 'SPEAKER_00' }
  ],
  matches: [match('SPEAKER_00', 'Voice C5C45B'), match('SPEAKER_01', 'Voice 72D115')]
}

const parse = (json: string | undefined) => JSON.parse(json ?? '[]') as Array<Record<string, unknown>>

describe('reconcileProviderSpeakers', () => {
  it('never leaves a raw provider label behind (the 4-speakers-on-a-1:1 failure)', () => {
    const turns = JSON.stringify([
      { start: 1, end: 25, speaker: 'SPEAKER_00', text: 'a' },
      { start: 31, end: 55, speaker: 'SPEAKER_01', text: 'b' },
      // A turn straddling a boundary — used to keep its raw provider label.
      { start: 59, end: 62, speaker: 'SPEAKER_00', text: 'c' }
    ])
    const labels = parse(reconcileProviderSpeakers(turns, LINKING)).map((t) => t.speaker)
    expect(labels).toEqual(['Voice C5C45B', 'Voice 72D115', 'Voice C5C45B'])
    expect(countDistinctSpeakers(labels as string[])).toEqual({
      speakerCount: 2,
      mixedLabelSchemes: false
    })
  })

  it('marks a weakly-attributed turn per segment instead of silently trusting it', () => {
    // Mostly outside any acoustic segment: overlap is real but thin.
    const turns = JSON.stringify([{ start: 80, end: 120, speaker: 'SPEAKER_00', text: 'x' }])
    const [turn] = parse(reconcileProviderSpeakers(turns, LINKING))
    expect(turn.speaker).toBe('Voice C5C45B')
    expect(turn.speakerAttribution).toBe('acoustic-weak')
    expect(turn.speakerConfidence).toBeLessThan(0.35)
    expect(turn.speakerConfidence).toBeGreaterThan(0)
  })

  it('labels an unattributable turn explicitly rather than guessing', () => {
    const turns = JSON.stringify([{ start: 500, end: 560, speaker: 'SPEAKER_00', text: 'y' }])
    const [turn] = parse(reconcileProviderSpeakers(turns, LINKING))
    expect(turn.speaker).toBe(UNRESOLVED_SPEAKER_LABEL)
    expect(turn.speakerAttribution).toBe('unresolved')
    expect(turn.speakerConfidence).toBe(0)
  })

  it('treats a malformed timestamp as unresolved, not as a speaker', () => {
    const turns = JSON.stringify([{ start: 90, end: 30, speaker: 'SPEAKER_01', text: 'z' }])
    const [turn] = parse(reconcileProviderSpeakers(turns, LINKING))
    expect(turn.speaker).toBe(UNRESOLVED_SPEAKER_LABEL)
    expect(turn.speakerAttribution).toBe('unresolved')
  })

  it('marks a confidently-attributed turn as acoustic', () => {
    const turns = JSON.stringify([{ start: 2, end: 28, speaker: 'SPEAKER_00', text: 'q' }])
    const [turn] = parse(reconcileProviderSpeakers(turns, LINKING))
    expect(turn.speakerAttribution).toBe('acoustic')
    expect(turn.speakerConfidence).toBe(1)
  })

  it('passes the payload through untouched when linking is unavailable', () => {
    const turns = JSON.stringify([{ start: 1, end: 2, speaker: 'Speaker 1', text: 'a' }])
    const unavailable = { ...LINKING, available: false }
    expect(reconcileProviderSpeakers(turns, unavailable)).toBe(turns)
  })
})

describe('buildSpeakerLinkingContext', () => {
  it('never shows the provider the raw SPEAKER_NN scheme', () => {
    const context = buildSpeakerLinkingContext(LINKING)
    expect(context).not.toMatch(/SPEAKER_\d+/)
    expect(context).toContain('Voice C5C45B')
    expect(context).toContain('Voice 72D115')
  })
})

describe('countDistinctSpeakers', () => {
  it('does not double-count one person appearing under two schemes', () => {
    // Exactly the live Rec18 label mix.
    const labels = ['Voice C5C45B', 'SPEAKER_00', 'Voice 72D115', 'SPEAKER_01']
    expect(countDistinctSpeakers(labels)).toEqual({ speakerCount: 2, mixedLabelSchemes: true })
  })

  it('counts a provider-only transcript normally', () => {
    expect(countDistinctSpeakers(['Speaker 1', 'Speaker 2'])).toEqual({
      speakerCount: 2,
      mixedLabelSchemes: false
    })
  })

  it('counts named speakers normally', () => {
    expect(countDistinctSpeakers(['Ana', 'Yaraví', 'Ana'])).toEqual({
      speakerCount: 2,
      mixedLabelSchemes: false
    })
  })

  it('handles an empty label list', () => {
    expect(countDistinctSpeakers([])).toEqual({ speakerCount: 0, mixedLabelSchemes: false })
  })
})

describe('assessDiarizationQuality — per-segment honesty', () => {
  it('reports mixed schemes explicitly instead of inflating speakerCount', () => {
    const report = assessDiarizationQuality(
      [
        { start: 0, end: 30, speaker: 'Voice C5C45B' },
        { start: 30, end: 60, speaker: 'SPEAKER_00' },
        { start: 60, end: 90, speaker: 'Voice 72D115' }
      ],
      90
    )
    expect(report.speakerCount).toBe(2)
    expect(report.mixedLabelSchemes).toBe(true)
    expect(report.reasons.join(' ')).toMatch(/more than one naming scheme/i)
  })

  it('counts unresolved and low-confidence turns so consumers can drop just those', () => {
    const report = assessDiarizationQuality(
      [
        { start: 0, end: 30, speaker: 'Voice C5C45B', speakerAttribution: 'acoustic' },
        { start: 30, end: 60, speaker: 'Voice 72D115', speakerAttribution: 'acoustic-weak' },
        { start: 60, end: 90, speaker: 'Unknown speaker', speakerAttribution: 'unresolved' }
      ],
      90
    )
    expect(report.unresolvedSpeakerSegments).toBe(1)
    expect(report.lowConfidenceSpeakerSegments).toBe(1)
    expect(report.status).toBe('degraded')
  })
})
