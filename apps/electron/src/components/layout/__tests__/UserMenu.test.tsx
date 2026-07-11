/**
 * Tests for the titlebar UserMenu "About" → dialog (app name + version + repo),
 * and that it degrades gracefully when app.info() is unavailable.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { UserMenu } from '../UserMenu'

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({ theme: 'system', resolvedTheme: 'light', setTheme: vi.fn(), toggleTheme: vi.fn() })
}))

function setAppInfo(info: unknown) {
  ;(window as any).electronAPI = {
    app: { info: vi.fn().mockResolvedValue(info), restart: vi.fn() }
  }
}

describe('UserMenu — About dialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  afterEach(() => {
    delete (window as any).electronAPI
  })

  it('opens an About dialog with the app name, version, platform and repo link', async () => {
    setAppInfo({ version: '1.2.3', name: 'HiDock Next', isPackaged: false, platform: 'win32' })
    render(<UserMenu />)

    // Open the app menu (Radix opens on Enter), then choose About.
    fireEvent.keyDown(screen.getByRole('button', { name: /app menu/i }), { key: 'Enter' })
    fireEvent.click(await screen.findByRole('menuitem', { name: /about/i }))

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toBeInTheDocument()
    expect(screen.getByText('Meeting Intelligence')).toBeInTheDocument()
    expect(screen.getByText('v1.2.3')).toBeInTheDocument()
    expect(screen.getByText('win32')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /github\.com\/sgeraldes\/hidock-next/i })).toBeInTheDocument()
  })

  it('degrades gracefully to "Unknown" version when app info is unavailable', async () => {
    // No window.electronAPI at all.
    render(<UserMenu />)

    fireEvent.keyDown(screen.getByRole('button', { name: /app menu/i }), { key: 'Enter' })
    fireEvent.click(await screen.findByRole('menuitem', { name: /about/i }))

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Meeting Intelligence')).toBeInTheDocument()
    expect(screen.getByText('Unknown')).toBeInTheDocument()
  })
})
