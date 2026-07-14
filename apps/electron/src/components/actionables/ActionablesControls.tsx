/**
 * Toolbar for the Actionables list: sort, group, and filter (by type / date),
 * plus a "select all" checkbox for bulk actions. Purely presentational — all
 * state lives in the page and is passed in via props.
 */

import { ArrowDownWideNarrow, ArrowUpNarrowWide } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import {
  SORT_OPTIONS,
  GROUP_OPTIONS,
  DATE_FILTER_OPTIONS,
  type ActionableSortKey,
  type ActionableGroupKey,
  type DateFilterKey,
  type SortDirection
} from './actionablesFilters'

export interface ActionablesControlsProps {
  sortKey: ActionableSortKey
  onSortKeyChange: (v: ActionableSortKey) => void
  sortDir: SortDirection
  onToggleSortDir: () => void
  groupKey: ActionableGroupKey
  onGroupKeyChange: (v: ActionableGroupKey) => void
  typeFilter: string
  onTypeFilterChange: (v: string) => void
  typeOptions: { value: string; label: string }[]
  dateFilter: DateFilterKey
  onDateFilterChange: (v: DateFilterKey) => void
  allSelected: boolean
  onToggleSelectAll: () => void
  visibleCount: number
}

export function ActionablesControls({
  sortKey,
  onSortKeyChange,
  sortDir,
  onToggleSortDir,
  groupKey,
  onGroupKeyChange,
  typeFilter,
  onTypeFilterChange,
  typeOptions,
  dateFilter,
  onDateFilterChange,
  allSelected,
  onToggleSelectAll,
  visibleCount
}: ActionablesControlsProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 mb-4">
      {/* Select-all for bulk actions */}
      <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground cursor-pointer select-none">
        <Checkbox
          checked={allSelected}
          onCheckedChange={onToggleSelectAll}
          aria-label={allSelected ? 'Clear selection' : 'Select all visible actionables'}
          disabled={visibleCount === 0}
        />
        Select all
      </label>

      <div className="h-5 w-px bg-border" aria-hidden />

      {/* Sort */}
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">Sort</span>
        <Select value={sortKey} onValueChange={(v) => onSortKeyChange(v as ActionableSortKey)}>
          <SelectTrigger className="h-8 w-[140px]" aria-label="Sort actionables by">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          className="h-8 px-2"
          onClick={onToggleSortDir}
          aria-label={sortDir === 'asc' ? 'Sort ascending (click for descending)' : 'Sort descending (click for ascending)'}
          title={sortDir === 'asc' ? 'Ascending' : 'Descending'}
        >
          {sortDir === 'asc' ? <ArrowUpNarrowWide className="h-4 w-4" /> : <ArrowDownWideNarrow className="h-4 w-4" />}
        </Button>
      </div>

      {/* Group */}
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">Group</span>
        <Select value={groupKey} onValueChange={(v) => onGroupKeyChange(v as ActionableGroupKey)}>
          <SelectTrigger className="h-8 w-[140px]" aria-label="Group actionables by">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {GROUP_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Type filter */}
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">Type</span>
        <Select value={typeFilter} onValueChange={onTypeFilterChange}>
          <SelectTrigger className="h-8 w-[150px]" aria-label="Filter by type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {typeOptions.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Date filter */}
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">Date</span>
        <Select value={dateFilter} onValueChange={(v) => onDateFilterChange(v as DateFilterKey)}>
          <SelectTrigger className="h-8 w-[140px]" aria-label="Filter by date">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DATE_FILTER_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
