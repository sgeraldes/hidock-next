import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LibraryFilters, type TypeCounts } from '../LibraryFilters'

const typeCounts: TypeCounts = { all: 12, audio: 8, image: 3, pdf: 1, note: 0 }

function renderFilters(overrides: Partial<React.ComponentProps<typeof LibraryFilters>> = {}) {
  const handlers = {
    onFilterModeChange: vi.fn(),
    onSemanticFilterChange: vi.fn(),
    onExclusiveFilterChange: vi.fn(),
    onCategoryFilterChange: vi.fn(),
    onQualityFilterChange: vi.fn(),
    onStatusFilterChange: vi.fn(),
    onSourceTypeFilterChange: vi.fn(),
    onDurationPresetChange: vi.fn(),
    onSearchQueryChange: vi.fn(),
    onSortByChange: vi.fn(),
    onSortOrderChange: vi.fn(),
    onClearFilters: vi.fn()
  }
  render(
    <LibraryFilters
      stats={{ total: 12, deviceOnly: 2, localOnly: 6, both: 4, onSource: 6, locallyAvailable: 10 }}
      filterableCount={12}
      typeCounts={typeCounts}
      hasRatedQuality={false}
      filterMode="semantic"
      semanticFilter="all"
      exclusiveFilter="all"
      categoryFilter="all"
      qualityFilter="all"
      statusFilter="all"
      sourceTypeFilter="all"
      durationPreset="all"
      searchQuery=""
      sortBy="date"
      sortOrder="desc"
      {...handlers}
      {...overrides}
    />
  )
  return handlers
}

describe('LibraryFilters — source-type segmented control', () => {
  it('renders All / Audio / Images / PDFs / Notes with counts', () => {
    renderFilters()
    const group = screen.getByTestId('source-type-filter')
    expect(group).toBeInTheDocument()
    // Counts are visible in each button's accessible name.
    expect(screen.getByRole('button', { name: /All \(12\)/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Audio \(8\)/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Images \(3\)/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /PDFs \(1\)/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Notes \(0\)/ })).toBeInTheDocument()
  })

  it('invokes onSourceTypeFilterChange with the chosen type', () => {
    const handlers = renderFilters()
    fireEvent.click(screen.getByRole('button', { name: /Images \(3\)/ }))
    expect(handlers.onSourceTypeFilterChange).toHaveBeenCalledWith('image')
  })

  it('marks the active type via aria-pressed', () => {
    renderFilters({ sourceTypeFilter: 'pdf' })
    expect(screen.getByRole('button', { name: /PDFs \(1\)/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /Audio \(8\)/ })).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('LibraryFilters — list search is scoped, not a global search', () => {
  it('placeholder names the count it filters into', () => {
    renderFilters({ filterableCount: 7 })
    expect(screen.getByPlaceholderText(/Filter 7 captures in this list/i)).toBeInTheDocument()
  })

  it('calls onSearchQueryChange as the user types', () => {
    const handlers = renderFilters()
    fireEvent.change(screen.getByLabelText(/Filter the captures shown in this list/i), {
      target: { value: 'budget' }
    })
    expect(handlers.onSearchQueryChange).toHaveBeenCalledWith('budget')
  })
})

describe('LibraryFilters — honest quality state', () => {
  it('shows the "nothing is rated yet" note when no captures are rated', () => {
    renderFilters({ hasRatedQuality: false })
    fireEvent.click(screen.getByRole('button', { name: /More filters and sorting/i }))
    expect(screen.getByText(/Nothing is rated yet/i)).toBeInTheDocument()
  })

  it('hides the note once captures carry ratings', () => {
    renderFilters({ hasRatedQuality: true })
    fireEvent.click(screen.getByRole('button', { name: /More filters and sorting/i }))
    expect(screen.queryByText(/Nothing is rated yet/i)).not.toBeInTheDocument()
  })
})

// F16/spec-003 Part D
describe('LibraryFilters — quality options include Garbage', () => {
  it('offers a Garbage option in the quality select', () => {
    renderFilters()
    fireEvent.click(screen.getByRole('button', { name: /More filters and sorting/i }))
    expect(screen.getByRole('option', { name: 'Garbage' })).toBeInTheDocument()
  })

  it('is selectable and invokes onQualityFilterChange with "garbage"', () => {
    const handlers = renderFilters()
    fireEvent.click(screen.getByRole('button', { name: /More filters and sorting/i }))
    fireEvent.change(screen.getByLabelText(/Filter by quality rating/i), { target: { value: 'garbage' } })
    expect(handlers.onQualityFilterChange).toHaveBeenCalledWith('garbage')
  })
})
