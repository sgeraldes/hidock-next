// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const dbPath = join(tmpdir(), `hidock-speaker-linking-${process.pid}.sqlite`)

vi.mock('../file-storage', () => ({ getDatabasePath: () => dbPath }))
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
  cosineSimilarity,
  decideVoiceMatch,
  normalizeEmbedding,
  reconcileProviderSpeakers,
  updateCentroid,
  type SpeakerLinkingResult
} from '../speaker-linking'
import {
  assignSpeaker,
  closeDatabase,
  completeProcessingRun,
  createProcessingRun,
  deleteRecordingCascade,
  initializeDatabase,
  queryOne,
  run,
  setRecordingPersonal
} from '../database'

beforeEach(async () => {
  if (existsSync(dbPath)) rmSync(dbPath, { force: true })
  await initializeDatabase()
})

afterEach(() => {
  closeDatabase()
  for (const suffix of ['', '-wal', '-shm']) {
    if (existsSync(`${dbPath}${suffix}`)) rmSync(`${dbPath}${suffix}`, { force: true })
  }
})

describe('persistent acoustic speaker linking', () => {
  it('requires an absolute threshold and a winner margin', () => {
    const embedding = normalizeEmbedding([1, 0, 0])
    expect(cosineSimilarity(embedding, [1, 0, 0])).toBeCloseTo(1)
    expect(decideVoiceMatch(embedding, [
      { id: 'clear', centroid: [1, 0, 0] },
      { id: 'other', centroid: [0, 1, 0] }
    ], 0.72, 0.08)).toMatchObject({ clusterId: 'clear', status: 'matched' })

    const ambiguous = decideVoiceMatch(embedding, [
      { id: 'one', centroid: normalizeEmbedding([1, 0.02, 0]) },
      { id: 'two', centroid: normalizeEmbedding([1, 0.03, 0]) }
    ], 0.72, 0.08)
    expect(ambiguous.clusterId).toBeNull()
    expect(ambiguous.status).toBe('needs_review')
  })

  it('updates a normalized, speech-duration-weighted centroid', () => {
    const centroid = updateCentroid([1, 0], 10, [0, 1], 2)
    expect(Math.hypot(...centroid)).toBeCloseTo(1)
    expect(centroid[0]).toBeGreaterThan(centroid[1])
  })

  it('reconciles provider labels by temporal overlap and never leaves a foreign label', () => {
    const linking: SpeakerLinkingResult = {
      available: true,
      model: 'community-1',
      modelVersion: '4.0.0',
      device: 'cuda',
      segments: [
        { start: 0, end: 5, speaker: 'SPEAKER_00' },
        { start: 5, end: 10, speaker: 'SPEAKER_01' }
      ],
      matches: [
        {
          localSpeakerLabel: 'SPEAKER_00', voiceClusterId: 'a', stableLabel: 'Voice AAAAAA', status: 'new',
          similarity: null, runnerUpMargin: null, contactId: null, contactName: null, speechSeconds: 5
        },
        {
          localSpeakerLabel: 'SPEAKER_01', voiceClusterId: 'b', stableLabel: 'Voice BBBBBB', status: 'new',
          similarity: null, runnerUpMargin: null, contactId: null, contactName: null, speechSeconds: 5
        }
      ]
    }
    const rewritten = JSON.parse(reconcileProviderSpeakers(JSON.stringify([
      { start: 0, end: 4, speaker: 'Speaker 1', text: 'hello' },
      { start: 6, end: 9, speaker: 'Speaker 1', text: 'reply' },
      { start: 20, end: 21, speaker: 'Speaker 3', text: 'unmatched' }
    ]), linking)!)
    // A turn with no acoustic overlap is now labelled explicitly unknown rather
    // than keeping the provider's own scheme — leaving "Speaker 3" in place is
    // what made a 1:1 call read as four speakers downstream.
    expect(rewritten.map((turn: { speaker: string }) => turn.speaker)).toEqual([
      'Voice AAAAAA', 'Voice BBBBBB', 'Unknown speaker'
    ])
    expect(rewritten.map((turn: { speakerAttribution: string }) => turn.speakerAttribution)).toEqual([
      'acoustic', 'acoustic', 'unresolved'
    ])
  })

  it('creates v53 tables and anchors a voice only on explicit evidence', () => {
    run(`INSERT INTO recordings (id, filename, date_recorded) VALUES ('rec', 'rec.wav', '2026-08-24T10:00:00Z')`)
    run(`INSERT INTO contacts
      (id, name, type, first_seen_at, last_seen_at, source)
      VALUES ('person', 'Sebastian', 'unknown', '2026-08-24T10:00:00Z', '2026-08-24T10:00:00Z', 'user')`)
    run(`INSERT INTO voice_clusters
      (id, model, model_version, embedding_dimension, centroid_json, observation_count, total_speech_seconds)
      VALUES ('voice', 'community-1', '4.0.0', 3, '[1,0,0]', 1, 10)`)
    run(`INSERT INTO recording_voice_clusters
      (recording_id, local_speaker_label, transcript_speaker_label, voice_cluster_id, match_status)
      VALUES ('rec', 'SPEAKER_00', 'Voice ABCDEF', 'voice', 'new')`)

    assignSpeaker('rec', 'Voice ABCDEF', {
      contactId: 'person',
      voiceAnchor: { method: 'manual', confidence: 1 }
    })
    expect(queryOne<{ contact_id: string; contact_link_method: string }>(
      'SELECT contact_id, contact_link_method FROM voice_clusters WHERE id = ?', ['voice']
    )).toEqual({ contact_id: 'person', contact_link_method: 'manual' })
  })

  it('removes acoustic evidence immediately when a source becomes personal or trashed', () => {
    const seed = (recordingId: string, clusterId: string): void => {
      run('INSERT INTO recordings (id, filename, date_recorded) VALUES (?, ?, ?)', [
        recordingId, `${recordingId}.wav`, '2026-08-24T10:00:00Z'
      ])
      run(`INSERT INTO voice_clusters
        (id, model, model_version, embedding_dimension, centroid_json, observation_count, total_speech_seconds)
        VALUES (?, 'community-1', '4.0.0', 3, '[1,0,0]', 1, 10)`, [clusterId])
      run(`INSERT INTO voice_cluster_observations
        (id, voice_cluster_id, recording_id, local_speaker_label, embedding_json, speech_seconds)
        VALUES (?, ?, ?, 'SPEAKER_00', '[1,0,0]', 10)`, [`obs-${recordingId}`, clusterId, recordingId])
      run(`INSERT INTO recording_voice_clusters
        (recording_id, local_speaker_label, transcript_speaker_label, voice_cluster_id, match_status)
        VALUES (?, 'SPEAKER_00', 'Voice ABCDEF', ?, 'new')`, [recordingId, clusterId])
    }

    seed('personal-rec', 'personal-voice')
    expect(setRecordingPersonal('personal-rec', true)).toBe(true)
    expect(queryOne('SELECT id FROM voice_clusters WHERE id = ?', ['personal-voice'])).toBeUndefined()

    seed('trashed-rec', 'trashed-voice')
    expect(deleteRecordingCascade('trashed-rec', { hard: false })?.mode).toBe('soft')
    expect(queryOne('SELECT id FROM voice_clusters WHERE id = ?', ['trashed-voice'])).toBeUndefined()
  })

  it('records the actual fallback tool, model, and version after a run starts', () => {
    run(`INSERT INTO recordings (id, filename, date_recorded)
      VALUES ('fallback-rec', 'fallback.wav', '2026-08-24T10:00:00Z')`)
    const processingRun = createProcessingRun({
      recordingId: 'fallback-rec',
      stage: 'diarization',
      provider: 'pyannote',
      tool: 'community-1',
      model: 'pyannote/speaker-diarization-community-1',
      execution: 'local'
    })
    completeProcessingRun(processingRun.id, {
      tool: 'speaker-diarization-3.1',
      model: 'pyannote/speaker-diarization-3.1',
      version: '4.0.7'
    })
    expect(queryOne<{ tool: string; model: string; version: string }>(
      'SELECT tool, model, version FROM processing_runs WHERE id = ?', [processingRun.id]
    )).toEqual({
      tool: 'speaker-diarization-3.1',
      model: 'pyannote/speaker-diarization-3.1',
      version: '4.0.7'
    })
  })
})
