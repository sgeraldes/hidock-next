/**
 * Stats bar with clickable filter chips for recording location
 */

import { memo } from 'react'
import { Cloud, HardDrive, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

type LocationFilter = 'all' | 'device-only' | 'local-only' | 'both'
type SortOption = 'date-desc' | 'date-asc' | 'name-asc' | 'name-desc' | 'size-desc'

interface RecordingStats {
  total: number
  deviceOnly: number
  localOnly: number
  both: number
}

interface CalendarStatsBarProps {
  stats: RecordingStats
  locationFilter: LocationFilter
  sortBy: SortOption
  showListView: boolean
  deviceConnected: boolean
  onLocationFilterChange: (filter: LocationFilter) => void
  onSortChange: (sort: SortOption) => void
}

export const CalendarStatsBar = memo(function CalendarStatsBar({
  stats,
  locationFilter,
  sortBy,
  showListView,
  deviceConnected,
  onLocationFilterChange,
  onSortChange,
}: CalendarStatsBarProps) {
  return (
    <div className="flex items-center gap-2 px-6 py-2 bg-muted/30 text-xs border-b flex-shrink-0">
      {/* All recordings chip */}
      <button
        onClick={() => onLocationFilterChange('all')}
        className={cn(
          'flex items-center gap-1 px-2 py-1 rounded-full transition-colors',
          locationFilter === 'all'
            ? 'bg-primary text-primary-foreground'
            : 'hover:bg-muted text-muted-foreground'
        )}
      >
        {stats.total} recording{stats.total !== 1 ? 's' : ''}
      </button>

      {/* Device-only chip */}
      {stats.deviceOnly > 0 && (
        <button
          onClick={() => onLocationFilterChange(locationFilter === 'device-only' ? 'all' : 'device-only')}
          className={cn(
            'flex items-center gap-1 px-2 py-1 rounded-full transition-colors',
            locationFilter === 'device-only'
              ? 'bg-orange-500 text-white'
              : 'hover:bg-orange-100 dark:hover:bg-orange-900/30 text-orange-600'
          )}
        >
          <Cloud className="h-3 w-3" />
          {stats.deviceOnly} on device
        </button>
      )}

      {/* Downloaded chip */}
      {stats.localOnly > 0 && (
        <button
          onClick={() => onLocationFilterChange(locationFilter === 'local-only' ? 'all' : 'local-only')}
          className={cn(
            'flex items-center gap-1 px-2 py-1 rounded-full transition-colors',
            locationFilter === 'local-only'
              ? 'bg-blue-500 text-white'
              : 'hover:bg-blue-100 dark:hover:bg-blue-900/30 text-blue-600'
          )}
        >
          <HardDrive className="h-3 w-3" />
          {stats.localOnly} downloaded
        </button>
      )}

      {/* Synced chip */}
      {stats.both > 0 && (
        <button
          onClick={() => onLocationFilterChange(locationFilter === 'both' ? 'all' : 'both')}
          className={cn(
            'flex items-center gap-1 px-2 py-1 rounded-full transition-colors',
            locationFilter === 'both'
              ? 'bg-green-500 text-white'
              : 'hover:bg-green-100 dark:hover:bg-green-900/30 text-green-600'
          )}
        >
          <Check className="h-3 w-3" />
          {stats.both} synced
        </button>
      )}

      {!deviceConnected && (
        <span className="text-muted-foreground ml-2">(device not connected)</span>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Sort dropdown - only in list view */}
      {showListView && (
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Sort:</span>
          <select
            value={sortBy}
            onChange={(e) => onSortChange(e.target.value as SortOption)}
            className="bg-transparent border rounded px-2 py-1 text-xs"
          >
            <option value="date-desc">Newest first</option>
            <option value="date-asc">Oldest first</option>
            <option value="name-asc">Name A-Z</option>
            <option value="name-desc">Name Z-A</option>
            <option value="size-desc">Largest first</option>
          </select>
        </div>
      )}
    </div>
  )
})

// Export types for use in parent components
export type { LocationFilter, SortOption, RecordingStats }
