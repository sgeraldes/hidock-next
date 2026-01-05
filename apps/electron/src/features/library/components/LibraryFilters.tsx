import { Filter, Cloud, HardDrive, Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { LocationFilter } from '@/types/unified-recording'

interface LibraryFiltersProps {
  stats: {
    total: number
    deviceOnly: number
    localOnly: number
  }
  locationFilter: LocationFilter
  categoryFilter: string
  qualityFilter: string
  statusFilter: string
  searchQuery: string
  onLocationFilterChange: (filter: LocationFilter) => void
  onCategoryFilterChange: (filter: string) => void
  onQualityFilterChange: (filter: string) => void
  onStatusFilterChange: (filter: string) => void
  onSearchQueryChange: (query: string) => void
}

const CATEGORIES = ['all', 'meeting', 'interview', '1:1', 'brainstorm', 'note'] as const

export function LibraryFilters({
  stats,
  locationFilter,
  categoryFilter,
  qualityFilter,
  statusFilter,
  searchQuery,
  onLocationFilterChange,
  onCategoryFilterChange,
  onQualityFilterChange,
  onStatusFilterChange,
  onSearchQueryChange
}: LibraryFiltersProps) {
  return (
    <div className="flex flex-col gap-4 mt-4">
      <div className="flex items-center gap-4">
        {/* Location filter */}
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <div className="flex rounded-lg border overflow-hidden" data-testid="location-filter">
            <button
              onClick={() => onLocationFilterChange('all')}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                locationFilter === 'all'
                  ? 'bg-primary text-primary-foreground'
                  : 'hover:bg-muted'
              }`}
            >
              All ({stats.total})
            </button>
            <button
              onClick={() => onLocationFilterChange('device-only')}
              className={`px-3 py-1.5 text-xs font-medium transition-colors border-l ${
                locationFilter === 'device-only'
                  ? 'bg-primary text-primary-foreground'
                  : 'hover:bg-muted'
              }`}
            >
              <Cloud className="h-3 w-3 inline mr-1" />
              Device ({stats.deviceOnly})
            </button>
            <button
              onClick={() => onLocationFilterChange('local-only')}
              className={`px-3 py-1.5 text-xs font-medium transition-colors border-l ${
                locationFilter === 'local-only'
                  ? 'bg-primary text-primary-foreground'
                  : 'hover:bg-muted'
              }`}
            >
              <HardDrive className="h-3 w-3 inline mr-1" />
              Downloaded ({stats.localOnly})
            </button>
          </div>
        </div>

        {/* Category filter */}
        <div className="flex rounded-lg border overflow-hidden">
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
          />
        </div>
      </div>

      <div className="flex items-center gap-4">
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
