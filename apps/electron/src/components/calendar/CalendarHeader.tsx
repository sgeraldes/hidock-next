/**
 * Calendar header with navigation, sync controls, and view toggles
 */

import { memo } from 'react'
import { ChevronLeft, ChevronRight, RefreshCw, Calendar as CalendarIcon, List } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import type { CalendarViewType } from '@/lib/calendar-utils'

interface CalendarHeaderProps {
  title: string
  showListView: boolean
  calendarView: CalendarViewType
  calendarSyncing: boolean
  lastSync: string | null
  autoSyncEnabled: boolean
  hideEmptyMeetings: boolean
  formatLastSync: () => string
  onNavigatePrev: () => void
  onNavigateNext: () => void
  onGoToToday: () => void
  onSync: () => Promise<void>
  onAutoSyncToggle: (enabled: boolean) => void
  onHideEmptyToggle: (enabled: boolean) => void
  onViewToggle: (showList: boolean) => void
  onCalendarViewChange: (view: CalendarViewType) => void
}

export const CalendarHeader = memo(function CalendarHeader({
  title,
  showListView,
  calendarView,
  calendarSyncing,
  lastSync,
  autoSyncEnabled,
  hideEmptyMeetings,
  formatLastSync,
  onNavigatePrev,
  onNavigateNext,
  onGoToToday,
  onSync,
  onAutoSyncToggle,
  onHideEmptyToggle,
  onViewToggle,
  onCalendarViewChange,
}: CalendarHeaderProps) {
  return (
    <header className="flex items-center justify-between border-b px-6 py-4 flex-shrink-0">
      <div className="flex items-center gap-4">
        <h1 className="text-2xl font-bold">{title}</h1>
        {/* Date navigation - only show in calendar view */}
        {!showListView && (
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" onClick={onNavigatePrev}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={onGoToToday}>
              Today
            </Button>
            <Button variant="outline" size="icon" onClick={onNavigateNext}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      <div className="flex items-center gap-4">
        {/* Sync status */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {calendarSyncing ? (
            <span className="flex items-center gap-1">
              <RefreshCw className="h-3 w-3 animate-spin" />
              Syncing...
            </span>
          ) : (
            <>
              {lastSync && <span>Synced {formatLastSync()}</span>}
              <Button
                variant="ghost"
                size="sm"
                onClick={onSync}
                title="Clear cache and resync calendar"
                className="h-6 px-2"
              >
                <RefreshCw className="h-3 w-3" />
              </Button>
            </>
          )}
          <Switch
            id="auto-sync-header"
            checked={autoSyncEnabled}
            onCheckedChange={onAutoSyncToggle}
            className="scale-75"
          />
          <Label htmlFor="auto-sync-header" className="text-xs cursor-pointer">
            Auto
          </Label>
        </div>

        {/* Hide empty meetings toggle */}
        <div className="flex items-center gap-2 text-xs">
          <Switch
            id="hide-empty"
            checked={hideEmptyMeetings}
            onCheckedChange={onHideEmptyToggle}
            className="scale-75"
          />
          <Label htmlFor="hide-empty" className="text-muted-foreground cursor-pointer">
            Hide empty
          </Label>
        </div>

        {/* Calendar/List toggle */}
        <div className="flex items-center border rounded-md overflow-hidden">
          <Button
            variant={!showListView ? 'default' : 'ghost'}
            size="sm"
            onClick={() => onViewToggle(false)}
            className="rounded-none border-0 px-2"
            title="Calendar view"
          >
            <CalendarIcon className="h-4 w-4" />
          </Button>
          <Button
            variant={showListView ? 'default' : 'ghost'}
            size="sm"
            onClick={() => onViewToggle(true)}
            className="rounded-none border-0 border-l px-2"
            title="List view"
          >
            <List className="h-4 w-4" />
          </Button>
        </div>

        {/* View mode buttons (only for calendar view) */}
        {!showListView && (
          <div className="flex items-center border rounded-md overflow-hidden">
            <Button
              variant={calendarView === 'day' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => onCalendarViewChange('day')}
              className="rounded-none border-0"
            >
              Day
            </Button>
            <Button
              variant={calendarView === 'workweek' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => onCalendarViewChange('workweek')}
              className="rounded-none border-0 border-l"
            >
              Work
            </Button>
            <Button
              variant={calendarView === 'week' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => onCalendarViewChange('week')}
              className="rounded-none border-0 border-l"
            >
              Week
            </Button>
            <Button
              variant={calendarView === 'month' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => onCalendarViewChange('month')}
              className="rounded-none border-0 border-l"
            >
              Month
            </Button>
          </div>
        )}
      </div>
    </header>
  )
})
