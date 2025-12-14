/**
 * FilterBar Component
 *
 * Unified filter bar for meeting list filtering.
 * Supports combined filters: date range + contact + project + status + search.
 */

import { useEffect, useState, useCallback } from 'react'
import { Search, X, Filter, User, Folder, Calendar, Mic } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useFilterStore, useActiveFilters } from '@/store/useFilterStore'
import { useContactsStore } from '@/store/useContactsStore'
import { useProjectsStore } from '@/store/useProjectsStore'
import { cn } from '@/lib/utils'
import type { RecordingStatusFilter } from '@/types/stores'

interface FilterBarProps {
  className?: string
  showSearch?: boolean
  showDateRange?: boolean
  showContact?: boolean
  showProject?: boolean
  showStatus?: boolean
  compact?: boolean
}

export function FilterBar({
  className,
  showSearch = true,
  showDateRange = false,
  showContact = true,
  showProject = true,
  showStatus = true,
  compact = false
}: FilterBarProps) {
  const { contacts, loadContacts } = useContactsStore()
  const { projects, loadProjects } = useProjectsStore()
  const {
    contactId,
    projectId,
    status,
    searchQuery,
    setContactFilter,
    setProjectFilter,
    setStatusFilter,
    setSearchQuery,
    clearFilters
  } = useFilterStore()
  const { hasActiveFilters } = useActiveFilters()

  const [localSearch, setLocalSearch] = useState(searchQuery)

  // Load contacts and projects on mount
  useEffect(() => {
    loadContacts()
    loadProjects()
  }, [loadContacts, loadProjects])

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchQuery(localSearch)
    }, 300)
    return () => clearTimeout(timer)
  }, [localSearch, setSearchQuery])

  // Sync local search with store
  useEffect(() => {
    setLocalSearch(searchQuery)
  }, [searchQuery])

  const handleStatusChange = useCallback((value: string) => {
    setStatusFilter(value === 'all' ? null : value as RecordingStatusFilter)
  }, [setStatusFilter])

  const handleContactChange = useCallback((value: string) => {
    setContactFilter(value === 'all' ? null : value)
  }, [setContactFilter])

  const handleProjectChange = useCallback((value: string) => {
    setProjectFilter(value === 'all' ? null : value)
  }, [setProjectFilter])

  const filterCount = [
    contactId,
    projectId,
    status,
    searchQuery
  ].filter(Boolean).length

  if (compact) {
    return (
      <div className={cn('flex items-center gap-2', className)}>
        {showSearch && (
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search..."
              value={localSearch}
              onChange={(e) => setLocalSearch(e.target.value)}
              className="pl-8 h-8"
            />
          </div>
        )}
        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearFilters}
            className="h-8 px-2"
          >
            <X className="h-4 w-4" />
            Clear
          </Button>
        )}
      </div>
    )
  }

  return (
    <div className={cn('flex flex-wrap items-center gap-3 p-3 border-b bg-card/50', className)}>
      {/* Search */}
      {showSearch && (
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search meetings, transcripts..."
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      )}

      {/* Filter Dropdowns */}
      <div className="flex items-center gap-2">
        {/* Contact Filter */}
        {showContact && (
          <Select value={contactId || 'all'} onValueChange={handleContactChange}>
            <SelectTrigger className="w-[160px]">
              <User className="h-4 w-4 mr-2 text-muted-foreground" />
              <SelectValue placeholder="All contacts" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All contacts</SelectItem>
              {contacts.map((contact) => (
                <SelectItem key={contact.id} value={contact.id}>
                  {contact.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Project Filter */}
        {showProject && (
          <Select value={projectId || 'all'} onValueChange={handleProjectChange}>
            <SelectTrigger className="w-[160px]">
              <Folder className="h-4 w-4 mr-2 text-muted-foreground" />
              <SelectValue placeholder="All projects" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All projects</SelectItem>
              {projects.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Status Filter */}
        {showStatus && (
          <Select value={status || 'all'} onValueChange={handleStatusChange}>
            <SelectTrigger className="w-[140px]">
              <Mic className="h-4 w-4 mr-2 text-muted-foreground" />
              <SelectValue placeholder="Any status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any status</SelectItem>
              <SelectItem value="recorded">Has recording</SelectItem>
              <SelectItem value="transcribed">Transcribed</SelectItem>
            </SelectContent>
          </Select>
        )}

        {/* Clear Filters */}
        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearFilters}
            className="gap-1"
          >
            <X className="h-4 w-4" />
            Clear {filterCount > 1 && `(${filterCount})`}
          </Button>
        )}
      </div>

      {/* Active Filter Badges */}
      {hasActiveFilters && (
        <div className="flex items-center gap-1 ml-auto">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">
            {filterCount} filter{filterCount !== 1 ? 's' : ''} active
          </span>
        </div>
      )}
    </div>
  )
}

/**
 * Compact filter badge showing active filters
 */
export function FilterBadge({ onClick }: { onClick?: () => void }) {
  const { contactId, projectId, status, searchQuery } = useActiveFilters()
  const { contacts } = useContactsStore()
  const { projects } = useProjectsStore()

  const filterCount = [contactId, projectId, status, searchQuery].filter(Boolean).length

  if (filterCount === 0) return null

  const getLabel = () => {
    const parts: string[] = []
    if (contactId) {
      const contact = contacts.find(c => c.id === contactId)
      if (contact) parts.push(contact.name)
    }
    if (projectId) {
      const project = projects.find(p => p.id === projectId)
      if (project) parts.push(project.name)
    }
    if (status) parts.push(status)
    if (searchQuery) parts.push(`"${searchQuery}"`)
    return parts.join(', ')
  }

  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition-colors"
    >
      <Filter className="h-3 w-3" />
      <span className="max-w-[150px] truncate">{getLabel()}</span>
    </button>
  )
}
