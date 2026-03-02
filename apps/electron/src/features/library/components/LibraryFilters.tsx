import { Filter, Cloud, HardDrive, Check, Search, ArrowUpDown, ChevronUp, ChevronDown } from 'lucide-react'
import { Input } from '@/components/ui/input'
import {
  FilterMode,
  SemanticLocationFilter,
  ExclusiveLocationFilter
} from '@/types/unified-recording'
import type { SortBy, SortOrder } from '@/store/useLibraryStore'

interface LibraryFiltersProps {
  stats: {
    total: number
    deviceOnly: number
    localOnly: number
    both: number
    onSource: number
    locallyAvailable: number
  }
  filterMode: FilterMode
  semanticFilter: SemanticLocationFilter
  exclusiveFilter: ExclusiveLocationFilter
  categoryFilter: string
  qualityFilter: string
  statusFilter: string
  searchQuery: string
  sortBy?: SortBy
  sortOrder?: SortOrder
  onFilterModeChange: (mode: FilterMode) => void
  onSemanticFilterChange: (filter: SemanticLocationFilter) => void
  onExclusiveFilterChange: (filter: ExclusiveLocationFilter) => void
  onCategoryFilterChange: (filter: string) => void
  onQualityFilterChange: (filter: string) => void
  onStatusFilterChange: (filter: string) => void
  onSearchQueryChange: (query: string) => void
  onSortByChange?: (sortBy: SortBy) => void
  onSortOrderChange?: (order: SortOrder) => void
}

const CATEGORIES = ['all', 'meeting', 'interview', '1:1', 'brainstorm', 'note'] as const

