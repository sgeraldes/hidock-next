/**
 * Signal hierarchy (signal-tiers.ts) — the ranking that makes the auto-split sweep
 * upgrade-only and lets M365 attendee data later upgrade transcript-derived guesses.
 */

import { describe, it, expect } from 'vitest'
import { methodPriority, methodConfidence, canUpgrade } from '../signal-tiers'

describe('methodPriority', () => {
  it('ranks the tiers: manual > connector > attendee-email > speaker > attendee-context > lexical > inferred', () => {
    expect(methodPriority('manual')).toBeGreaterThan(methodPriority('connector-email'))
    expect(methodPriority('connector-email')).toBeGreaterThan(methodPriority('attendee-email'))
    expect(methodPriority('attendee-email')).toBeGreaterThan(methodPriority('speaker-map'))
    expect(methodPriority('speaker-map')).toBeGreaterThan(methodPriority('attendee-context'))
    expect(methodPriority('attendee-context')).toBeGreaterThan(methodPriority('lexical'))
    expect(methodPriority('lexical')).toBeGreaterThan(methodPriority('inferred'))
  })
  it('is 0 for no method and mid-low for unknown methods', () => {
    expect(methodPriority(null)).toBe(0)
    expect(methodPriority(undefined)).toBe(0)
    expect(methodPriority('something-new')).toBeGreaterThan(methodPriority('inferred'))
    expect(methodPriority('something-new')).toBeLessThan(methodPriority('speaker-map'))
  })
})

describe('methodConfidence', () => {
  it('maps tiers to their documented confidences', () => {
    expect(methodConfidence('connector-email')).toBe(1.0)
    expect(methodConfidence('attendee-email')).toBe(0.9)
    expect(methodConfidence('speaker-map')).toBe(0.85)
    expect(methodConfidence('attendee-context')).toBe(0.7)
    expect(methodConfidence('lexical')).toBe(0.6)
  })
})

describe('canUpgrade (upgrade-only sweep)', () => {
  it('allows resolving a not-yet-resolved recording', () => {
    expect(canUpgrade(null, 'attendee-context')).toBe(true)
    expect(canUpgrade(undefined, 'speaker-map')).toBe(true)
  })
  it('NEVER overwrites a manual user decision', () => {
    expect(canUpgrade('manual', 'connector-email')).toBe(false)
    expect(canUpgrade('manual', 'attendee-email')).toBe(false)
    expect(canUpgrade('manual', 'speaker-map')).toBe(false)
  })
  it('upgrades a lower-tier signal to a higher one (M365 attendees land)', () => {
    expect(canUpgrade('attendee-context', 'attendee-email')).toBe(true)
    expect(canUpgrade('attendee-context', 'connector-email')).toBe(true)
    expect(canUpgrade('speaker-map', 'attendee-email')).toBe(true)
  })
  it('is idempotent — an equal or lower signal does not rewrite', () => {
    expect(canUpgrade('attendee-context', 'attendee-context')).toBe(false)
    expect(canUpgrade('attendee-email', 'attendee-context')).toBe(false)
    expect(canUpgrade('connector-email', 'speaker-map')).toBe(false)
  })
})
