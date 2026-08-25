import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LibraryFilters, type TypeCounts } from '../LibraryFilters'
import { BUILTIN_ARTIFACT_TYPES, type LibraryArtifactTypeDescriptor } from '../../utils/sourceType'

const typeCounts: TypeCounts = { all: 13, audio: 8, image: 3, pdf: 1, note: 0, diagram: 1 }
const artifactTypes: LibraryArtifactTypeDescriptor[] = [
  ...BUILTIN_ARTIFACT_TYPES,
  { id: 'diagram', label: 'Diagram', pluralLabel: 'Diagrams', extensions: ['drawio'], capabilities: ['rateable', 'previewable'] }
]

function renderFilters(overrides: Partial<React.ComponentProps<typeof LibraryFilters>> = {}) {
  const handlers = {
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
      stats={{ total: 13, deviceOnly: 2, localOnly: 7, both: 4 }}
      filterableCount={13}
      typeCounts={typeCounts}
      artifactTypes={artifactTypes}
      hasRatedQuality={false}
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

describe('LibraryFilters — registry-driven artifact types', () => {
  it('renders populated built-ins and an add-on without bloating the strip with empty types', () => {
    renderFilters()
    expect(screen.getByRole('button', { name: /All \(13\)/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Audio \(8\)/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Images \(3\)/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /PDFs \(1\)/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Notes \(0\)/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Diagrams \(1\)/ })).toBeInTheDocument()
  })

  it('invokes the type handler and clears audio-only state before selecting Images', () => {
    const handlers = renderFilters({ sourceTypeFilter: 'audio', durationPreset: 'under1m', categoryFilter: 'meeting' })
    fireEvent.click(screen.getByRole('button', { name: /Images \(3\)/ }))
    expect(handlers.onDurationPresetChange).toHaveBeenCalledWith('all')
    expect(handlers.onCategoryFilterChange).toHaveBeenCalledWith('all')
    expect(handlers.onSourceTypeFilterChange).toHaveBeenCalledWith('image')
  })
})

describe('LibraryFilters — capability-specific controls', () => {
  it('shows Duration and conversation controls for Audio', () => {
    renderFilters({ sourceTypeFilter: 'audio' })
    fireEvent.click(screen.getByRole('button', { name: /More filters and sorting/i }))
    expect(screen.getAllByText('Duration')).toHaveLength(2)
    expect(screen.getByText('Conversation type')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Duration' })).toBeInTheDocument()
  })

  it('does not show audio-only or unrated controls for Images', () => {
    renderFilters({ sourceTypeFilter: 'image' })
    fireEvent.click(screen.getByRole('button', { name: /More filters and sorting/i }))
    expect(screen.queryByText('Duration')).not.toBeInTheDocument()
    expect(screen.queryByText('Conversation type')).not.toBeInTheDocument()
    expect(screen.queryByText('Quality')).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Duration' })).not.toBeInTheDocument()
  })

  it('uses exact availability language without accounting jargon', () => {
    renderFilters()
    fireEvent.click(screen.getByRole('button', { name: /More filters and sorting/i }))
    expect(screen.getByRole('button', { name: /On device only \(2\)/ })).toBeInTheDocument()
    expect(screen.queryByText('Inclusive')).not.toBeInTheDocument()
    expect(screen.queryByText('Exclusive')).not.toBeInTheDocument()
  })

  it('does not duplicate the header device-only control as an active-filter chip', () => {
    renderFilters({ exclusiveFilter: 'source-only' })
    expect(screen.queryByRole('button', { name: 'Remove On device only filter' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /More filters and sorting/i })).toHaveTextContent('1')
  })

  it('keeps other active availability filters individually removable', () => {
    const handlers = renderFilters({ exclusiveFilter: 'local-only' })
    fireEvent.click(screen.getByRole('button', { name: 'Remove Local only filter' }))
    expect(handlers.onExclusiveFilterChange).toHaveBeenCalledWith('all')
  })
})

describe('LibraryFilters — list search and quality', () => {
  it('names the post-facet count in the search placeholder', () => {
    renderFilters({ filterableCount: 7 })
    expect(screen.getByPlaceholderText(/Search 7 sources/i)).toBeInTheDocument()
  })

  it('shows quality only when actual ratings make it useful', () => {
    renderFilters({ sourceTypeFilter: 'image', hasRatedQuality: true })
    fireEvent.click(screen.getByRole('button', { name: /More filters and sorting/i }))
    expect(screen.getByRole('option', { name: 'Garbage' })).toBeInTheDocument()
  })
})
