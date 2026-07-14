import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NavCountBadge } from '../Layout'

describe('NavCountBadge (sidebar nav counters)', () => {
  it('renders nothing when count is 0', () => {
    const { container } = render(<NavCountBadge href="/today" count={0} collapsed={false} active={false} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing for negative counts', () => {
    const { container } = render(<NavCountBadge href="/sync" count={-1} collapsed={false} active={false} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders the count when > 0', () => {
    render(<NavCountBadge href="/today" count={3} collapsed={false} active={false} />)
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('exposes a meaningful aria-label per surface', () => {
    const { rerender } = render(<NavCountBadge href="/today" count={3} collapsed={false} active={false} />)
    expect(screen.getByLabelText('3 events today')).toBeInTheDocument()

    rerender(<NavCountBadge href="/today" count={1} collapsed={false} active={false} />)
    expect(screen.getByLabelText('1 event today')).toBeInTheDocument()

    rerender(<NavCountBadge href="/actionables" count={2} collapsed={false} active={false} />)
    expect(screen.getByLabelText('2 pending actionables')).toBeInTheDocument()

    rerender(<NavCountBadge href="/actionables" count={1} collapsed={false} active={false} />)
    expect(screen.getByLabelText('1 pending actionable')).toBeInTheDocument()

    rerender(<NavCountBadge href="/sync" count={5} collapsed={false} active={false} />)
    expect(screen.getByLabelText('5 files to sync')).toBeInTheDocument()

    rerender(<NavCountBadge href="/sync" count={1} collapsed={false} active={false} />)
    expect(screen.getByLabelText('1 file to sync')).toBeInTheDocument()
  })

  it('shows the exact count (only caps at an absurd width)', () => {
    const { rerender } = render(<NavCountBadge href="/sync" count={150} collapsed={false} active={false} />)
    // Exact count now — the pill widens for more digits; no "99+" cap.
    expect(screen.getByText('150')).toBeInTheDocument()
    expect(screen.getByLabelText('150 files to sync')).toBeInTheDocument()
    // Only an absurd value caps, to protect the layout.
    rerender(<NavCountBadge href="/sync" count={12000} collapsed={false} active={false} />)
    expect(screen.getByText('9999+')).toBeInTheDocument()
  })

  it('renders in the collapsed (icon-corner) variant as well', () => {
    render(<NavCountBadge href="/today" count={4} collapsed={true} active={false} />)
    expect(screen.getByText('4')).toBeInTheDocument()
    expect(screen.getByLabelText('4 events today')).toBeInTheDocument()
  })
})
