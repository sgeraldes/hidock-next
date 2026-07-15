/**
 * Transcription funnel × feature gate (Track I, adversarial round-2 [HIGH]).
 *
 * `storage:save-recording` is a CORE channel (saving is core behavior), but its
 * transcription side effect flows through the single funnel
 * `queueTranscriptionIfEnabled` — as do the download service, the recording
 * watcher, and the device pipeline. Previously the funnel checked only the
 * legacy `autoTranscribe` setting, so with the transcription FEATURE disabled
 * and autoTranscribe still true, a core channel started transcription
 * background work (queue insert + processor kick).
 *
 * These tests exercise the REAL funnel (real transcription module, mocked
 * config/database) and assert: with every optional feature disabled, no
 * feature-owned background work starts — the transcription queue stays empty
 * and the processor is never kicked.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { FeaturesConfig } from '../../../../src/shared/feature-registry'

// Controllable config: tests flip features + autoTranscribe independently.
let featuresConfig: FeaturesConfig | undefined
let autoTranscribe = true
vi.mock('../config', () => ({
  getConfig: () => ({
    features: featuresConfig,
    transcription: { autoTranscribe, provider: 'gemini' },
  }),
}))

// Heavy/irrelevant deps of the transcription module — inert mocks.
vi.mock('@hidock/transcription', () => ({ GeminiEngine: class {} }))
vi.mock('@google/generative-ai', () => ({ GoogleGenerativeAI: class {} }))
vi.mock('../brains', () => ({
  getBrainRegistry: vi.fn(),
  resolveGeminiApiKey: vi.fn(() => null),
}))
vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }))
vi.mock('../vector-store', () => ({ getVectorStore: vi.fn() }))
vi.mock('../knowledge-capture-backfill', () => ({
  ensureKnowledgeCaptureForRecording: vi.fn(),
}))

// Database: every named export transcription.ts imports becomes a spy.
// acquireTranscriptionLock's undefined return makes any accidental processQueue
// run exit immediately and safely. vi.hoisted so the registry exists before the
// hoisted vi.mock factory runs.
const dbSpies = vi.hoisted(() => {
  const names = [
    'addToQueue',
    'getRecordingById',
    'resolveRecordingId',
    'updateRecordingTranscriptionStatus',
    'updateRecordingStatus',
    'insertTranscript',
    'getQueueItems',
    'updateQueueItem',
    'updateQueueProgress',
    'getMeetingById',
    'findCandidateMeetingsForRecording',
    'addRecordingMeetingCandidate',
    'linkRecordingToMeeting',
    'updateKnowledgeCaptureTitle',
    'removeFromQueueByRecordingId',
    'cancelPendingTranscriptions',
    'run',
    'runInTransaction',
    'saveDatabase',
    'queryOne',
    'queryAll',
    'acquireTranscriptionLock',
    'releaseTranscriptionLock',
    'clearStaleTranscriptionLock',
    'resetStuckTranscriptions',
  ]
  const spies: Record<string, ReturnType<typeof import('vitest').vi.fn>> = {}
  return { names, spies }
})
vi.mock('../database', () => {
  const mod: Record<string, unknown> = {}
  for (const name of dbSpies.names) {
    mod[name] = dbSpies.spies[name] = vi.fn()
  }
  return mod
})

import { queueTranscriptionIfEnabled } from '../transcription'

beforeEach(() => {
  for (const spy of Object.values(dbSpies.spies)) spy.mockClear()
  featuresConfig = undefined
  autoTranscribe = true
})

describe('queueTranscriptionIfEnabled × transcription feature gate', () => {
  it('with ALL optional features disabled + autoTranscribe true: queue stays empty, no processor starts', () => {
    featuresConfig = { preset: 'library-only', flags: {} } // transcription feature OFF
    autoTranscribe = true // legacy setting still on — must NOT win

    const queued = queueTranscriptionIfEnabled('rec-1')

    expect(queued).toBe(false)
    // The transcription queue stays empty…
    expect(dbSpies.spies['addToQueue'] ?? vi.fn()).not.toHaveBeenCalled()
    // …and the processor is never kicked (no lock acquisition, no queue reads).
    expect(dbSpies.spies['acquireTranscriptionLock'] ?? vi.fn()).not.toHaveBeenCalled()
    expect(dbSpies.spies['getQueueItems'] ?? vi.fn()).not.toHaveBeenCalled()
  })

  it('feature disabled by USER FLAG (not preset) also blocks the side effect', () => {
    featuresConfig = { preset: 'full', flags: { transcription: false } }
    expect(queueTranscriptionIfEnabled('rec-2')).toBe(false)
    expect(dbSpies.spies['addToQueue'] ?? vi.fn()).not.toHaveBeenCalled()
  })

  it('queues when the transcription feature is enabled and autoTranscribe is on', () => {
    featuresConfig = { preset: 'library-transcription', flags: {} } // transcription ON
    expect(queueTranscriptionIfEnabled('rec-3')).toBe(true)
    expect(dbSpies.spies['addToQueue']).toHaveBeenCalledWith('rec-3')
  })

  it('still respects the legacy autoTranscribe=false setting when the feature is on', () => {
    featuresConfig = { preset: 'full', flags: {} }
    autoTranscribe = false
    expect(queueTranscriptionIfEnabled('rec-4')).toBe(false)
    expect(dbSpies.spies['addToQueue'] ?? vi.fn()).not.toHaveBeenCalled()
  })

  it('default config (features unset ⇒ full preset) keeps the pre-Track-I behavior', () => {
    featuresConfig = undefined
    expect(queueTranscriptionIfEnabled('rec-5')).toBe(true)
    expect(dbSpies.spies['addToQueue']).toHaveBeenCalledWith('rec-5')
  })
})
