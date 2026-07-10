/**
 * Tests for the GlobalAssistant mount (App.tsx).
 *
 * The floating AI assistant must be reachable on EVERY page, but the Library
 * renders its own assistant inside TriPaneLayout — so GlobalAssistant must NOT
 * mount there (avoids two bubbles). On every other route it mounts the floating
 * bubble regardless of the "Chat Placement" setting (embedded falls back to the
 * floating bubble off-Library rather than showing nothing).
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { GlobalAssistant } from '../App'
import { useUIStore } from '@/store/ui/useUIStore'

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <GlobalAssistant />
    </MemoryRouter>
  )
}

beforeEach(() => {
  window.localStorage.clear()
  const ui = useUIStore.getState()
  ui.setChatPlacement('floating')
  ui.setChatOpen(false)
})

describe('GlobalAssistant', () => {
  it('mounts the floating assistant bubble on a non-Library route (e.g. Today)', () => {
    renderAt('/today')
    expect(screen.getAllByTestId('floating-assistant-button')).toHaveLength(1)
  })

  it('does NOT mount on the Library route (Library owns its own assistant — no double bubble)', () => {
    renderAt('/library')
    expect(screen.queryByTestId('floating-assistant-button')).not.toBeInTheDocument()
  })

  it('still shows the floating bubble when placement is "embedded" off-Library (fallback)', () => {
    useUIStore.getState().setChatPlacement('embedded')
    renderAt('/people')
    expect(screen.getAllByTestId('floating-assistant-button')).toHaveLength(1)
  })
})
