/**
 * ThemeToggle — flips light/dark, applies the `dark` class to <html>, and
 * persists the choice (localStorage via the UI store + best-effort config).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ThemeToggle } from '../ThemeToggle'
import { useUIStore } from '@/store/ui/useUIStore'
import { UI_STORE_KEY } from '@/lib/theme'

beforeEach(() => {
  localStorage.clear()
  document.documentElement.classList.remove('dark')
  // Start from an explicit light preference so the resolved theme is
  // deterministic regardless of the (absent) matchMedia in jsdom.
  useUIStore.setState({ theme: 'light' })
  global.window.electronAPI = {
    config: { updateSection: vi.fn().mockResolvedValue({ success: true, data: {} }) }
  } as any
})

describe('ThemeToggle', () => {
  it('applies dark to <html>, updates the store, and persists on toggle', async () => {
    render(<ThemeToggle />)

    const button = screen.getByRole('button', { name: 'Switch to dark theme' })
    expect(document.documentElement.classList.contains('dark')).toBe(false)

    fireEvent.click(button)

    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(useUIStore.getState().theme).toBe('dark')
    // Preference persisted to localStorage (read pre-paint on next launch).
    await waitFor(() => {
      const raw = localStorage.getItem(UI_STORE_KEY)
      expect(raw && JSON.parse(raw).state.theme).toBe('dark')
    })
    // Mirrored to config best-effort.
    expect(window.electronAPI.config.updateSection).toHaveBeenCalledWith('ui', { theme: 'dark' })

    // The label flips, and clicking again returns to light.
    const back = await screen.findByRole('button', { name: 'Switch to light theme' })
    fireEvent.click(back)
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(useUIStore.getState().theme).toBe('light')
  })
})
