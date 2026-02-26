/**
 * FIX-014: Missing config interface fields for calendar UI preferences
 *
 * BUG: Calendar.tsx calls updateConfig('ui', { calendarView, hideEmptyMeetings, showListView })
 * but AppConfig.ui only defines: theme, defaultView, startOfWeek.
 * The extra fields save to JSON but are not typed, causing TypeScript errors
 * and making the code fragile (no IDE autocomplete, no validation).
 *
 * Fix: Add the missing fields to AppConfig.ui interface and default config.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// We'll test by importing the config module and checking the default config has the fields
describe('FIX-014: Config interface completeness', () => {
  it('default config.ui should include calendarView', async () => {
    // Mock electron app module
    vi.doMock('electron', () => ({
      app: {
        getPath: vi.fn((name: string) => {
          if (name === 'home') return '/tmp/test-home'
          if (name === 'userData') return '/tmp/test-userdata'
          return '/tmp'
        })
      }
    }))

    const configModule = await import('../config')
    const config = configModule.getConfig()

    // These fields must exist on config.ui
    expect(config.ui).toHaveProperty('calendarView')
    expect(config.ui).toHaveProperty('hideEmptyMeetings')
    expect(config.ui).toHaveProperty('showListView')
  })

  it('calendarView should default to "week"', async () => {
    vi.doMock('electron', () => ({
      app: {
        getPath: vi.fn((name: string) => {
          if (name === 'home') return '/tmp/test-home'
          if (name === 'userData') return '/tmp/test-userdata'
          return '/tmp'
        })
      }
    }))

    const configModule = await import('../config')
    const config = configModule.getConfig()

    expect(config.ui.calendarView).toBe('week')
    expect(config.ui.hideEmptyMeetings).toBe(true)
    expect(config.ui.showListView).toBe(false)
  })
})
