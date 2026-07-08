import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Users,
  Search,
  RefreshCw,
  Mail,
  Building,
  Briefcase,
  Clock,
  MessageSquare,
  Tag,
  ChevronRight,
  Filter,
  UserPlus,
  Trash2,
  GitMerge,
  ArrowLeftRight,
  Sparkles,
  X
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  IdentitySuggestionsSection,
  type IdentitySuggestionsSectionHandle
} from '@/components/identity/IdentitySuggestionsSection'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import type { Person, PersonType } from '@/types/knowledge'
import { cn } from '@/lib/utils'
import { toast } from '@/components/ui/toaster'

export function People() {
  const navigate = useNavigate()

  const [people, setPeople] = useState<Person[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<PersonType | 'all'>('all')
  const [totalCount, setTotalCount] = useState(0)

  // Pagination state
  const PAGE_SIZE = 30
  const [currentPage, setCurrentPage] = useState(0)

  // Delete confirmation state (replaces confirm())
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)
  const [sortBy, setSortBy] = useState<'name' | 'lastSeen' | 'interactions'>('name')

  // Quick-merge selection mode: pick exactly two contacts, then fold one into the other.
  const [mergeMode, setMergeMode] = useState(false)
  const [selectedForMerge, setSelectedForMerge] = useState<Person[]>([])
  const [keeperId, setKeeperId] = useState<string | null>(null)
  const [merging, setMerging] = useState(false)

  // Discovery sweep: analyze contacts for possible duplicates → new suggestions.
  const [discovering, setDiscovering] = useState(false)
  const suggestionsRef = useRef<IdentitySuggestionsSectionHandle>(null)

  // Debounce: skip firing on initial mount
  const isFirstMount = useRef(true)

  const loadPeople = useCallback(async (page = 0) => {
    setLoading(true)
    try {
      const result = await window.electronAPI.contacts.getAll({
        search: searchQuery,
        type: typeFilter,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE
      })
      if (result.success) {
        // Server returns already-mapped Person objects from contacts-handlers.ts
        const contacts: Person[] = result.data.contacts
        setPeople(contacts)
        setTotalCount(result.data.total)
      }
    } catch (error) {
      console.error('Failed to load people:', error)
      toast.error('Failed to load people', error instanceof Error ? error.message : 'An unexpected error occurred')
    } finally {
      setLoading(false)
    }
  }, [searchQuery, typeFilter])

  // Initial load: fire immediately
  useEffect(() => {
    loadPeople(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Subsequent changes: debounce search/filter and reset to first page
  useEffect(() => {
    if (isFirstMount.current) {
      isFirstMount.current = false
      return
    }
    setCurrentPage(0)
    const timer = setTimeout(() => {
      loadPeople(0)
    }, 300)
    return () => clearTimeout(timer)
  }, [loadPeople])

  // Pagination helpers
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const handlePageChange = useCallback((page: number) => {
    setCurrentPage(page)
    loadPeople(page)
  }, [loadPeople])

  const handleDeleteClick = useCallback((personId: string, personName: string, event: React.MouseEvent) => {
    event.stopPropagation()
    setDeleteTarget({ id: personId, name: personName })
    setDeleteDialogOpen(true)
  }, [])

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTarget) return

    try {
      const result = await window.electronAPI.contacts.delete(deleteTarget.id)
      if (result.success) {
        toast.success('Contact deleted', `${deleteTarget.name} has been removed`)
        await loadPeople(currentPage)
      } else {
        toast.error('Failed to delete contact', (result as any).error?.message || 'Unknown error')
      }
    } catch (error) {
      console.error('Failed to delete contact:', error)
      toast.error('Failed to delete contact', error instanceof Error ? error.message : 'An unexpected error occurred')
    }
    setDeleteDialogOpen(false)
    setDeleteTarget(null)
  }, [deleteTarget, loadPeople, currentPage])

  // --- Quick merge ---

  const toggleMergeMode = useCallback(() => {
    setMergeMode((prev) => {
      if (prev) {
        // Leaving merge mode — clear any pending selection.
        setSelectedForMerge([])
        setKeeperId(null)
      }
      return !prev
    })
  }, [])

  const toggleSelectForMerge = useCallback((person: Person) => {
    setSelectedForMerge((prev) => {
      if (prev.some((p) => p.id === person.id)) {
        return prev.filter((p) => p.id !== person.id)
      }
      if (prev.length >= 2) return prev // cap at exactly two
      return [...prev, person]
    })
  }, [])

  // Default the keeper to the contact with more interactions whenever two are picked.
  useEffect(() => {
    if (selectedForMerge.length === 2) {
      const [a, b] = selectedForMerge
      setKeeperId(a.interactionCount >= b.interactionCount ? a.id : b.id)
    } else {
      setKeeperId(null)
    }
  }, [selectedForMerge])

  const swapKeeper = useCallback(() => {
    setKeeperId((current) => {
      if (selectedForMerge.length !== 2) return current
      const other = selectedForMerge.find((p) => p.id !== current)
      return other ? other.id : current
    })
  }, [selectedForMerge])

  const keeper = selectedForMerge.find((p) => p.id === keeperId) ?? null
  const loser = selectedForMerge.find((p) => p.id !== keeperId) ?? null

  const handleConfirmMerge = useCallback(async () => {
    if (!keeper || !loser) return
    setMerging(true)
    try {
      const result = await window.electronAPI.contacts.merge({ keeperId: keeper.id, loserId: loser.id })
      if (result.success) {
        toast.success('Contacts merged', `${loser.name} was merged into ${keeper.name}.`)
        setMergeMode(false)
        setSelectedForMerge([])
        setKeeperId(null)
        await loadPeople(currentPage)
      } else {
        toast.error('Failed to merge contacts', (result as any).error?.message || 'Unknown error')
      }
    } catch (error) {
      console.error('Failed to merge contacts:', error)
      toast.error('Failed to merge contacts', error instanceof Error ? error.message : 'An unexpected error occurred')
    } finally {
      setMerging(false)
    }
  }, [keeper, loser, loadPeople, currentPage])

  const handleDiscover = useCallback(async () => {
    setDiscovering(true)
    try {
      const result = await window.electronAPI.identity.discoverContacts()
      if (result.success && result.data) {
        const { candidatePairs, suggestionsCreated, autoMergeable } = result.data
        toast.success(
          'Discovery complete',
          `${candidatePairs} candidate pairs analyzed, ${suggestionsCreated} new ${suggestionsCreated === 1 ? 'suggestion' : 'suggestions'}, ${autoMergeable} high-confidence`
        )
        suggestionsRef.current?.reload()
      } else {
        toast.error('Discovery failed', result.error || 'Unknown error')
      }
    } catch (error) {
      console.error('Failed to discover contacts:', error)
      toast.error('Discovery failed', error instanceof Error ? error.message : 'An unexpected error occurred')
    } finally {
      setDiscovering(false)
    }
  }, [])

  const sortedPeople = useMemo(() => {
    const sorted = [...people]
    switch (sortBy) {
      case 'name':
        sorted.sort((a, b) => a.name.localeCompare(b.name))
        break
      case 'lastSeen':
        sorted.sort((a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime())
        break
      case 'interactions':
        sorted.sort((a, b) => b.interactionCount - a.interactionCount)
        break
    }
    return sorted
  }, [people, sortBy])

  /** Safely format a date string, returning fallback for invalid dates */
  const formatDate = (dateStr: string | null | undefined): string => {
    if (!dateStr) return 'Unknown'
    const date = new Date(dateStr)
    if (isNaN(date.getTime())) return 'Unknown'
    return date.toLocaleDateString()
  }

  /** Return "interaction" (singular) or "interactions" (plural) */
  const interactionLabel = (count: number): string => {
    return count === 1 ? '1 interaction' : `${count} interactions`
  }

  const getTypeColor = (type: PersonType) => {
    switch (type) {
      case 'team': return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
      case 'candidate': return 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'
      case 'customer': return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
      case 'external': return 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
      default: return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-400'
    }
  }

  return (
    <div className="relative flex flex-col h-full">
      {/* Header */}
      <header className="border-b px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">People</h1>
            <p className="text-sm text-muted-foreground">Everyone mentioned in your knowledge base</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => loadPeople(currentPage)}>
              <RefreshCw className={cn("h-4 w-4 mr-2", loading && "animate-spin")} />
              Refresh
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleDiscover}
              disabled={discovering}
              title="Analyze contacts for possible duplicates"
            >
              <Sparkles className={cn("h-4 w-4 mr-2", discovering && "animate-pulse")} />
              {discovering ? 'Discovering…' : 'Discover'}
            </Button>
            <Button
              size="sm"
              variant={mergeMode ? 'default' : 'outline'}
              onClick={toggleMergeMode}
              title="Select two people to merge"
              aria-pressed={mergeMode}
            >
              <GitMerge className="h-4 w-4 mr-2" />
              {mergeMode ? 'Cancel merge' : 'Merge'}
            </Button>
            <Button
              size="sm"
              variant="default"
              title="Coming soon"
              onClick={() => toast.info('Coming soon', 'Contact creation is not yet available.')}
            >
              <UserPlus className="h-4 w-4 mr-2" />
              Add Person
            </Button>
          </div>
        </div>

        {/* Filter bar */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 mt-4">
          <div className="relative flex-1 max-w-sm w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search people..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-9"
            />
          </div>

          <div className="flex items-center gap-4 overflow-x-auto pb-2 sm:pb-0 w-full sm:w-auto">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <div className="flex gap-1">
                {(['all', 'team', 'candidate', 'customer', 'external'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTypeFilter(t)}
                    className={cn(
                      "px-3 py-1 rounded-full text-xs font-medium border transition-all whitespace-nowrap",
                      typeFilter === t
                        ? "bg-primary border-primary text-primary-foreground"
                        : "bg-background border-border text-muted-foreground hover:bg-muted"
                    )}
                  >
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2 border-l pl-4">
              <span className="text-xs text-muted-foreground whitespace-nowrap">Sort by</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as 'name' | 'lastSeen' | 'interactions')}
                className="text-xs rounded-md border border-input bg-background px-2 py-1 ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                aria-label="Sort contacts"
              >
                <option value="name">Name</option>
                <option value="lastSeen">Last Seen</option>
                <option value="interactions">Interactions</option>
              </select>
            </div>
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-5xl mx-auto">
          {/* Identity suggestions review queue (self-hides when empty) */}
          {!mergeMode && <IdentitySuggestionsSection ref={suggestionsRef} />}

          {/* Merge-mode instruction banner */}
          {mergeMode && (
            <div className="mb-4 rounded-lg border border-primary/30 bg-primary/[0.04] px-4 py-3 text-sm">
              <span className="font-medium">Merge mode:</span> pick two people to combine into one.
              {' '}
              {selectedForMerge.length === 0
                ? 'Select the first person.'
                : selectedForMerge.length === 1
                ? 'Select one more.'
                : 'Review the direction below, then confirm.'}
            </div>
          )}

          {/* Result count indicator */}
          {!loading && totalCount > 0 && (
            <p className="text-xs text-muted-foreground mb-4">
              Showing {Math.min(currentPage * PAGE_SIZE + 1, totalCount)}–{Math.min((currentPage + 1) * PAGE_SIZE, totalCount)} of {totalCount} {totalCount === 1 ? 'person' : 'people'}
            </p>
          )}
          {loading && people.length === 0 ? (
            <div className="flex items-center justify-center py-20">
              <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : sortedPeople.length === 0 ? (
            <Card>
              <CardContent className="py-16 text-center">
                <Users className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                <h3 className="text-lg font-medium mb-2">No People Found</h3>
                <p className="text-muted-foreground">
                  {searchQuery || typeFilter !== 'all'
                    ? 'Try changing your search or filter settings.'
                    : 'No contacts yet. Contacts are automatically created when recordings are transcribed.'}
                </p>
              </CardContent>
            </Card>
          ) : (
            <div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {sortedPeople.map((person) => {
                const isSelected = selectedForMerge.some((p) => p.id === person.id)
                return (
                <Card
                  key={person.id}
                  className={cn(
                    "group transition-all cursor-pointer overflow-hidden shadow-sm hover:shadow-md",
                    mergeMode ? "hover:border-primary/70" : "hover:border-primary/50",
                    isSelected && "ring-2 ring-primary border-primary"
                  )}
                  onClick={() => (mergeMode ? toggleSelectForMerge(person) : navigate(`/person/${person.id}`))}
                  aria-pressed={mergeMode ? isSelected : undefined}
                >
                  <CardHeader className="pb-3 bg-muted/5 group-hover:bg-muted/10 transition-colors">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "w-10 h-10 rounded-xl flex items-center justify-center text-lg font-bold shadow-sm border",
                          getTypeColor(person.type)
                        )}>
                          {person.name.charAt(0)}
                        </div>
                        <div className="min-w-0">
                          <CardTitle className="text-base truncate">{person.name}</CardTitle>
                          <span className={cn(
                            "inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider mt-1",
                            getTypeColor(person.type)
                          )}>
                            {person.type}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {mergeMode ? (
                          <Checkbox
                            checked={isSelected}
                            tabIndex={-1}
                            aria-label={`Select ${person.name} to merge`}
                            className="pointer-events-none"
                          />
                        ) : (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 hover:bg-destructive/10 hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                              onClick={(e) => handleDeleteClick(person.id, person.name, e)}
                              title="Delete contact"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                            <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                          </>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-4 space-y-3">
                    {person.email && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Mail className="h-3.5 w-3.5" />
                        <span className="truncate">{person.email}</span>
                      </div>
                    )}
                    {person.company && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Building className="h-3.5 w-3.5" />
                        <span className="truncate">{person.company}</span>
                      </div>
                    )}
                    {person.role && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Briefcase className="h-3.5 w-3.5" />
                        <span className="truncate">{person.role}</span>
                      </div>
                    )}

                    <div className="pt-2 flex items-center justify-between border-t border-border/50">
                      <div className="flex items-center gap-1.5 text-xs font-medium">
                        <MessageSquare className="h-3.5 w-3.5 text-primary" />
                        <span>{interactionLabel(person.interactionCount)}</span>
                      </div>
                      <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        <span>{formatDate(person.lastSeenAt)}</span>
                      </div>
                    </div>

                    {(person.tags?.length ?? 0) > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {(person.tags ?? []).slice(0, 3).map(tag => (
                          <div key={tag} className="flex items-center gap-1 text-[10px] bg-secondary px-2 py-0.5 rounded-full">
                            <Tag className="h-2.5 w-2.5" />
                            {tag}
                          </div>
                        ))}
                        {(person.tags?.length ?? 0) > 3 && (
                          <span className="text-[10px] text-muted-foreground">+{(person.tags?.length ?? 0) - 3} more</span>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
                )
              })}
            </div>

            {/* Pagination controls */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 mt-6">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={currentPage === 0 || loading}
                  onClick={() => handlePageChange(currentPage - 1)}
                  aria-label="Previous page"
                >
                  Previous
                </Button>
                <span className="text-sm text-muted-foreground px-2">
                  Page {currentPage + 1} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={currentPage >= totalPages - 1 || loading}
                  onClick={() => handlePageChange(currentPage + 1)}
                  aria-label="Next page"
                >
                  Next
                </Button>
              </div>
            )}
            </div>
          )}
        </div>
      </div>

      {/* Floating merge action bar — appears once exactly two people are selected */}
      {mergeMode && keeper && loser && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 w-[min(640px,calc(100%-2rem))]">
          <div className="flex flex-col sm:flex-row items-center gap-3 rounded-xl border bg-background/95 backdrop-blur shadow-lg px-4 py-3">
            <div className="flex items-center gap-2 text-sm min-w-0 flex-1">
              <GitMerge className="h-4 w-4 text-primary flex-shrink-0" />
              <span className="text-muted-foreground">Keep</span>
              <span className="font-semibold truncate max-w-[120px]" title={keeper.name}>{keeper.name}</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 flex-shrink-0"
                onClick={swapKeeper}
                title="Swap merge direction"
                aria-label="Swap merge direction"
              >
                <ArrowLeftRight className="h-4 w-4" />
              </Button>
              <span className="text-muted-foreground">absorb</span>
              <span className="font-semibold truncate max-w-[120px] line-through decoration-muted-foreground/50" title={loser.name}>
                {loser.name}
              </span>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Button variant="outline" size="sm" onClick={toggleMergeMode} disabled={merging}>
                <X className="h-4 w-4 mr-1" />
                Cancel
              </Button>
              <Button size="sm" onClick={handleConfirmMerge} disabled={merging}>
                {merging ? (
                  <RefreshCw className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <GitMerge className="h-4 w-4 mr-1" />
                )}
                Confirm merge
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation AlertDialog (replaces confirm()) */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Contact</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {deleteTarget?.name}? This will permanently remove this contact and all their meeting associations. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleConfirmDelete}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
export default People
