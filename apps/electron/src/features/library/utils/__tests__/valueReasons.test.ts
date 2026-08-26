import { describe, it, expect } from 'vitest'
import { VALUE_REASON_LABELS, formatValueReasons } from '../valueReasons'

describe('VALUE_REASON_LABELS', () => {
  it('has a human-readable label for every fixed reason tag', () => {
    expect(VALUE_REASON_LABELS.personal_family).toBe('Personal / family')
    expect(VALUE_REASON_LABELS.greeting_only_no_show).toBe('Greeting only / no-show')
    expect(VALUE_REASON_LABELS.background_ambient).toBe('Background / ambient')
    expect(VALUE_REASON_LABELS.no_substance).toBe('No substance')
    expect(VALUE_REASON_LABELS.off_topic_chatter).toBe('Off-topic chatter')
  })
})

describe('formatValueReasons', () => {
  it('returns an empty string for null/undefined/empty', () => {
    expect(formatValueReasons(null)).toBe('')
    expect(formatValueReasons(undefined)).toBe('')
    expect(formatValueReasons([])).toBe('')
  })

  it('formats a single reason tag', () => {
    expect(formatValueReasons(['personal_family'])).toBe('Personal / family')
  })

  it('formats multiple reason tags, comma-separated', () => {
    expect(formatValueReasons(['personal_family', 'background_ambient'])).toBe(
      'Personal / family, Background / ambient'
    )
  })

  it('falls back to the raw string for an unrecognized tag (defensive, never drops data)', () => {
    expect(formatValueReasons(['some_future_tag'])).toBe('some_future_tag')
    expect(formatValueReasons(['personal_family', 'unknown_tag'])).toBe('Personal / family, unknown_tag')
  })
})
