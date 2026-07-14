/**
 * Theme core — the framework-free resolution/application shared by the pre-paint
 * bootstrap and the React reconciler.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  resolveTheme,
  applyTheme,
  readPersistedThemePreference,
  bootstrapTheme,
  UI_STORE_KEY
} from '../theme'

beforeEach(() => {
  localStorage.clear()
  document.documentElement.classList.remove('dark')
  document.documentElement.style.colorScheme = ''
})

describe('resolveTheme', () => {
  it('passes explicit preferences straight through', () => {
    expect(resolveTheme('light')).toBe('light')
    expect(resolveTheme('dark')).toBe('dark')
  })

  it("resolves 'system' to light where matchMedia is unavailable (jsdom)", () => {
    expect(resolveTheme('system')).toBe('light')
  })
})

describe('applyTheme', () => {
  it('toggles the dark class and color-scheme on <html>', () => {
    applyTheme('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.style.colorScheme).toBe('dark')

    applyTheme('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(document.documentElement.style.colorScheme).toBe('light')
  })
})

describe('readPersistedThemePreference', () => {
  it("defaults to 'system' when nothing is stored", () => {
    expect(readPersistedThemePreference()).toBe('system')
  })

  it('reads a valid persisted preference from the UI store blob', () => {
    localStorage.setItem(UI_STORE_KEY, JSON.stringify({ state: { theme: 'dark' }, version: 0 }))
    expect(readPersistedThemePreference()).toBe('dark')
  })

  it("falls back to 'system' on unparseable or unknown values", () => {
    localStorage.setItem(UI_STORE_KEY, '{not json')
    expect(readPersistedThemePreference()).toBe('system')
    localStorage.setItem(UI_STORE_KEY, JSON.stringify({ state: { theme: 'chartreuse' } }))
    expect(readPersistedThemePreference()).toBe('system')
  })
})

describe('bootstrapTheme', () => {
  it('applies the persisted preference before paint', () => {
    localStorage.setItem(UI_STORE_KEY, JSON.stringify({ state: { theme: 'dark' }, version: 0 }))
    bootstrapTheme()
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })
})
