/**
 * applyTranscriptEntities threshold wiring (Round 4a).
 *
 * The resolver's confidence decides the action: ≥0.8 links an existing entity
 * (no create), 0.5–0.8 queues a suggestion (no create, no link), <0.5 creates a
 * new entity. Database + resolver are mocked so we can assert exactly which path
 * ran from the run()/insertIdentitySuggestion() calls.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

const run = vi.fn()
const queryOne = vi.fn(() => undefined)
const queryAll = vi.fn(() => [])
const insertIdentitySuggestion = vi.fn()
const getMentionResolution = vi.fn<() => { decided: boolean; contactId: string | null }>(() => ({
  decided: false,
  contactId: null
}))
const recordMentionResolutionNoSave = vi.fn()
interface ResolveResult {
  id: string | null
  confidence: number
  method: string
  ambiguous?: boolean
}
const resolveContact = vi.fn<(name: string, ctx?: unknown) => ResolveResult>()
const resolveProject = vi.fn<(name: string, ctx?: unknown) => ResolveResult>()

vi.mock('../database', () => ({
  queryAll: (...a: any[]) => (queryAll as any)(...a),
  queryOne: (...a: any[]) => (queryOne as any)(...a),
  run: (...a: any[]) => (run as any)(...a),
  runInTransaction: (fn: () => unknown) => fn(),
  mergeContacts: vi.fn(),
  insertIdentitySuggestion: (...a: any[]) => (insertIdentitySuggestion as any)(...a),
  getMentionResolution: (...a: any[]) => (getMentionResolution as any)(...a),
  recordMentionResolutionNoSave: (...a: any[]) => (recordMentionResolutionNoSave as any)(...a),
  getAmbiguousBuckets: vi.fn(() => []),
  getBucketResolution: vi.fn(() => null),
  getAllRecordingPreassignments: vi.fn(() => []),
  meetingBaseUid: (id: string) => id
}))

vi.mock('../entity-resolver', () => ({
  resolveContact: (...a: any[]) => (resolveContact as any)(...a),
  resolveProject: (...a: any[]) => (resolveProject as any)(...a)
}))

import { applyTranscriptEntities } from '../org-reconciler'

/** SQL statements passed to run() that touched a given table fragment. */
function runsMatching(fragment: string): number {
  return run.mock.calls.filter((c) => typeof c[0] === 'string' && c[0].includes(fragment)).length
}

