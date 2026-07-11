import { describe, it, expect } from 'vitest'
import { UNKNOWN_DATE, isUnknownDate } from '../unknownDate'

/**
 * #58 — the shared "undated" sentinel + predicate. `isUnknownDate` is the single
 * gate every time-arithmetic consumer uses so the epoch never leaks into the
 * Calendar as a real 1970 date.
 */
describe('unknownDate', () => {
  it('UNKNOWN_DATE is the Unix epoch', () => {
    expect(UNKNOWN_DATE.getTime()).toBe(0)
  })

  it('treats the epoch sentinel as unknown', () => {
    expect(isUnknownDate(UNKNOWN_DATE)).toBe(true)
    expect(isUnknownDate(new Date(0))).toBe(true)
  })

  it('treats pre-epoch and invalid dates as unknown', () => {
    expect(isUnknownDate(new Date(-1000))).toBe(true)
    expect(isUnknownDate(new Date('not a date'))).toBe(true)
  })

  it('treats missing values as unknown', () => {
    expect(isUnknownDate(null)).toBe(true)
    expect(isUnknownDate(undefined)).toBe(true)
  })

  it('treats a genuine post-epoch date as known', () => {
    expect(isUnknownDate(new Date(2026, 2, 2, 9, 0, 0))).toBe(false)
    expect(isUnknownDate(new Date(1))).toBe(false)
  })
})
