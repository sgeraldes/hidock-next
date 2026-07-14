/**
 * Tests for the TitleBar device pill — specifically that "Restart app" is
 * reachable in EVERY connection state (not just connected), so a stuck device
 * can be recovered by restarting while disconnected / connecting / failed.
 *
 * Radix DropdownMenu opens on keydown (Enter), not click (see other suites).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { TitleBar } from '../TitleBar'
import { useDeviceConnection } from '@/hooks/useDeviceConnection'

vi.mock('@/hooks/useDeviceConnection', () => ({
  useDeviceConnection: vi.fn(),
}))

// ThemeToggle pulls the theme hook + system prefs — not under test here.
vi.mock('@/components/ThemeToggle', () => ({
  ThemeToggle: () => <div data-testid="theme-toggle" />,
}))

const mockUseDeviceConnection = vi.mocked(useDeviceConnection)

function setConnection(overrides: Partial<ReturnType<typeof useDeviceConnection>>) {
  mockUseDeviceConnection.mockReturnValue({
    status: 'disconnected',
    isConnected: false,
    isConnecting: false,
    isDisconnected: true,
    isFailed: false,
    deviceModel: null,
    label: 'Connect device',
    failedHint: null,
    connect: vi.fn(),
    disconnect: vi.fn(),
    ...overrides,
  } as ReturnType<typeof useDeviceConnection>)
}

function renderTitleBar() {
  return render(
    <MemoryRouter>
      <TitleBar sidebarOpen />
    </MemoryRouter>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('TitleBar device pill — Restart reachable in all states', () => {
  it('exposes "Restart app" from the device-options menu while DISCONNECTED', async () => {
    setConnection({ status: 'disconnected', label: 'Connect device' })
    renderTitleBar()

    // Primary action is still a one-click connect.
    expect(screen.getByRole('button', { name: /connect device/i })).toBeInTheDocument()

    // The "Device options" caret opens a menu that always includes Restart.
    fireEvent.keyDown(screen.getByRole('button', { name: /device options/i }), { key: 'Enter' })
    expect(await screen.findByRole('menuitem', { name: /restart app/i })).toBeInTheDocument()
  })

  it('exposes "Restart app" while CONNECTING (device may be stuck)', async () => {
    setConnection({
      status: 'connecting',
      isConnecting: true,
      isDisconnected: false,
      label: 'Connecting…',
    })
    renderTitleBar()

    fireEvent.keyDown(screen.getByRole('button', { name: /device options/i }), { key: 'Enter' })
    expect(await screen.findByRole('menuitem', { name: /restart app/i })).toBeInTheDocument()
  })

  it('exposes "Restart app" and a retry action while FAILED', async () => {
    setConnection({
      status: 'failed',
      isFailed: true,
      isDisconnected: false,
      label: 'Connection failed',
      failedHint: 'Device may be busy',
    })
    renderTitleBar()

    fireEvent.keyDown(screen.getByRole('button', { name: /device options/i }), { key: 'Enter' })
    expect(await screen.findByRole('menuitem', { name: /restart app/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /retry connection/i })).toBeInTheDocument()
  })

  it('still exposes "Restart app" in the CONNECTED dropdown (no regression)', async () => {
    setConnection({
      status: 'connected',
      isConnected: true,
      isDisconnected: false,
      deviceModel: 'H1E',
      label: 'H1E',
    })
    renderTitleBar()

    // Connected pill is itself the dropdown trigger (labelled by its model text).
    fireEvent.keyDown(screen.getByRole('button', { name: /h1e/i }), { key: 'Enter' })
    expect(await screen.findByRole('menuitem', { name: /restart app/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /go to sync/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /disconnect/i })).toBeInTheDocument()
  })
})
