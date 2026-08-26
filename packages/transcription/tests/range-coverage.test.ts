import { describe, it, expect } from 'vitest'
import {
  isRangeCoverageShort,
  RANGE_COVERAGE_TOLERANCE_SECONDS,
} from '../src/engines/gemini-engine.js'

const at = (...starts: number[]) => starts.map((startTime) => ({ startTime }))

describe('isRangeCoverageShort', () => {
  it('flags the interview that stopped 10 minutes early', () => {
    // Rec91 Part 2: last range asked for 2400-3341, turns stopped at 2715.
    expect(isRangeCoverageShort(at(2400, 2500, 2715), 2400, 3341)).toBe(true)
  })

  it('accepts a range transcribed through to its end', () => {
    expect(isRangeCoverageShort(at(2400, 3000, 3320), 2400, 3341)).toBe(false)
  })

  it('tolerates a normal quiet ending', () => {
    // Ends 60s early on a 1200s range — under the 120s (10%) tolerance.
    expect(isRangeCoverageShort(at(0, 600, 1140), 0, 1200)).toBe(false)
  })

  it('uses the ratio when it exceeds the floor', () => {
    // 3600s range -> tolerance 360s, not 90s.
    expect(isRangeCoverageShort(at(0, 3300), 0, 3600)).toBe(false)
    expect(isRangeCoverageShort(at(0, 3100), 0, 3600)).toBe(true)
  })

  it('uses the floor on short ranges', () => {
    expect(RANGE_COVERAGE_TOLERANCE_SECONDS).toBe(90)
    // 300s range -> tolerance stays 90s, not 30s.
    expect(isRangeCoverageShort(at(0, 230), 0, 300)).toBe(false)
    expect(isRangeCoverageShort(at(0, 100), 0, 300)).toBe(true)
  })

  it('never treats an empty (silent) range as truncated', () => {
    expect(isRangeCoverageShort([], 0, 1200)).toBe(false)
  })

  it('is defensive about a degenerate range', () => {
    expect(isRangeCoverageShort(at(0), 1200, 1200)).toBe(false)
    expect(isRangeCoverageShort(at(0), 1200, 600)).toBe(false)
  })
})