export function LibraryFilters({
  stats,
  filterMode,
  semanticFilter,
  exclusiveFilter,
  categoryFilter,
  qualityFilter,
  statusFilter,
  searchQuery,
  sortBy,
  sortOrder,
  onFilterModeChange,
  onSemanticFilterChange,
  onExclusiveFilterChange,
  onCategoryFilterChange,
  onQualityFilterChange,
  onStatusFilterChange,
  onSearchQueryChange,
  onSortByChange,
  onSortOrderChange
}: LibraryFiltersProps) {
  // Determine active filter value based on mode
  const activeFilter = filterMode === 'semantic' ? semanticFilter : exclusiveFilter
  const handleFilterChange =
    filterMode === 'semantic' ? onSemanticFilterChange : onExclusiveFilterChange

  // Count active filters for the badge
  const activeFilterCount = [
    activeFilter !== 'all',
    categoryFilter !== 'all',
    qualityFilter !== 'all',
    statusFilter !== 'all',
    searchQuery.length > 0
  ].filter(Boolean).length

  return (
    <div className="flex flex-col gap-4 mt-4">
      <div className="flex flex-wrap items-center gap-4">
        {/* Active filter count badge */}
        {activeFilterCount > 0 && (
          <span
            className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-primary text-primary-foreground"
            aria-label={`${activeFilterCount} filter${activeFilterCount !== 1 ? 's' : ''} active`}
          >
            {activeFilterCount} active
          </span>
        )}
        {/* Filter mode toggle */}
        <div className="flex items-center gap-2" role="group" aria-label="Filter mode">
          <span className="text-xs font-medium text-muted-foreground">Mode:</span>
          <div className="flex gap-1 p-1 bg-muted rounded-lg">
            <button
              onClick={() => onFilterModeChange('semantic')}
              className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
                filterMode === 'semantic'
                  ? 'bg-background shadow-sm'
                  : 'hover:bg-background/50'
              }`}
              title="Show all files matching the filter (e.g., Device shows all files from any device)"
              aria-pressed={filterMode === 'semantic'}
              aria-label="Show all matching files"
            >
              All Matching
            </button>
            <button
              onClick={() => onFilterModeChange('exclusive')}
              className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
                filterMode === 'exclusive'
                  ? 'bg-background shadow-sm'
                  : 'hover:bg-background/50'
              }`}
              title="Show only files in exact location (e.g., Device Only shows files not downloaded)"
              aria-pressed={filterMode === 'exclusive'}
              aria-label="Show exact location only"
            >
              Exact Only
            </button>
          </div>
        </div>

        {/* Location filter */}
        <div className="flex items-center gap-2" role="group" aria-label="Location filter">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <div className="flex rounded-lg border overflow-hidden" data-testid="location-filter">
            <button
              onClick={() => handleFilterChange('all' as SemanticLocationFilter & ExclusiveLocationFilter)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                activeFilter === 'all'
                  ? 'bg-primary text-primary-foreground'
                  : 'hover:bg-muted'
              }`}
              aria-pressed={activeFilter === 'all'}
              aria-label="All locations"
            >
              All ({stats.total})
            </button>
            {filterMode === 'semantic' ? (
              <>
                <button
                  onClick={() => onSemanticFilterChange('on-source')}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors border-l ${
                    semanticFilter === 'on-source'
                      ? 'bg-primary text-primary-foreground'
                      : 'hover:bg-muted'
                  }`}
                  aria-pressed={semanticFilter === 'on-source'}
                  aria-label="On device"
                >
                  <Cloud className="h-3 w-3 inline mr-1" />
                  Device ({stats.onSource})
                </button>
                <button
                  onClick={() => onSemanticFilterChange('locally-available')}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors border-l ${
                    semanticFilter === 'locally-available'
                      ? 'bg-primary text-primary-foreground'
                      : 'hover:bg-muted'
                  }`}
                  aria-pressed={semanticFilter === 'locally-available'}
                  aria-label="Locally available"
                >
                  <HardDrive className="h-3 w-3 inline mr-1" />
                  Locally Available ({stats.locallyAvailable})
                </button>
                <button
                  onClick={() => onSemanticFilterChange('synced')}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors border-l ${
                    semanticFilter === 'synced'
                      ? 'bg-primary text-primary-foreground'
                      : 'hover:bg-muted'
                  }`}
                  aria-pressed={semanticFilter === 'synced'}
                  aria-label="Synced to both"
                >
                  <Check className="h-3 w-3 inline mr-1" />
                  Synced ({stats.both})
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => onExclusiveFilterChange('source-only')}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors border-l ${
                    exclusiveFilter === 'source-only'
                      ? 'bg-primary text-primary-foreground'
                      : 'hover:bg-muted'
                  }`}
                  aria-pressed={exclusiveFilter === 'source-only'}
                  aria-label="Device only"
                >
                  <Cloud className="h-3 w-3 inline mr-1" />
                  Device Only ({stats.deviceOnly})
                </button>
                <button
                  onClick={() => onExclusiveFilterChange('local-only')}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors border-l ${
                    exclusiveFilter === 'local-only'
                      ? 'bg-primary text-primary-foreground'
                      : 'hover:bg-muted'
                  }`}
                  aria-pressed={exclusiveFilter === 'local-only'}
                  aria-label="Local only"
                >
                  <HardDrive className="h-3 w-3 inline mr-1" />
                  Local Only ({stats.localOnly})
                </button>
                <button
                  onClick={() => onExclusiveFilterChange('synced')}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors border-l ${
                    exclusiveFilter === 'synced'
                      ? 'bg-primary text-primary-foreground'
                      : 'hover:bg-muted'
                  }`}
                  aria-pressed={exclusiveFilter === 'synced'}
                  aria-label="Synced to both"
                >
                  <Check className="h-3 w-3 inline mr-1" />
                  Synced ({stats.both})
                </button>
              </>
            )}
          </div>
        </div>

        {/* Category filter */}
        <div className="flex rounded-lg border overflow-hidden" role="group" aria-label="Category filter">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => onCategoryFilterChange(cat)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                cat !== 'all' ? 'border-l' : ''
              } ${
                categoryFilter === cat
                  ? 'bg-primary text-primary-foreground'
                  : 'hover:bg-muted'
              }`}
              aria-pressed={categoryFilter === cat}
              aria-label={`Filter by ${cat}`}
            >
              {cat.charAt(0).toUpperCase() + cat.slice(1)}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search captures..."
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            className="pl-9 h-8"
            aria-label="Search captures"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        {/* Sort Controls */}
        {onSortByChange && onSortOrderChange && (
          <div className="flex items-center gap-2">
            <ArrowUpDown className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground">Sort:</span>
            <select
              value={sortBy ?? 'date'}
              onChange={(e) => onSortByChange(e.target.value as SortBy)}
              className="h-8 rounded-md border border-input bg-background px-3 py-1 text-xs"
              aria-label="Sort by"
            >
              <option value="date">Date</option>
              <option value="name">Name</option>
              <option value="duration">Duration</option>
              <option value="quality">Quality</option>
            </select>
            <button
              onClick={() => onSortOrderChange(sortOrder === 'asc' ? 'desc' : 'asc')}
              className="h-8 px-2 rounded-md border border-input bg-background text-xs font-medium hover:bg-muted transition-colors inline-flex items-center gap-1"
              aria-label={`Sort ${sortOrder === 'asc' ? 'ascending' : 'descending'}`}
              title={`Currently ${sortOrder === 'asc' ? 'ascending' : 'descending'} - click to toggle`}
            >
              {sortOrder === 'asc' ? (
                <>
                  <ChevronUp className="h-3.5 w-3.5" />
                  Asc
                </>
              ) : (
                <>
                  <ChevronDown className="h-3.5 w-3.5" />
                  Desc
                </>
              )}
            </button>
          </div>
        )}

        {/* Quality Filter */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Quality:</span>
          <select
            value={qualityFilter}
            onChange={(e) => onQualityFilterChange(e.target.value)}
            className="h-8 rounded-md border border-input bg-background px-3 py-1 text-xs"
            aria-label="Filter by quality rating"
          >
            <option value="all">All Ratings</option>
            <option value="valuable">Valuable</option>
            <option value="archived">Archived</option>
            <option value="low-value">Low-Value</option>
            <option value="unrated">Unrated</option>
          </select>
        </div>

        {/* Status Filter */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Status:</span>
          <select
            value={statusFilter}
            onChange={(e) => onStatusFilterChange(e.target.value)}
            className="h-8 rounded-md border border-input bg-background px-3 py-1 text-xs"
            aria-label="Filter by processing status"
          >
            <option value="all">All Statuses</option>
            <option value="processing">Processing</option>
            <option value="ready">Ready</option>
            <option value="enriched">Enriched</option>
          </select>
        </div>
      </div>
    </div>
  )
}