describe('applyTranscriptEntities — resolver thresholds', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    queryOne.mockReturnValue(undefined)
    queryAll.mockReturnValue([])
    getMentionResolution.mockReturnValue({ decided: false, contactId: null })
    resolveProject.mockReturnValue({ id: null, confidence: 0, method: 'none' })
  })

  it('links an existing contact at ≥0.8 without creating one', () => {
    resolveContact.mockReturnValue({ id: 'c-existing', confidence: 0.9, method: 'exact-name' })
    const res = applyTranscriptEntities({ meetingId: 'm1', participants: [{ name: 'Sebastián' }] })

    expect(res.contacts).toBe(0)
    expect(insertIdentitySuggestion).not.toHaveBeenCalled()
    expect(runsMatching('INSERT INTO contacts')).toBe(0)
    expect(runsMatching('INSERT INTO meeting_contacts')).toBe(1)
  })

  it('queues a suggestion at 0.5–0.8 without creating or linking', () => {
    resolveContact.mockReturnValue({ id: 'c-maybe', confidence: 0.65, method: 'fuzzy' })
    const res = applyTranscriptEntities({ meetingId: 'm1', participants: [{ name: 'Sebas' }] })

    expect(res.contacts).toBe(0)
    expect(insertIdentitySuggestion).toHaveBeenCalledWith(
      'person',
      'Sebas',
      'c-maybe',
      0.65,
      expect.objectContaining({ method: 'fuzzy', meetingId: 'm1' }),
      // v44/round-27: no recordingId passed ⇒ empty source-recording-id array.
      []
    )
    expect(runsMatching('INSERT INTO contacts')).toBe(0)
    expect(runsMatching('INSERT INTO meeting_contacts')).toBe(0)
  })

  it('creates a new contact below 0.5', () => {
    resolveContact.mockReturnValue({ id: null, confidence: 0, method: 'none' })
    const res = applyTranscriptEntities({ meetingId: 'm1', participants: [{ name: 'Brand New Person' }] })

    expect(res.contacts).toBe(1)
    expect(insertIdentitySuggestion).not.toHaveBeenCalled()
    expect(runsMatching('INSERT INTO contacts')).toBe(1)
    expect(runsMatching('INSERT INTO meeting_contacts')).toBe(1)
  })

  it('skips generic speaker labels entirely', () => {
    const res = applyTranscriptEntities({ meetingId: 'm1', participants: [{ name: 'Speaker 2' }] })
    expect(res.contacts).toBe(0)
    expect(resolveContact).not.toHaveBeenCalled()
    expect(insertIdentitySuggestion).not.toHaveBeenCalled()
  })

  it('applies the same thresholds to the project branch (suggest at 0.5–0.8)', () => {
    resolveProject.mockReturnValue({ id: 'p-maybe', confidence: 0.7, method: 'fuzzy' })
    const res = applyTranscriptEntities({ meetingId: 'm1', project: { name: 'Atlas' } })

    expect(res.projectLinked).toBe(false)
    expect(insertIdentitySuggestion).toHaveBeenCalledWith(
      'project',
      'Atlas',
      'p-maybe',
      0.7,
      expect.objectContaining({ method: 'fuzzy', meetingId: 'm1' }),
      // v44/round-27: no recordingId passed ⇒ empty source-recording-id array.
      []
    )
    expect(runsMatching('INSERT INTO projects')).toBe(0)
    expect(runsMatching('INSERT INTO meeting_projects')).toBe(0)
  })

  it('links an existing project at ≥0.8', () => {
    resolveProject.mockReturnValue({ id: 'p-existing', confidence: 0.95, method: 'exact-name' })
    const res = applyTranscriptEntities({ meetingId: 'm1', project: { name: 'Project Atlas' } })

    expect(res.projectLinked).toBe(true)
    expect(runsMatching('INSERT INTO projects')).toBe(0)
    expect(runsMatching('INSERT INTO meeting_projects')).toBe(1)
  })

  describe('ambiguous buckets + per-recording resolution', () => {
    it('keeps an ambiguous mention in an existing bucket without creating or suggesting', () => {
      resolveContact.mockReturnValue({ id: 'c-bucket', confidence: 0.4, method: 'ambiguous-bucket', ambiguous: true })
      const res = applyTranscriptEntities({ meetingId: 'm1', participants: [{ name: 'Sergio' }] })

      expect(res.contacts).toBe(0)
      expect(insertIdentitySuggestion).not.toHaveBeenCalled()
      expect(runsMatching('INSERT INTO contacts')).toBe(0)
      expect(runsMatching('INSERT INTO meeting_contacts')).toBe(1) // linked to the bucket
    })

    it('creates the bucket once when no literal bare-name contact exists yet', () => {
      resolveContact.mockReturnValue({ id: null, confidence: 0.4, method: 'ambiguous-bucket', ambiguous: true })
      const res = applyTranscriptEntities({ meetingId: 'm1', participants: [{ name: 'Sergio' }] })

      expect(res.contacts).toBe(1)
      expect(insertIdentitySuggestion).not.toHaveBeenCalled()
      expect(runsMatching('INSERT INTO contacts')).toBe(1)
    })

    it('honors a stored per-recording resolution over the resolver', () => {
      getMentionResolution.mockReturnValue({ decided: true, contactId: 'c-real' })
      const res = applyTranscriptEntities({
        meetingId: 'm1',
        recordingId: 'r1',
        participants: [{ name: 'Sergio' }]
      })

      expect(resolveContact).not.toHaveBeenCalled()
      expect(res.contacts).toBe(0)
      expect(runsMatching('INSERT INTO meeting_contacts')).toBe(1)
    })

    it('leaves the mention unattributed when a stored resolution is Unclear', () => {
      getMentionResolution.mockReturnValue({ decided: true, contactId: null })
      const res = applyTranscriptEntities({
        meetingId: 'm1',
        recordingId: 'r1',
        participants: [{ name: 'Sergio' }]
      })

      expect(res.contacts).toBe(0)
      expect(runsMatching('INSERT INTO contacts')).toBe(0)
      expect(runsMatching('INSERT INTO meeting_contacts')).toBe(0)
    })

    it('remembers an attendee-context split for a recording', () => {
      resolveContact.mockReturnValue({ id: 'c-sh', confidence: 0.85, method: 'attendee-context' })
      applyTranscriptEntities({ meetingId: 'm1', recordingId: 'r1', participants: [{ name: 'Sergio' }] })

      expect(recordMentionResolutionNoSave).toHaveBeenCalledWith('r1', 'Sergio', 'c-sh', 'attendee-context', 0.85)
    })
  })
})
