import { describe, it, expect } from 'vitest'
import { Diarizer } from '../src/diarizer.js'
import type { TranscriptSegment } from '../src/engines/engine-interface.js'

const baseSegment: TranscriptSegment = {
  speaker: '',
  text: 'hello',
  startTime: 0,
  endTime: 1,
  confidence: 0.9,
  source: 'mic'
}

describe('Diarizer', () => {
  it('tagSpeaker maps mic to "you"', () => {
    const d = new Diarizer()
    expect(d.tagSpeaker('mic')).toBe('you')
  })

  it('tagSpeaker maps system to "them"', () => {
    const d = new Diarizer()
    expect(d.tagSpeaker('system')).toBe('them')
  })

  it('tag sets speaker on a mic segment', () => {
    const d = new Diarizer()
    const result = d.tag({ ...baseSegment, source: 'mic' })
    expect(result.speaker).toBe('you')
  })

  it('tag sets speaker on a system segment', () => {
    const d = new Diarizer()
    const result = d.tag({ ...baseSegment, source: 'system' })
    expect(result.speaker).toBe('them')
  })

  it('tag does not mutate the original segment', () => {
    const d = new Diarizer()
    const original = { ...baseSegment, source: 'mic' as const }
    d.tag(original)
    expect(original.speaker).toBe('')
  })
})
