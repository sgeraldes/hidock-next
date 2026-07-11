/**
 * Tests for the self-contained Brand lockup and the corner-cell divider contract.
 * The brand is always the top-left corner cell; the divider mode only toggles
 * which of the cell's two dividers are drawn (owner preview).
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Brand, showBrandVerticalDivider, showBrandHorizontalDivider } from '../Brand'

describe('Brand', () => {
  it('renders the two-line "Meeting Intelligence" wordmark + the app mark when expanded', () => {
    render(<Brand placement="titlebar" collapsed={false} />)
    expect(screen.getByText('Meeting')).toBeInTheDocument()
    expect(screen.getByText('Intelligence')).toBeInTheDocument()
    // The mark lives in a 64px slot so its centre lands on the 32px nav-rail axis.
    const brand = screen.getByTestId('app-brand')
    expect(brand.querySelector('.w-16')).not.toBeNull()
    expect(brand.querySelector('svg')).not.toBeNull()
  })

  it('hides the wordmark (mark only) when collapsed', () => {
    render(<Brand placement="titlebar" collapsed />)
    expect(screen.queryByText('Meeting')).not.toBeInTheDocument()
    expect(screen.queryByText('Intelligence')).not.toBeInTheDocument()
    // Mark (svg) still shown in the rail.
    expect(screen.getByTestId('app-brand').querySelector('svg')).not.toBeNull()
  })

  it('exposes the divider treatment as a swappable prop for both placements', () => {
    const { rerender } = render(<Brand placement="titlebar" />)
    expect(screen.getByTestId('app-brand')).toHaveAttribute('data-placement', 'titlebar')
    rerender(<Brand placement="sidebar" />)
    expect(screen.getByTestId('app-brand')).toHaveAttribute('data-placement', 'sidebar')
  })
})

describe('corner-cell divider contract', () => {
  it("'titlebar' drops the vertical divider, keeps the horizontal line", () => {
    expect(showBrandVerticalDivider('titlebar')).toBe(false)
    expect(showBrandHorizontalDivider('titlebar')).toBe(true)
  })

  it("'sidebar' keeps the vertical divider, drops the horizontal line", () => {
    expect(showBrandVerticalDivider('sidebar')).toBe(true)
    expect(showBrandHorizontalDivider('sidebar')).toBe(false)
  })

  it("'both' keeps both dividers (boxed corner cell)", () => {
    expect(showBrandVerticalDivider('both')).toBe(true)
    expect(showBrandHorizontalDivider('both')).toBe(true)
  })
})
