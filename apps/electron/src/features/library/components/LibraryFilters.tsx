import {
  Filter, Cloud, HardDrive, Check, Search, ArrowUpDown, ChevronUp, ChevronDown, Info,
  LayoutGrid, AudioLines, Image, FileText, StickyNote, Clock, X
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import {
  FilterMode,
  SemanticLocationFilter,
  ExclusiveLocationFilter
} from '@/types/unified-recording'
import type { SortBy, SortOrder } from '@/store/useLibraryStore'
import type { SourceTypeFilter } from '@/features/library/utils/sourceType'
import { DURATION_PRESET_LABELS, type DurationPreset } from '@/features/library/utils/durationFilter'
import type { LucideIcon } from 'lucide-react'

export interface TypeCounts {
  all: number
  audio: number
  image: number
  pdf: number
  note: number
}

interface LibraryFiltersProps {
  stats: {
    total: number
    deviceOnly: number
    localOnly: number
    both: number
    onSource: number
    locallyAvailable: number
  }
  /** Captures matching every filter EXCEPT the list search — the number the search box filters into. */
  filterableCount: number
  /** Per source-type counts for the segmented control (respecting the current location scope). */
  typeCounts: TypeCounts
  /** Whether ANY capture carries a non-unrated quality — drives the honest Quality control state. */
  hasRatedQuality: boolean
  filterMode: FilterMode
  semanticFilter: SemanticLocationFilter
  exclusiveFilter: ExclusiveLocationFilter
  categoryFilter: string
  qualityFilter: string
  statusFilter: string
  sourceTypeFilter: SourceTypeFilter
  durationPreset: DurationPreset
  searchQuery: string
  sortBy?: SortBy
  sortOrder?: SortOrder
  onFilterModeChange: (mode: FilterMode) => void
  onSemanticFilterChange: (filter: SemanticLocationFilter) => void
  onExclusiveFilterChange: (filter: ExclusiveLocationFilter) => void
  onCategoryFilterChange: (filter: string) => void
  onQualityFilterChange: (filter: string) => void
  onStatusFilterChange: (filter: string) => void
  onSourceTypeFilterChange: (filter: SourceTypeFilter) => void
  onDurationPresetChange: (preset: DurationPreset) => void
  onSearchQueryChange: (query: string) => void
  onSortByChange?: (sortBy: SortBy) => void
  onSortOrderChange?: (order: SortOrder) => void
  onClearFilters: () => void
}

const CATEGORIES = ['all', 'meeting', 'interview', '1:1', 'brainstorm', 'note'] as const

const SOURCE_TYPES: Array<{ value: SourceTypeFilter; label: string; Icon: LucideIcon; countKey: keyof TypeCounts }> = [
  { value: 'all', label: 'All', Icon: LayoutGrid, countKey: 'all' },
  { value: 'audio', label: 'Audio', Icon: AudioLines, countKey: 'audio' },
  { value: 'image', label: 'Images', Icon: Image, countKey: 'image' },
  { value: 'pdf', label: 'PDFs', Icon: FileText, countKey: 'pdf' },
  { value: 'note', label: 'Notes', Icon: StickyNote, countKey: 'note' }
]

const DURATION_PRESETS: DurationPreset[] = ['all', 'under10s', 'under1m', 'under5m', 'over5m']

export function LibraryFilters({
  stats,
  filterableCount,
  typeCounts,
  hasRatedQuality,
  filterMode,
  semanticFilter,
  exclusiveFilter,
  categoryFilter,
  qualityFilter,
  statusFilter,
  sourceTypeFilter,
  durationPreset,
  searchQuery,
  sortBy,
  sortOrder,
  onFilterModeChange,
  onSemanticFilterChange,
  onExclusiveFilterChange,
  onCategoryFilterChange,
  onQualityFilterChange,
  onStatusFilterChange,
  onSourceTypeFilterChange,
  onDurationPresetChange,
  onSearchQueryChange,
  onSortByChange,
  onSortOrderChange,
  onClearFilters
}: LibraryFiltersProps) {
  const activeFilter = filterMode === 'semantic' ? semanticFilter : exclusiveFilter

  // Count advanced (popover) filters that are active — the source-type control and
  // the list search live outside the popover and aren't counted here.
  const advancedActiveCount = [
    activeFilter !== 'all',
    categoryFilter !== 'all',
    qualityFilter !== 'all',
    statusFilter !== 'all',
    durationPreset !== 'all'
  ].filter(Boolean).length

  const anyFilterActive =
    advancedActiveCount > 0 || sourceTypeFilter !== 'all' || searchQuery.length > 0

  return (
    <div className="flex flex-wrap items-center gap-2 sm:gap-3 mt-4">
      {/* Source-type segmented control — the primary, always-visible filter */}
      <div
        className="flex rounded-lg border overflow-hidden"
        role="group"
        aria-label="Filter by source type"
        data-testid="source-type-filter"
      >
        {SOURCE_TYPES.map(({ value, label, Icon, countKey }) => {
          const count = typeCounts[countKey]
          const active = sourceTypeFilter === value
          return (
            <button
              key={value}
              onClick={() => onSourceTypeFilterChange(value)}
              className={`px-2.5 py-1.5 text-xs font-medium transition-colors inline-flex items-center gap-1.5 ${
                value !== 'all' ? 'border-l' : ''
              } ${active ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
              aria-pressed={active}
              aria-label={`${label} (${count})`}
              title={`${label} — ${count}`}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden @md:inline sm:inline">{label}</span>
              <span className={`tabular-nums ${active ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>
                {count}
              </span>
            </button>
          )
        })}
      </div>

      {/* List search — clearly scoped to the current captures (distinct from the
          global top-bar search). Placeholder names the count it filters into. */}
      <div className="relative flex-1 min-w-[12rem] max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <Input
          placeholder={`Filter ${filterableCount} capture${filterableCount === 1 ? '' : 's'} in this list…`}
          value={searchQuery}
          onChange={(e) => onSearchQueryChange(e.target.value)}
          className="pl-9 pr-8 h-8"
          aria-label="Filter the captures shown in this list"
        />
        {searchQuery && (
          <button
            onClick={() => onSearchQueryChange('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Clear list filter"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Advanced filters — everything else, hidden behind a popover by default */}
      <Popover>
        <PopoverTrigger asChild>
          <button
            className="inline-flex items-center gap-1.5 h-8 rounded-md border border-input bg-background px-3 text-xs font-medium hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="More filters and sorting"
          >
            <Filter className="h-3.5 w-3.5" aria-hidden="true" />
            Filters
            {advancedActiveCount > 0 && (
              <span
                className="ml-0.5 inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold tabular-nums"
                aria-label={`${advancedActiveCount} advanced filter${advancedActiveCount === 1 ? '' : 's'} active`}
              >
                {advancedActiveCount}
              </span>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 p-0">
          <div className="flex items-center justify-between px-4 py-2.5 border-b">
            <span className="text-sm font-semibold">Filters &amp; sort</span>
            {anyFilterActive && (
              <button
                onClick={onClearFilters}
                className="text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:underline"
              >
                Clear all
              </button>
            )}
          </div>

          <div className="max-h-[70vh] overflow-y-auto p-4 space-y-4">
            {/* Sort */}
            {onSortByChange && onSortOrderChange && (
              <section className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground/70">
                  <ArrowUpDown className="h-3.5 w-3.5" aria-hidden="true" /> Sort
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={sortBy ?? 'date'}
                    onChange={(e) => onSortByChange(e.target.value as SortBy)}
                    className="h-8 flex-1 rounded-md border border-input bg-background px-3 py-1 text-xs"
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
                    title={`Currently ${sortOrder === 'asc' ? 'ascending' : 'descending'} — click to toggle`}
                  >
                    {sortOrder === 'asc' ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    {sortOrder === 'asc' ? 'Asc' : 'Desc'}
                  </button>
                </div>
              </section>
            )}

            {/* Duration (audio only) */}
            <section className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground/70">
                <Clock className="h-3.5 w-3.5" aria-hidden="true" /> Duration
                <span className="font-normal text-muted-foreground/70">(audio)</span>
              </div>
              <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by duration">
                {DURATION_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    onClick={() => onDurationPresetChange(preset)}
                    className={`px-2 py-1 text-xs font-medium rounded border transition-colors ${
                      durationPreset === preset
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'border-input hover:bg-muted'
                    }`}
                    aria-pressed={durationPreset === preset}
                  >
                    {DURATION_PRESET_LABELS[preset]}
                  </button>
                ))}
              </div>
            </section>

            {/* Quality */}
            <section className="space-y-1.5">
              <div className="text-xs font-semibold text-foreground/70">Quality</div>
              <select
                value={qualityFilter}
                onChange={(e) => onQualityFilterChange(e.target.value)}
                className="h-8 w-full rounded-md border border-input bg-background px-3 py-1 text-xs"
                aria-label="Filter by quality rating"
              >
                <option value="all">All ratings</option>
                <option value="valuable">Valuable</option>
                <option value="archived">Archived</option>
                <option value="low-value">Low-value</option>
                <option value="garbage">Garbage</option>
                <option value="unrated">Unrated</option>
              </select>
              {!hasRatedQuality && (
                <p className="text-[11px] leading-snug text-muted-foreground">
                  Nothing is rated yet — everything is currently “Unrated”.
                </p>
              )}
            </section>

            {/* Status */}
            <section className="space-y-1.5">
              <div className="text-xs font-semibold text-foreground/70">Status</div>
              <select
                value={statusFilter}
                onChange={(e) => onStatusFilterChange(e.target.value)}
                className="h-8 w-full rounded-md border border-input bg-background px-3 py-1 text-xs"
                aria-label="Filter by processing status"
              >
                <option value="all">All statuses</option>
                <option value="processing">Processing</option>
                <option value="ready">Ready</option>
                <option value="enriched">Enriched</option>
              </select>
            </section>

            {/* Category */}
            <section className="space-y-1.5">
              <div className="text-xs font-semibold text-foreground/70">Category</div>
              <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by category">
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => onCategoryFilterChange(cat)}
                    className={`px-2 py-1 text-xs font-medium rounded border transition-colors ${
                      categoryFilter === cat
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'border-input hover:bg-muted'
                    }`}
                    aria-pressed={categoryFilter === cat}
                  >
                    {cat.charAt(0).toUpperCase() + cat.slice(1)}
                  </button>
                ))}
              </div>
            </section>

            {/* Location */}
            <section className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground/70">
                Location
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="h-3 w-3 text-muted-foreground cursor-help" aria-label="What is count-as?" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      <p><strong>Inclusive:</strong> a synced recording is counted under Device, Locally available, and Synced.</p>
                      <p className="mt-1"><strong>Exclusive:</strong> each recording counts once, under its exact state.</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-muted-foreground">Count as</span>
                <div className="flex gap-1 p-0.5 bg-muted rounded-md">
                  <button
                    onClick={() => onFilterModeChange('semantic')}
                    className={`px-2 py-0.5 text-[11px] font-medium rounded transition-colors ${
                      filterMode === 'semantic' ? 'bg-background shadow-sm' : 'hover:bg-background/50'
                    }`}
                    aria-pressed={filterMode === 'semantic'}
                  >
                    Inclusive
                  </button>
                  <button
                    onClick={() => onFilterModeChange('exclusive')}
                    className={`px-2 py-0.5 text-[11px] font-medium rounded transition-colors ${
                      filterMode === 'exclusive' ? 'bg-background shadow-sm' : 'hover:bg-background/50'
                    }`}
                    aria-pressed={filterMode === 'exclusive'}
                  >
                    Exclusive
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap gap-1" role="group" aria-label="Location filter" data-testid="location-filter">
                <LocationButton
                  active={activeFilter === 'all'}
                  onClick={() => (filterMode === 'semantic' ? onSemanticFilterChange('all') : onExclusiveFilterChange('all'))}
                  label={`All (${stats.total})`}
                />
                {filterMode === 'semantic' ? (
                  <>
                    <LocationButton Icon={Cloud} active={semanticFilter === 'on-source'} onClick={() => onSemanticFilterChange('on-source')} label={`Device (${stats.onSource})`} />
                    <LocationButton Icon={HardDrive} active={semanticFilter === 'locally-available'} onClick={() => onSemanticFilterChange('locally-available')} label={`Local (${stats.locallyAvailable})`} />
                    <LocationButton Icon={Check} active={semanticFilter === 'synced'} onClick={() => onSemanticFilterChange('synced')} label={`Synced (${stats.both})`} />
                  </>
                ) : (
                  <>
                    <LocationButton Icon={Cloud} active={exclusiveFilter === 'source-only'} onClick={() => onExclusiveFilterChange('source-only')} label={`Device only (${stats.deviceOnly})`} />
                    <LocationButton Icon={HardDrive} active={exclusiveFilter === 'local-only'} onClick={() => onExclusiveFilterChange('local-only')} label={`Local only (${stats.localOnly})`} />
                    <LocationButton Icon={Check} active={exclusiveFilter === 'synced'} onClick={() => onExclusiveFilterChange('synced')} label={`Synced (${stats.both})`} />
                  </>
                )}
              </div>
            </section>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}

function LocationButton({
  active,
  onClick,
  label,
  Icon
}: {
  active: boolean
  onClick: () => void
  label: string
  Icon?: LucideIcon
}) {
  return (
    <button
      onClick={onClick}
      className={`px-2 py-1 text-xs font-medium rounded border transition-colors inline-flex items-center gap-1 ${
        active ? 'bg-primary text-primary-foreground border-primary' : 'border-input hover:bg-muted'
      }`}
      aria-pressed={active}
    >
      {Icon && <Icon className="h-3 w-3" aria-hidden="true" />}
      {label}
    </button>
  )
}
