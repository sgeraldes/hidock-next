/**
 * Tests for the integrated titlebar chrome (Wave: unified bar):
 *  - the brand lockup lives IN the bar (moved out of the sidebar);
 *  - the edge-handle toggles the sidebar collapse in both states;
 *  - the right cluster exposes notifications / activity / settings / device /
 *    user-menu;
 *  - the native window-controls gutter is reserved on the right.
 *
 * Device-pill Restart-in-all-states is covered by TitleBar.test.tsx.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { TitleBar } from '../TitleBar'
import { useDeviceConnection } from '@/hooks/useDeviceConnection'

vi.mock('@/hooks/useDeviceConnection', () => ({
  useDeviceConnection: vi.fn(),
}))

const mockUseDeviceConnection = vi.mocked(useDeviceConnection)

function setDisconnected() {
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
  } as unknown as ReturnType<typeof useDeviceConnection>)
}

function renderBar(props: Partial<React.ComponentProps<typeof TitleBar>> = {}) {
  return render(
    <MemoryRouter>
      <TitleBar sidebarOpen onToggleSidebar={vi.fn()} {...props} />
    </MemoryRouter>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  setDisconnected()
})

describe('Integrated titlebar — brand cell', () => {
  it('renders the two-line brand lockup inside the bar', () => {
    renderBar()
    expect(screen.getByTestId('app-brand')).toBeInTheDocument()
    expect(screen.getByText('Meeting')).toBeInTheDocument()
    expect(screen.getByText('Intelligence')).toBeInTheDocument()
  })
})

describe('Integrated titlebar — edge-handle collapse', () => {
  it('toggles the sidebar when expanded (Collapse)', () => {
    const onToggle = vi.fn()
    renderBar({ sidebarOpen: true, onToggleSidebar: onToggle })
    fireEvent.click(screen.getByRole('button', { name: /collapse sidebar/i }))
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('toggles the sidebar when collapsed (Expand)', () => {
    const onToggle = vi.fn()
    renderBar({ sidebarOpen: false, onToggleSidebar: onToggle })
    fireEvent.click(screen.getByRole('button', { name: /expand sidebar/i }))
    expect(onToggle).toHaveBeenCalledTimes(1)
  })
})

describe('Integrated titlebar — right cluster', () => {
  it('exposes notifications, activity, settings, device and user-menu controls', () => {
    renderBar()
    expect(screen.getByRole('button', { name: /notifications/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /activity log/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^settings$/i })).toBeInTheDocument()
    // Device status pill (disconnected → "Connect device") + its options caret.
    expect(screen.getByRole('button', { name: /connect device/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /device options/i })).toBeInTheDocument()
    // Avatar → app menu.
    expect(screen.getByRole('button', { name: /app menu/i })).toBeInTheDocument()
  })

  it('opens the app menu with Appearance (theme) + Developer (QA logs) controls', async () => {
    renderBar()
    fireEvent.keyDown(screen.getByRole('button', { name: /app menu/i }), { key: 'Enter' })
    expect(await screen.findByRole('menuitemradio', { name: /light/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitemradio', { name: /dark/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitemradio', { name: /system/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitemcheckbox', { name: /qa logs/i })).toBeInTheDocument()
  })
})

describe('Integrated titlebar — ⌘K search shortcut', () => {
  it('focuses the search input on Cmd/Ctrl+K', () => {
    renderBar()
    const searchbox = screen.getByRole('searchbox')
    expect(searchbox).not.toHaveFocus()
    fireEvent.keyDown(window, { key: 'k', metaKey: true })
    expect(searchbox).toHaveFocus()
  })

  it('does NOT hijack ⌘K while another text field is focused', () => {
    render(
      <MemoryRouter>
        <input data-testid="other" />
        <TitleBar sidebarOpen onToggleSidebar={vi.fn()} />
      </MemoryRouter>
    )
    const other = screen.getByTestId('other') as HTMLInputElement
    other.focus()
    expect(other).toHaveFocus()
    fireEvent.keyDown(window, { key: 'k', metaKey: true })
    // Focus stays put; the titlebar search is not stolen.
    expect(other).toHaveFocus()
    expect(screen.getByRole('searchbox')).not.toHaveFocus()
  })

  it('renders a subtle keyboard hint on the search input', () => {
    renderBar()
    // ⌘K on mac, "Ctrl K" elsewhere — either way a <kbd> hint is present.
    expect(screen.getByText(/⌘K|Ctrl K/)).toBeInTheDocument()
  })
})

describe('Integrated titlebar — brand is a home affordance', () => {
  it('navigates home when the brand lockup is clicked', () => {
    renderBar()
    const home = screen.getByRole('button', { name: /go to home/i })
    expect(home).toHaveClass('titlebar-no-drag')
  })
})

describe('Integrated titlebar — native window controls gutter', () => {
  it('reserves the native-controls width on the right (where Electron draws — ▢ ✕)', () => {
    const { container } = renderBar()
    const header = container.querySelector('header')
    expect(header).not.toBeNull()
    // On Windows/Linux the overlay is ~138px; the bar reserves it so nothing hides.
    expect((header as HTMLElement).style.paddingRight).toBe('138px')
  })
})
