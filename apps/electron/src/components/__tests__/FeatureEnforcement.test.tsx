/**
 * Renderer feature enforcement (Track I, I2-c):
 *  - nav visibility: hidden (direct disable) vs grayed "Requires X" (cascade)
 *  - FeatureRoute renders the honest FeatureDisabledPage (incl. deep links)
 *  - FeaturesSettings minimal preset dropdown persists via config
 *  - default-preset regression: everything enabled, nothing hidden or gated
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { navItemVisibility } from '@/components/layout/Layout'
import { FeatureRoute, FeatureDisabledPage } from '@/components/FeatureDisabledPage'
import { FeaturesSettings } from '@/components/settings/FeaturesSettings'
import { useFeatureStore } from '@/store/useFeatureStore'
import { useConfigStore } from '@/store/domain/useConfigStore'
import { resolveFeatureState, type FeaturesConfig } from '@/shared/feature-registry'
import type { AppConfig } from '@/types'

vi.mock('@/components/ui/toaster', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/components/ui/toaster')>()
  const toast = Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() })
  return { ...mod, toast }
})

function setFeatures(features?: FeaturesConfig | null): void {
  useFeatureStore.getState().setFromConfig(features ?? undefined)
}

beforeEach(() => {
  setFeatures(undefined) // default `full`
  useFeatureStore.getState().setPendingRestart([])
})

describe('navItemVisibility', () => {
  const NAV_HREFS = [
    '/today',
    '/library',
    '/assistant',
    '/explore',
    '/context-graph',
    '/people',
    '/projects',
    '/calendar',
    '/actionables',
    '/sync',
  ]

  it('default full preset: every nav item is visible (regression)', () => {
    const resolved = resolveFeatureState(undefined)
    for (const href of NAV_HREFS) {
      expect(navItemVisibility(resolved, href).visibility, href).toBe('visible')
    }
  })

  it('library-only: preset-disabled surfaces are HIDDEN, floor + preset items stay', () => {
    const resolved = resolveFeatureState({ preset: 'library-only', flags: {} })
    expect(navItemVisibility(resolved, '/library').visibility).toBe('visible')
    expect(navItemVisibility(resolved, '/today').visibility).toBe('visible')
    expect(navItemVisibility(resolved, '/sync').visibility).toBe('visible')
    for (const href of ['/assistant', '/explore', '/context-graph', '/people', '/projects', '/calendar', '/actionables']) {
      expect(navItemVisibility(resolved, href).visibility, href).toBe('hidden')
    }
  })

  it('cascade: transcription off grays dependents with a "Requires Transcription" hint', () => {
    const resolved = resolveFeatureState({ preset: 'full', flags: { transcription: false } })
    for (const href of ['/assistant', '/explore', '/context-graph', '/actionables']) {
      const v = navItemVisibility(resolved, href)
      expect(v.visibility, href).toBe('grayed')
      expect(v.hint).toBe('Requires Transcription')
    }
    // Directly-disabled (user) items are hidden, not grayed.
    const userOff = resolveFeatureState({ preset: 'full', flags: { calendar: false } })
    expect(navItemVisibility(userOff, '/calendar').visibility).toBe('hidden')
    expect(navItemVisibility(userOff, '/people')).toEqual({
      visibility: 'grayed',
      hint: 'Requires Calendar',
    })
  })

  it('round-3 pending-DISABLE: /sync stays VISIBLE (teardown controls must stay reachable)', () => {
    // device-sync live-disabled while boot-active: desired-off + pendingRestart.
    const resolved = resolveFeatureState({ preset: 'full', flags: { 'device-sync': false } })
    expect(navItemVisibility(resolved, '/sync', ['device-sync'])).toEqual({
      visibility: 'visible',
      hint: 'Off after restart',
    })
    // Without the pending marker (i.e., after the restart) it hides as before.
    expect(navItemVisibility(resolved, '/sync').visibility).toBe('hidden')
  })
})

describe('FeatureRoute + FeatureDisabledPage', () => {
  function renderRoute(children = <div data-testid="page-content">content</div>) {
    return render(
      <MemoryRouter>
        <FeatureRoute feature="calendar">{children}</FeatureRoute>
      </MemoryRouter>
    )
  }

  it('renders children when the feature is enabled (default full)', () => {
    renderRoute()
    expect(screen.getByTestId('page-content')).toBeInTheDocument()
  })

  it('renders the honest disabled page when the feature is off: name, why, enable CTA', () => {
    setFeatures({ preset: 'library-only', flags: {} })
    renderRoute()
    expect(screen.queryByTestId('page-content')).not.toBeInTheDocument()
    expect(screen.getByText('Calendar is turned off')).toBeInTheDocument()
    expect(screen.getByText('Not included in the current preset')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /enable in settings/i })).toBeInTheDocument()
  })

  it('shows the cascade reason for a soft-disabled feature', () => {
    setFeatures({ preset: 'full', flags: { transcription: false } })
    render(
      <MemoryRouter>
        <FeatureRoute feature="assistant">
          <div data-testid="page-content" />
        </FeatureRoute>
      </MemoryRouter>
    )
    expect(screen.getByText('Assistant is turned off')).toBeInTheDocument()
    expect(screen.getByText('Requires Transcription')).toBeInTheDocument()
  })

  it('deep link honesty: /meeting/:id surface (calendar-owned) shows the page, never a blank', () => {
    setFeatures({ preset: 'library-only', flags: {} })
    render(
      <MemoryRouter initialEntries={['/meeting/abc-123']}>
        <FeatureRoute feature="calendar">
          <div data-testid="meeting-detail" />
        </FeatureRoute>
      </MemoryRouter>
    )
    expect(screen.queryByTestId('meeting-detail')).not.toBeInTheDocument()
    expect(screen.getByText('Calendar is turned off')).toBeInTheDocument()
  })

  it('swaps live when the feature is disabled while the page is open', () => {
    renderRoute()
    expect(screen.getByTestId('page-content')).toBeInTheDocument()
    act(() => setFeatures({ preset: 'full', flags: { calendar: false } }))
    expect(screen.queryByTestId('page-content')).not.toBeInTheDocument()
    expect(screen.getByText('Calendar is turned off')).toBeInTheDocument()
    expect(screen.getByText('Turned off in Settings')).toBeInTheDocument()
  })

  it('round-3 pending-DISABLE keeps the device surface rendered (teardown reachable)', () => {
    // device-sync desired-off but boot-active (pendingRestart from main).
    act(() => {
      setFeatures({ preset: 'full', flags: { 'device-sync': false } })
      useFeatureStore.getState().setPendingRestart(['device-sync'])
    })
    render(
      <MemoryRouter>
        <FeatureRoute feature="device-sync">
          <div data-testid="sync-page" />
        </FeatureRoute>
      </MemoryRouter>
    )
    // Surface stays up — disconnect/cancel controls must remain reachable.
    expect(screen.getByTestId('sync-page')).toBeInTheDocument()
    // After the restart (pending cleared), the honest disabled page shows.
    act(() => useFeatureStore.getState().setPendingRestart([]))
    expect(screen.queryByTestId('sync-page')).not.toBeInTheDocument()
    expect(screen.getByText('Device Sync is turned off')).toBeInTheDocument()
  })

  it('FeatureDisabledPage notes when enabling needs a restart (assistant)', () => {
    setFeatures({ preset: 'library-only', flags: {} })
    render(
      <MemoryRouter>
        <FeatureDisabledPage feature="assistant" />
      </MemoryRouter>
    )
    expect(screen.getByText(/takes effect after a restart/i)).toBeInTheDocument()
  })
})

describe('FeaturesSettings (minimal preset dropdown)', () => {
  const baseConfig = { features: { preset: 'full', flags: {} } } as unknown as AppConfig

  beforeEach(() => {
    useConfigStore.setState({ config: baseConfig })
  })

  it('shows the current preset and applies a new one via config:update-section', async () => {
    const updateConfig = vi.fn().mockResolvedValue(undefined)
    useConfigStore.setState({ updateConfig })
    render(<FeaturesSettings />)

    const select = screen.getByLabelText('Feature preset') as HTMLSelectElement
    expect(select.value).toBe('full')
    fireEvent.change(select, { target: { value: 'library-only' } })
    expect(updateConfig).toHaveBeenCalledWith('features', { preset: 'library-only', flags: {} })
  })

  it('lists what the current resolved state turns off (honest summary)', () => {
    setFeatures({ preset: 'library-only', flags: {} })
    useConfigStore.setState({
      config: { features: { preset: 'library-only', flags: {} } } as unknown as AppConfig,
    })
    render(<FeaturesSettings />)
    expect(screen.getByText('Turned off by this preset:')).toBeInTheDocument()
    expect(screen.getByText('Transcription')).toBeInTheDocument()
    expect(screen.getByText('Assistant')).toBeInTheDocument()
  })

  it('shows the restart banner only when a pending-restart feature exists', () => {
    const { rerender } = render(<FeaturesSettings />)
    expect(screen.queryByText(/restart required/i)).not.toBeInTheDocument()
    useFeatureStore.getState().setPendingRestart(['assistant'])
    rerender(<FeaturesSettings />)
    // Desired-ON + pending ⇒ enable direction: "Restart required to activate".
    expect(screen.getByText(/restart required to activate/i)).toBeInTheDocument()
    expect(screen.getByText('Assistant')).toBeInTheDocument()
  })

  it('round-3 banner distinguishes the DISABLE direction ("disabled for new work")', () => {
    // device-sync desired-off + pending ⇒ disable direction wording.
    setFeatures({ preset: 'full', flags: { 'device-sync': false } })
    useFeatureStore.getState().setPendingRestart(['device-sync'])
    render(<FeaturesSettings />)
    const banner = screen.getByText(/disabled for new work — restart to fully unload/i)
    expect(banner).toBeInTheDocument()
    // The banner line itself names the feature (it also appears in the
    // "turned off" summary, so scope the assertion to the banner paragraph).
    expect(banner.textContent).toContain('Device Sync')
    expect(screen.queryByText(/restart required to activate/i)).not.toBeInTheDocument()
  })
})
