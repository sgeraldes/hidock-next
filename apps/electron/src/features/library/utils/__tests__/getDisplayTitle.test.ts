import { describe, it, expect } from 'vitest'
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
} as UnifiedRecording

describe('getDisplayTitle', () => {
  // ============================================================
  // Priority chain
  // ============================================================

  describe('priority chain', () => {
    it('returns meeting subject as highest priority (1)', () => {
      const meeting = { subject: 'Sprint Planning' } as Meeting
      const transcript = { title_suggestion: 'AI Title' } as Transcript

      const result = getDisplayTitle(
        { ...baseRecording, title: 'User Title', meetingSubject: 'Denormalized' },
        meeting,
        transcript
      )

      expect(result.primaryText).toBe('Sprint Planning')
      expect(result.source).toBe('meeting-subject')
    })

    it('returns recording title when no meeting (2)', () => {
      const transcript = { title_suggestion: 'AI Title', summary: 'Summary.' } as Transcript

      const result = getDisplayTitle(
        { ...baseRecording, title: 'My Custom Title', meetingSubject: 'Denormalized' },
        undefined,
        transcript
      )

      expect(result.primaryText).toBe('My Custom Title')
      expect(result.source).toBe('recording-title')
    })

    it('returns transcript title_suggestion as third priority (3)', () => {
      const transcript = { title_suggestion: 'AI Suggested Title', summary: 'Summary.' } as Transcript

      const result = getDisplayTitle(
        { ...baseRecording, meetingSubject: 'Denormalized' },
        undefined,
        transcript
      )

      expect(result.primaryText).toBe('AI Suggested Title')
      expect(result.source).toBe('transcript-title')
    })

    it('returns first sentence of transcript summary as fourth priority (4)', () => {
      const transcript = { summary: 'This is a meeting summary. It has more details.' } as Transcript

      const result = getDisplayTitle(
        { ...baseRecording, meetingSubject: 'Denormalized' },
        undefined,
        transcript
      )

      expect(result.primaryText).toBe('This is a meeting summary.')
      expect(result.source).toBe('transcript-summary')
    })

    it('returns denormalized meetingSubject as fifth priority (5)', () => {
      const recording = { ...baseRecording, meetingSubject: 'Denormalized Subject' }

      const result = getDisplayTitle(recording, undefined, undefined)

      expect(result.primaryText).toBe('Denormalized Subject')
      expect(result.source).toBe('meeting-subject-denormalized')
    })

    it('falls back to filename when nothing else is available (6)', () => {
      const result = getDisplayTitle(baseRecording, undefined, undefined)

      expect(result.primaryText).toBe('REC0001.WAV')
      expect(result.source).toBe('filename')
    })
  })

  // ============================================================
  // Empty/falsy value handling
  // ============================================================

  describe('empty value handling', () => {
    it('skips empty meeting subject', () => {
      const meeting = { subject: '' } as Meeting

      const result = getDisplayTitle(baseRecording, meeting, undefined)

      expect(result.primaryText).toBe('REC0001.WAV')
      expect(result.source).toBe('filename')
    })

    it('skips undefined meeting', () => {
      const result = getDisplayTitle(baseRecording, undefined, undefined)

      expect(result.source).toBe('filename')
    })

    it('skips empty recording title', () => {
      const result = getDisplayTitle(
        { ...baseRecording, title: '' },
        undefined,
        undefined
      )

      expect(result.primaryText).toBe('REC0001.WAV')
      expect(result.source).toBe('filename')
    })

    it('skips undefined recording title', () => {
      const result = getDisplayTitle(
        { ...baseRecording, title: undefined },
        undefined,
        undefined
      )

      expect(result.source).toBe('filename')
    })

    it('skips empty transcript title_suggestion', () => {
      const transcript = { title_suggestion: '' } as Transcript

      const result = getDisplayTitle(baseRecording, undefined, transcript)

      expect(result.primaryText).toBe('REC0001.WAV')
      expect(result.source).toBe('filename')
    })

    it('skips null transcript title_suggestion', () => {
      const transcript = { title_suggestion: null } as unknown as Transcript

      const result = getDisplayTitle(baseRecording, undefined, transcript)

      expect(result.source).toBe('filename')
    })

    it('skips empty transcript summary', () => {
      const transcript = { summary: '   ' } as Transcript

      const result = getDisplayTitle(baseRecording, undefined, transcript)

      expect(result.primaryText).toBe('REC0001.WAV')
      expect(result.source).toBe('filename')
    })

    it('skips null transcript summary', () => {
      const transcript = { summary: null } as unknown as Transcript

      const result = getDisplayTitle(baseRecording, undefined, transcript)

      expect(result.source).toBe('filename')
    })
  })

  // ============================================================
  // Summary extraction (extractFirstSentence)
  // ============================================================

  describe('summary first sentence extraction', () => {
    it('extracts first sentence ending with period', () => {
      const transcript = { summary: 'First sentence. Second sentence.' } as Transcript

      const result = getDisplayTitle(baseRecording, undefined, transcript)

      expect(result.primaryText).toBe('First sentence.')
      expect(result.source).toBe('transcript-summary')
    })

    it('extracts first sentence ending with exclamation mark', () => {
      const transcript = { summary: 'Great meeting! Lots of progress.' } as Transcript

      const result = getDisplayTitle(baseRecording, undefined, transcript)

      expect(result.primaryText).toBe('Great meeting!')
      expect(result.source).toBe('transcript-summary')
    })

    it('extracts first sentence ending with question mark', () => {
      const transcript = { summary: 'What happened? The team discussed.' } as Transcript

      const result = getDisplayTitle(baseRecording, undefined, transcript)

      expect(result.primaryText).toBe('What happened?')
      expect(result.source).toBe('transcript-summary')
    })

    it('truncates long summary without sentence boundary at word break', () => {
      const longText = 'This is a very long text without any sentence boundary that goes on and on and keeps going past eighty characters'
      const transcript = { summary: longText } as Transcript

      const result = getDisplayTitle(baseRecording, undefined, transcript)

      expect(result.primaryText.length).toBeLessThanOrEqual(84) // 80 + "..."
      expect(result.primaryText).toContain('...')
      expect(result.source).toBe('transcript-summary')
    })

    it('returns short text without sentence boundary as-is', () => {
      const shortText = 'Short summary no period'
      const transcript = { summary: shortText } as Transcript

      const result = getDisplayTitle(baseRecording, undefined, transcript)

      expect(result.primaryText).toBe('Short summary no period')
      expect(result.source).toBe('transcript-summary')
    })

    it('handles single-sentence summary without trailing content', () => {
      const transcript = { summary: 'Only one sentence.' } as Transcript

      const result = getDisplayTitle(baseRecording, undefined, transcript)

      expect(result.primaryText).toBe('Only one sentence.')
    })
  })

  // ============================================================
  // Return type structure
  // ============================================================

  describe('return type structure', () => {
    it('returns object with primaryText and source fields', () => {
      const result = getDisplayTitle(baseRecording, undefined, undefined)

      expect(result).toHaveProperty('primaryText')
      expect(result).toHaveProperty('source')
      expect(typeof result.primaryText).toBe('string')
      expect(typeof result.source).toBe('string')
    })

    it('source field is one of the valid DisplayTitleSource values', () => {
      const validSources = [
        'meeting-subject',
        'recording-title',
        'transcript-title',
        'transcript-summary',
        'meeting-subject-denormalized',
        'filename',
      ]

      const result = getDisplayTitle(baseRecording, undefined, undefined)
      expect(validSources).toContain(result.source)
    })
  })

  // ============================================================
  // Edge cases with different recording types
  // ============================================================

  describe('recording type variations', () => {
    it('works with device-only recording', () => {
      const deviceRec: UnifiedRecording = {
        id: 'dev-1',
        filename: '2025May13-Rec.hda',
        size: 500000,
        duration: 30,
        dateRecorded: new Date(),
        transcriptionStatus: 'none',
        location: 'device-only',
        deviceFilename: '2025May13-Rec.hda',
        syncStatus: 'not-synced',
      }

      const result = getDisplayTitle(deviceRec, undefined, undefined)

      expect(result.primaryText).toBe('2025May13-Rec.hda')
      expect(result.source).toBe('filename')
    })

    it('works with both-locations recording with title', () => {
      const bothRec: UnifiedRecording = {
        id: 'both-1',
        filename: 'recording.hda',
        size: 500000,
        duration: 30,
        dateRecorded: new Date(),
        transcriptionStatus: 'complete',
        location: 'both',
        deviceFilename: 'recording.hda',
        localPath: '/recordings/recording.wav',
        syncStatus: 'synced',
        title: 'Team Standup',
      }

      const result = getDisplayTitle(bothRec, undefined, undefined)

      expect(result.primaryText).toBe('Team Standup')
      expect(result.source).toBe('recording-title')
    })
  })
})
