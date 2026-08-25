import { describe, expect, it } from 'vitest'
import { getDisplayTitle } from '../getDisplayTitle'
import type { UnifiedRecording } from '@/types/unified-recording'
import type { Meeting, Transcript } from '@/types'

const baseRecording: UnifiedRecording = {
  id: 'rec-1',
  filename: 'REC0001.WAV',
  size: 1024,
  duration: 60,
  dateRecorded: new Date('2026-01-15'),
  transcriptionStatus: 'none',
  location: 'local-only',
  localPath: '/path/to/rec.wav',
  syncStatus: 'synced'
}

describe('getDisplayTitle — authoritative source identity', () => {
  it('uses the official meeting subject after assignment', () => {
    const result = getDisplayTitle(
      { ...baseRecording, userTitle: 'My title', title: 'Legacy mixed title', meetingSubject: 'Denormalized' },
      { subject: 'Calendar subject' } as Meeting,
      { title_suggestion: 'AI title', summary: 'Long summary.' } as Transcript
    )
    expect(result).toEqual({ primaryText: 'Calendar subject', source: 'meeting-subject' })
  })

  it('does not let the AI content title replace an assigned meeting subject', () => {
    const result = getDisplayTitle(
      { ...baseRecording, title: 'Legacy mixed title' },
      { subject: 'Calendar subject' } as Meeting,
      { title_suggestion: 'AI title' } as Transcript
    )
    expect(result).toEqual({ primaryText: 'Calendar subject', source: 'meeting-subject' })
  })

  it('uses the immutable filename before a meeting object is available', () => {
    const result = getDisplayTitle(
      { ...baseRecording },
      undefined,
      { summary: 'Summary must stay body content.' } as Transcript
    )
    expect(result).toEqual({ primaryText: 'REC0001.WAV', source: 'filename' })
  })

  it('keeps user and AI content titles independent from source identity', () => {
    const result = getDisplayTitle(
      { ...baseRecording, userTitle: '' },
      undefined,
      { title_suggestion: '' } as Transcript
    )
    expect(result.source).toBe('filename')
  })

  it('works for a device-only recording before download', () => {
    const recording: UnifiedRecording = {
      id: 'dev-1', filename: '2026Aug13-Rec.hda', size: 500, duration: 30,
      dateRecorded: new Date(), transcriptionStatus: 'none', location: 'device-only',
      deviceFilename: '2026Aug13-Rec.hda', syncStatus: 'not-synced'
    }
    expect(getDisplayTitle(recording).primaryText).toBe('2026Aug13-Rec.hda')
  })

  it('uses the joined meeting subject immediately for a device-only row', () => {
    const recording: UnifiedRecording = {
      id: 'dev-2', filename: '2026Aug18-170709-Rec92.hda', size: 500, duration: 2145,
      dateRecorded: new Date(), transcriptionStatus: 'none', location: 'device-only',
      deviceFilename: '2026Aug18-170709-Rec92.hda', syncStatus: 'not-synced',
      meetingId: 'sync-arturo-seba', meetingSubject: 'Sync Arturo-Seba'
    }
    expect(getDisplayTitle(recording)).toEqual({
      primaryText: 'Sync Arturo-Seba', source: 'meeting-subject'
    })
  })
})
