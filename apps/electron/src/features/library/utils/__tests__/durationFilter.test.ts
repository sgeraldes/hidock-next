import { describe, it, expect } from 'vitest'
import { matchesDurationPreset } from '../durationFilter'
import type { UnifiedRecording } from '@/types/unified-recording'

function audio(duration: number): UnifiedRecording {
  return { filename: 'a.wav', location: 'local-only', duration } as UnifiedRecording
}
function image(): UnifiedRecording {
  return { filename: 'a.png', location: 'local-only', duration: 0 } as UnifiedRecording
}

describe('matchesDurationPreset', () => {
  it('all matches everything (including non-audio)', () => {
    expect(matchesDurationPreset(audio(1000), 'all')).toBe(true)
    expect(matchesDurationPreset(image(), 'all')).toBe(true)
  })

  it('under10s / under1m / under5m are exclusive upper bounds', () => {
    expect(matchesDurationPreset(audio(5), 'under10s')).toBe(true)
    expect(matchesDurationPreset(audio(10), 'under10s')).toBe(false)
    expect(matchesDurationPreset(audio(59), 'under1m')).toBe(true)
    expect(matchesDurationPreset(audio(60), 'under1m')).toBe(false)
    expect(matchesDurationPreset(audio(299), 'under5m')).toBe(true)
    expect(matchesDurationPreset(audio(300), 'under5m')).toBe(false)
  })

  it('over5m is an inclusive lower bound', () => {
    expect(matchesDurationPreset(audio(300), 'over5m')).toBe(true)
    expect(matchesDurationPreset(audio(299), 'over5m')).toBe(false)
  })

  it('excludes non-audio and unknown-duration rows from any active preset', () => {
    expect(matchesDurationPreset(image(), 'under1m')).toBe(false)
    expect(matchesDurationPreset(audio(0), 'under1m')).toBe(false)
    expect(matchesDurationPreset(audio(0), 'over5m')).toBe(false)
  })
})
