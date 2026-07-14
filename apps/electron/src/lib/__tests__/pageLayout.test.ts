import { describe, it, expect } from 'vitest'
import { pageContent, pageWide, proseMeasure } from '../pageLayout'

/**
 * These guard the responsive contract of the shared page-width scale: every
 * surface must be horizontally centered, fluid at narrow widths, and step up to
 * a wider cap on large/extra-large screens (so wide/maximized windows are not a
 * narrow column with dead gutters). Prose stays readable via a ch-based measure.
 */
describe('pageLayout width scale', () => {
  it('pageContent centers, is fluid, and widens responsively', () => {
    expect(pageContent).toContain('mx-auto')
    expect(pageContent).toContain('w-full')
    // base cap, then wider at xl and 2xl
    expect(pageContent).toContain('max-w-4xl')
    expect(pageContent).toContain('xl:max-w-5xl')
    expect(pageContent).toContain('2xl:max-w-6xl')
  })

  it('pageWide centers, is fluid, and uses more of a wide window than pageContent', () => {
    expect(pageWide).toContain('mx-auto')
    expect(pageWide).toContain('w-full')
    expect(pageWide).toContain('max-w-6xl')
    expect(pageWide).toContain('xl:max-w-[84rem]')
    expect(pageWide).toContain('2xl:max-w-[100rem]')
  })

  it('proseMeasure caps long text at a readable ch-based measure', () => {
    expect(proseMeasure).toMatch(/max-w-\[\d+ch\]/)
  })

  it('both containers scope their width caps to breakpoints (no unbounded stretch)', () => {
    for (const cls of [pageContent, pageWide]) {
      expect(cls).toMatch(/(^|\s)max-w-/)
    }
  })
})
