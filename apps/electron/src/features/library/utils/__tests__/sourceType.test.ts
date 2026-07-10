import { describe, it, expect } from 'vitest'
import {
  getExtension,
  getSourceType,
  sourceTypeHasDuration,
  sourceTypeLabel,
  matchesSourceTypeFilter
} from '../sourceType'
import type { UnifiedRecording } from '@/types/unified-recording'

function rec(filename: string, location: UnifiedRecording['location'] = 'local-only'): UnifiedRecording {
  return { filename, location } as UnifiedRecording
}

describe('getExtension', () => {
  it('lowercases and strips the dot', () => {
    expect(getExtension('Report.PDF')).toBe('pdf')
    expect(getExtension('a.b.JSON')).toBe('json')
  })
  it('returns empty for no/edge extensions', () => {
    expect(getExtension('noext')).toBe('')
    expect(getExtension('.dotfile')).toBe('')
    expect(getExtension('trailing.')).toBe('')
    expect(getExtension(undefined)).toBe('')
  })
})

describe('getSourceType', () => {
  it('classifies by extension', () => {
    expect(getSourceType(rec('a.mp3'))).toBe('audio')
    expect(getSourceType(rec('a.wav'))).toBe('audio')
    expect(getSourceType(rec('shot.png'))).toBe('image')
    expect(getSourceType(rec('scan.jpeg'))).toBe('image')
    expect(getSourceType(rec('doc.pdf'))).toBe('pdf')
    expect(getSourceType(rec('notes.md'))).toBe('note')
    expect(getSourceType(rec('log.txt'))).toBe('note')
    expect(getSourceType(rec('data.json'))).toBe('data')
    expect(getSourceType(rec('mystery.xyz'))).toBe('unknown')
  })

  it('treats device-backed rows as audio regardless of extension', () => {
    expect(getSourceType(rec('Rec.hda', 'device-only'))).toBe('audio')
    expect(getSourceType(rec('weird.png', 'both'))).toBe('audio')
  })

  it('defaults extension-less local rows to audio', () => {
    expect(getSourceType(rec('Untitled'))).toBe('audio')
  })
})

describe('sourceTypeHasDuration', () => {
  it('is true only for audio', () => {
    expect(sourceTypeHasDuration('audio')).toBe(true)
    expect(sourceTypeHasDuration('image')).toBe(false)
    expect(sourceTypeHasDuration('pdf')).toBe(false)
    expect(sourceTypeHasDuration('note')).toBe(false)
  })
})

describe('sourceTypeLabel', () => {
  it('labels each type', () => {
    expect(sourceTypeLabel('audio')).toBe('Audio')
    expect(sourceTypeLabel('image')).toBe('Image')
    expect(sourceTypeLabel('pdf')).toBe('PDF')
    expect(sourceTypeLabel('note')).toBe('Note')
  })
})

describe('matchesSourceTypeFilter', () => {
  it('all matches everything', () => {
    expect(matchesSourceTypeFilter('audio', 'all')).toBe(true)
    expect(matchesSourceTypeFilter('pdf', 'all')).toBe(true)
  })
  it('matches concrete types', () => {
    expect(matchesSourceTypeFilter('audio', 'audio')).toBe(true)
    expect(matchesSourceTypeFilter('image', 'audio')).toBe(false)
    expect(matchesSourceTypeFilter('pdf', 'pdf')).toBe(true)
  })
  it('notes fold in data files', () => {
    expect(matchesSourceTypeFilter('note', 'note')).toBe(true)
    expect(matchesSourceTypeFilter('data', 'note')).toBe(true)
    expect(matchesSourceTypeFilter('audio', 'note')).toBe(false)
  })
})
