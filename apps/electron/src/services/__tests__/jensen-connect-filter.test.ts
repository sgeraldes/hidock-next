/**
 * FIX-015: USB connect listener uses case-sensitive productName match
 *
 * BUG: The USB connect handler checks `device.productName?.includes('HiDock')`
 * which is case-sensitive. If firmware reports the name in different casing
 * (e.g. "HIDOCK", "hidock", "Hidock H1"), the filter would fail silently
 * and auto-connect would not trigger.
 *
 * Fix: Use case-insensitive comparison
 */

import { describe, it, expect } from 'vitest'

describe('FIX-015: USB connect device filter', () => {
  // Test the filter logic pattern used in jensen.ts:392
  function matchesHiDock(productName: string | undefined): boolean {
    // Current buggy implementation
    return productName?.includes('HiDock') ?? false
  }

  function matchesHiDockFixed(productName: string | undefined): boolean {
    return productName?.toLowerCase().includes('hidock') ?? false
  }

  it('BUG: case-sensitive filter misses uppercase variant', () => {
    // Some firmware versions may report uppercase
    expect(matchesHiDock('HIDOCK H1')).toBe(false) // BUG: should be true
    expect(matchesHiDockFixed('HIDOCK H1')).toBe(true) // FIXED
  })

  it('BUG: case-sensitive filter misses lowercase variant', () => {
    expect(matchesHiDock('hidock p1')).toBe(false) // BUG: should be true
    expect(matchesHiDockFixed('hidock p1')).toBe(true) // FIXED
  })

  it('should match standard casing', () => {
    expect(matchesHiDockFixed('HiDock H1')).toBe(true)
    expect(matchesHiDockFixed('HiDock H1E')).toBe(true)
    expect(matchesHiDockFixed('HiDock P1')).toBe(true)
  })

  it('should not match unrelated devices', () => {
    expect(matchesHiDockFixed('Logitech Webcam')).toBe(false)
    expect(matchesHiDockFixed(undefined)).toBe(false)
    expect(matchesHiDockFixed('')).toBe(false)
  })

  it('shared jensen-protocol must use case-insensitive product name matching', async () => {
    const fs = await import('fs')
    const path = await import('path')

    // The device-matching logic now lives in the shared @hidock/jensen-protocol
    // package (consumed by both the renderer and the main process).
    const sourceFile = path.join(
      __dirname, '..', '..', '..', '..', '..',
      'packages', 'jensen-protocol', 'src', 'jensen-device.ts'
    )
    const source = fs.readFileSync(sourceFile, 'utf-8')

    const hasProductNameLowerCase = source.includes('productName?.toLowerCase()')
    expect(hasProductNameLowerCase, 'jensen-protocol must lowercase productName before matching').toBe(true)

    const hasCaseSensitiveCheck = /productName\??\.(includes|match)\(/g.test(source)
    expect(hasCaseSensitiveCheck, 'No direct case-sensitive productName.includes() should exist').toBe(false)
  })
})
