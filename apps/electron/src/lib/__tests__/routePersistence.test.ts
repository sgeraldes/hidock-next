import { describe, it, expect, beforeEach } from 'vitest'
import { persistRoute, getInitialRoute, LAST_ROUTE_KEY, DEFAULT_ROUTE } from '../routePersistence'

describe('routePersistence (H8)', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  describe('getInitialRoute', () => {
    it('returns the default route on a fresh session', () => {
      expect(getInitialRoute()).toBe(DEFAULT_ROUTE)
    })

    it('restores the last persisted route', () => {
      sessionStorage.setItem(LAST_ROUTE_KEY, '/calendar')
      expect(getInitialRoute()).toBe('/calendar')
    })

    it('restores a route with a search string', () => {
      sessionStorage.setItem(LAST_ROUTE_KEY, '/library?filter=synced')
      expect(getInitialRoute()).toBe('/library?filter=synced')
    })

    it('ignores a persisted bare root path and falls back to default', () => {
      sessionStorage.setItem(LAST_ROUTE_KEY, '/')
      expect(getInitialRoute()).toBe(DEFAULT_ROUTE)
    })

    it('ignores a non-absolute persisted value', () => {
      sessionStorage.setItem(LAST_ROUTE_KEY, 'evil')
      expect(getInitialRoute()).toBe(DEFAULT_ROUTE)
    })
  })

  describe('persistRoute', () => {
    it('persists a real route', () => {
      persistRoute('/settings')
      expect(sessionStorage.getItem(LAST_ROUTE_KEY)).toBe('/settings')
    })

    it('does not persist the transient root path', () => {
      persistRoute('/')
      expect(sessionStorage.getItem(LAST_ROUTE_KEY)).toBeNull()
    })

    it('does not persist an empty value', () => {
      persistRoute('')
      expect(sessionStorage.getItem(LAST_ROUTE_KEY)).toBeNull()
    })

    it('round-trips: a background event does not change the restored route', () => {
      // Simulate: user is on /people, a background event fires (no navigation)
      persistRoute('/people')
      // A reload would resolve the root path via getInitialRoute
      expect(getInitialRoute()).toBe('/people')
    })
  })
})
