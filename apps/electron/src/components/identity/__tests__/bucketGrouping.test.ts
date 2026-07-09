import { describe, it, expect } from 'vitest'
import { groupBucketRecordings, assignedCandidateId } from '../bucketGrouping'
import type { BucketRecording, BucketResolution } from '../useAmbiguousBuckets'

const rec = (over: Partial<BucketRecording>): BucketRecording => ({
  recordingId: 'r',
  title: 'Rec',
  date: null,
  meetingId: 'm',
  bestGuessId: null,
  bestGuessName: null,
  method: 'unclear',
  signal: '',
  resolvedContactId: null,
  resolved: false,
  ...over
})

const resolution = (recordings: BucketRecording[]): BucketResolution => ({
  contactId: 'c-bucket',
  name: 'Sergio',
  candidates: [
    { id: 'c-sh', name: 'Sergio Hurtado' },
    { id: 'c-sr', name: 'Sergio Reyes' }
  ],
  recordings
})

describe('assignedCandidateId', () => {
  it('prefers an existing resolution over the best guess', () => {
    expect(assignedCandidateId(rec({ resolved: true, resolvedContactId: 'c-sr', bestGuessId: 'c-sh', method: 'attendee-context' }))).toBe('c-sr')
  })
  it('returns null for an explicit Unclear resolution', () => {
    expect(assignedCandidateId(rec({ resolved: true, resolvedContactId: null }))).toBeNull()
  })
  it('falls back to the best guess when unresolved', () => {
    expect(assignedCandidateId(rec({ bestGuessId: 'c-sh', method: 'attendee-context' }))).toBe('c-sh')
  })
  it('is null when there is no signal', () => {
    expect(assignedCandidateId(rec({ method: 'unclear', bestGuessId: null }))).toBeNull()
  })
})

describe('groupBucketRecordings', () => {
  it('groups by assigned candidate with Unclear last', () => {
    const groups = groupBucketRecordings(
      resolution([
        rec({ recordingId: 'r1', bestGuessId: 'c-sh', method: 'attendee-context' }),
        rec({ recordingId: 'r2', bestGuessId: 'c-sh', method: 'speaker-map' }),
        rec({ recordingId: 'r3', bestGuessId: 'c-sr', method: 'attendee-context' }),
        rec({ recordingId: 'r4', method: 'unclear' })
      ])
    )
    expect(groups.map((g) => g.candidateName)).toEqual(['Sergio Hurtado', 'Sergio Reyes', null])
    expect(groups[0].recordings).toHaveLength(2)
    expect(groups[groups.length - 1].candidateId).toBeNull() // Unclear last
  })

  it('orders named groups by size then name', () => {
    const groups = groupBucketRecordings(
      resolution([
        rec({ recordingId: 'r1', bestGuessId: 'c-sr', method: 'attendee-context' }),
        rec({ recordingId: 'r2', bestGuessId: 'c-sh', method: 'attendee-context' }),
        rec({ recordingId: 'r3', bestGuessId: 'c-sh', method: 'attendee-context' })
      ])
    )
    expect(groups[0].candidateName).toBe('Sergio Hurtado') // 2 beats 1
  })

  it('produces only an Unclear group when nothing is decidable', () => {
    const groups = groupBucketRecordings(resolution([rec({ recordingId: 'r1' }), rec({ recordingId: 'r2' })]))
    expect(groups).toHaveLength(1)
    expect(groups[0].candidateId).toBeNull()
    expect(groups[0].recordings).toHaveLength(2)
  })
})
