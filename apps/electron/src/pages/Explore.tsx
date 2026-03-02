import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Search,
  RefreshCw,
  FileText,
  Users,
  Folder,
  ChevronRight,
  TrendingUp,
  Zap,
  Clock,
  AlertCircle,
  ChevronLeft
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatDateTime, cn } from '@/lib/utils'
import { toast } from '@/components/ui/toaster'
import { highlightMatch } from '@/utils/highlight'

// C-EXP-005: Loading skeleton for search results
function SearchResultSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="flex items-center justify-between border-b pb-4">
        <div className="h-4 w-40 bg-muted rounded" />
        <div className="flex gap-1">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-7 w-16 bg-muted rounded-md" />
          ))}
        </div>
      </div>
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <div className="h-4 w-4 bg-muted rounded" />
          <div className="h-4 w-24 bg-muted rounded" />
        </div>
        {[1, 2, 3].map((i) => (
          <Card key={i} className="overflow-hidden">
            <CardContent className="p-4 flex items-center justify-between gap-4">
              <div className="flex-1 space-y-2">
                <div className="h-4 w-3/4 bg-muted rounded" />
                <div className="h-3 w-1/2 bg-muted rounded" />
                <div className="h-3 w-28 bg-muted rounded" />
              </div>
              <div className="h-8 w-8 bg-muted rounded-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

// C-EXP-003: Pagination constants
const SEARCH_PAGE_SIZE = 20

export function Explore() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'all' | 'knowledge' | 'people' | 'projects'>('all')

  // C-EXP-004: Ref for autofocus on the search input
  const searchInputRef = useRef<HTMLInputElement>(null)

  // C-EXP-002: Search performance timing
  const [searchDurationMs, setSearchDurationMs] = useState<number | null>(null)

  // C-EXP-003: Pagination state
  const [resultPage, setResultPage] = useState(1)

  // B-EXP-005: AbortController ref for cancelling pending requests on unmount
  const abortControllerRef = useRef<AbortController | null>(null)
  // B-EXP-005: Cancelled ref for unmount detection (AbortController may not be supported by IPC)
  const cancelledRef = useRef(false)

  // B-EXP-004: Wrap handleSearch in useCallback with proper deps
  const handleSearch = useCallback(async () => {
    if (!query.trim()) return

    // B-EXP-005: Cancel any pending request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    const controller = new AbortController()
    abortControllerRef.current = controller

    setLoading(true)
    setSearchError(null)
    setSearchDurationMs(null)
    // C-EXP-003: Reset pagination on new search
    setResultPage(1)
    // C-EXP-002: Start timing
    const searchStart = performance.now()
    try {
      const result = await window.electronAPI.rag.globalSearch(query, 10)

      // B-EXP-005: Check if component unmounted or request was superseded
      if (controller.signal.aborted || cancelledRef.current) return

      // C-EXP-002: Record search duration
      const elapsed = Math.round(performance.now() - searchStart)
      setSearchDurationMs(elapsed)

      // Unwrap Result<> wrapper
      if (result.success) {
        setResults(result.data)
      } else {
        // Handle error from Result wrapper
        const errorMsg = result.error.message || 'Search failed'
        setSearchError(errorMsg)
        toast.error('Search failed', errorMsg)
        setResults({ knowledge: [], people: [], projects: [] })
      }
    } catch (error) {
      // B-EXP-005: Don't update state if cancelled
      if (controller.signal.aborted || cancelledRef.current) return

      console.error('Search failed:', error)
      const message = error instanceof Error ? error.message : 'An unexpected error occurred'
      setSearchError(message)
      toast.error('Search failed', message)
      setResults({ knowledge: [], people: [], projects: [] })
    } finally {
      if (!controller.signal.aborted && !cancelledRef.current) {
        setLoading(false)
      }
    }
  }, [query])

  useEffect(() => {
    // C-EXP-M04: Clear stale results when query is empty
    if (!query.trim()) {
      setResults(null)
      setSearchDurationMs(null)
    }
    // Debounce search by 300ms
    const timer = setTimeout(() => {
      if (query.trim()) handleSearch()
    }, 300)
    return () => clearTimeout(timer)
  }, [query, handleSearch])

  // B-EXP-005: Cancel pending requests on unmount
  useEffect(() => {
    cancelledRef.current = false
    return () => {
      cancelledRef.current = true
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
    }
  }, [])

  // C-EXP-004: Focus search input on mount
  useEffect(() => {
    // Small delay to ensure DOM is ready after route transition
    const timer = setTimeout(() => {
      searchInputRef.current?.focus()
    }, 100)
    return () => clearTimeout(timer)
  }, [])

  // C-EXP-M03: Reset pagination when active tab changes
  useEffect(() => {
    setResultPage(1)
  }, [activeTab])

  // C-EXP-M01: Clear search error when query changes so stale errors don't persist
  useEffect(() => {
    if (searchError) {
      setSearchError(null)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  const totalResults = results
    ? results.knowledge.length + results.people.length + results.projects.length
    : 0

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <header className="border-b px-6 py-8 bg-muted/5">
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="space-y-2">
            <h1 className="text-3xl font-bold tracking-tight">Explore Knowledge</h1>
            <p className="text-muted-foreground">Search, discover, and connect your knowledge across all captures, people, and projects.</p>
          </div>

          <form onSubmit={(e) => { e.preventDefault(); handleSearch(); }} className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            {/* C-EXP-004: Search input with ref for autofocus */}
            <Input
              ref={searchInputRef}
              placeholder="Search anything... (e.g. 'Amazon Connect', 'Mario', 'API decisions')"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-12 py-7 text-lg rounded-2xl shadow-lg border-border bg-background focus-visible:ring-primary/20"
            />
            {loading && (
              <div className="absolute right-4 top-1/2 -translate-y-1/2">
                <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}
          </form>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        <div className="max-w-5xl mx-auto p-6 space-y-8">
          
          {searchError && (
            <div className="flex items-center gap-3 p-4 rounded-xl border border-destructive/50 bg-destructive/5 text-sm">
              <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0" />
              <div>
                <p className="font-semibold text-destructive">Search failed</p>
                <p className="text-muted-foreground mt-0.5">{searchError}</p>
              </div>
            </div>
          )}

          {!results && !loading && !searchError && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4">
              <Card className="border-primary/20 bg-primary/5 rounded-2xl">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider">
                    <TrendingUp className="h-4 w-4 text-primary" />
                    Recurring Topics
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm text-muted-foreground">Topics frequently mentioned in your recent meetings.</p>
                  <div className="flex flex-wrap gap-2">
                    {['Amazon Connect', 'API Design', 'Migration', 'Q1 Planning', 'Security'].map(t => (
                      <button key={t} onClick={() => setQuery(t)} className="px-3 py-1 bg-background border rounded-full text-xs hover:border-primary transition-colors">{t}</button>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card className="border-blue-500/20 bg-blue-500/5 rounded-2xl">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider">
                    <Zap className="h-4 w-4 text-blue-500" />
                    Quick Actions
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full justify-between hover:bg-blue-500/10 h-10 px-3"
                    onClick={() => { setQuery('summarize recent recordings'); }}
                  >
                    <span className="text-sm">Summarize recent activity</span>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full justify-between hover:bg-blue-500/10 h-10 px-3"
                    onClick={() => { setQuery('find unresolved tasks and action items'); }}
                  >
                    <span className="text-sm">Find unresolved tasks</span>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </CardContent>
              </Card>
            </div>
          )}

          {/* C-EXP-005: Loading skeleton during search */}
          {loading && !results && (
            <SearchResultSkeleton />
          )}

          {results && (
            <div className="space-y-6">
              <div className="flex items-center justify-between border-b pb-4">
                <div className="flex items-center gap-3">
                  <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">
                    Search Results ({totalResults})
                  </h2>
                  {/* C-EXP-002: Search performance metrics */}
                  {searchDurationMs !== null && (
                    <span className="text-[10px] text-muted-foreground font-mono bg-muted/50 px-2 py-0.5 rounded-full">
                      {searchDurationMs}ms
                    </span>
                  )}
                </div>
                <div className="flex bg-muted p-1 rounded-lg gap-1">
                  {(['all', 'knowledge', 'people', 'projects'] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setActiveTab(t)}
                      className={cn(
                        "px-3 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all",
                        activeTab === t ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-8">
                {/* Knowledge Section */}
                {(activeTab === 'all' || activeTab === 'knowledge') && results.knowledge.length > 0 && (() => {
                  // C-EXP-003: Paginate knowledge results
                  const knowledgeStart = (resultPage - 1) * SEARCH_PAGE_SIZE
                  const paginatedKnowledge = results.knowledge.slice(knowledgeStart, knowledgeStart + SEARCH_PAGE_SIZE)
                  const knowledgeTotalPages = Math.ceil(results.knowledge.length / SEARCH_PAGE_SIZE)
                  return (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <FileText className="h-4 w-4" />
                      <h3 className="text-sm font-bold uppercase tracking-wider">Knowledge ({results.knowledge.length})</h3>
                    </div>
                    <div className="grid grid-cols-1 gap-3">
                      {/* B-EXP-002: Navigate to /library with selectedId in navigation state */}
                      {paginatedKnowledge.map(k => (
                        <Card key={k.id} className="group hover:border-primary/30 cursor-pointer transition-all shadow-sm" onClick={() => navigate('/library', { state: { selectedId: k.id } })}>
                          <CardContent className="p-4 flex items-center justify-between gap-4">
                            <div className="min-w-0 flex-1">
                              {/* B-EXP-001: Highlight matching terms (highlightMatch HTML-escapes input to prevent XSS) */}
                              <h4
                                className="font-semibold text-sm group-hover:text-primary transition-colors truncate [&_mark]:bg-yellow-200 dark:[&_mark]:bg-yellow-800 [&_mark]:rounded-sm [&_mark]:px-0.5"
                                dangerouslySetInnerHTML={{ __html: highlightMatch(k.title || '', query) }}
                              />
                              <p
                                className="text-xs text-muted-foreground line-clamp-1 mt-1 [&_mark]:bg-yellow-200 dark:[&_mark]:bg-yellow-800 [&_mark]:rounded-sm [&_mark]:px-0.5"
                                dangerouslySetInnerHTML={{ __html: highlightMatch(k.summary || 'No summary available', query) }}
                              />
                              <div className="flex items-center gap-2 mt-2">
                                <Clock className="h-3 w-3 text-muted-foreground" />
                                <span className="text-[10px] text-muted-foreground">{formatDateTime(k.capturedAt)}</span>
                              </div>
                            </div>
                            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
                              <ChevronRight className="h-4 w-4" />
                            </Button>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                    {/* C-EXP-003: Knowledge pagination controls */}
                    {knowledgeTotalPages > 1 && (
                      <div className="flex items-center justify-end gap-1 pt-1">
                        <Button variant="outline" size="sm" disabled={resultPage <= 1} onClick={() => setResultPage(p => Math.max(1, p - 1))}>
                          <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <span className="text-xs px-2">Page {resultPage} of {knowledgeTotalPages}</span>
                        <Button variant="outline" size="sm" disabled={resultPage >= knowledgeTotalPages} onClick={() => setResultPage(p => Math.min(knowledgeTotalPages, p + 1))}>
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </div>
                  )
                })()}

                {/* People Section */}
                {(activeTab === 'all' || activeTab === 'people') && results.people.length > 0 && (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Users className="h-4 w-4" />
                      <h3 className="text-sm font-bold uppercase tracking-wider">People ({results.people.length})</h3>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                      {results.people.map(p => (
                        <Card key={p.id} className="group hover:border-blue-500/30 cursor-pointer transition-all shadow-sm overflow-hidden" onClick={() => navigate(`/person/${p.id}`)}>
                          <CardContent className="p-4 flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center font-bold text-blue-600 border border-blue-500/20">
                              {p.name.charAt(0)}
                            </div>
                            <div className="min-w-0 flex-1">
                              {/* B-EXP-001: Highlight matching terms in people names */}
                              <h4
                                className="font-semibold text-sm group-hover:text-blue-600 transition-colors truncate [&_mark]:bg-yellow-200 dark:[&_mark]:bg-yellow-800 [&_mark]:rounded-sm [&_mark]:px-0.5"
                                dangerouslySetInnerHTML={{ __html: highlightMatch(p.name || '', query) }}
                              />
                              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mt-0.5">{p.type}</p>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>
                )}

                {/* Projects Section */}
                {(activeTab === 'all' || activeTab === 'projects') && results.projects.length > 0 && (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Folder className="h-4 w-4" />
                      <h3 className="text-sm font-bold uppercase tracking-wider">Projects ({results.projects.length})</h3>
                    </div>
                    <div className="grid grid-cols-1 gap-3">
                      {/* B-EXP-002: Navigate to /projects with selectedId in navigation state */}
                      {results.projects.map(pr => (
                        <Card key={pr.id} className="group hover:border-emerald-500/30 cursor-pointer transition-all shadow-sm" onClick={() => navigate('/projects', { state: { selectedId: pr.id } })}>
                          <CardContent className="p-4 flex items-center justify-between gap-4">
                            <div className="flex items-center gap-3 min-w-0 flex-1">
                              <div className="w-9 h-9 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-600 border border-emerald-500/20">
                                <Folder className="h-5 w-5" />
                              </div>
                              <div className="min-w-0">
                                {/* B-EXP-001: Highlight matching terms in project names */}
                                <h4
                                  className="font-semibold text-sm group-hover:text-emerald-600 transition-colors truncate [&_mark]:bg-yellow-200 dark:[&_mark]:bg-yellow-800 [&_mark]:rounded-sm [&_mark]:px-0.5"
                                  dangerouslySetInnerHTML={{ __html: highlightMatch(pr.name || '', query) }}
                                />
                                <span className="text-[10px] text-muted-foreground uppercase tracking-widest">{pr.status}</span>
                              </div>
                            </div>
                            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
                              <ChevronRight className="h-4 w-4" />
                            </Button>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>
                )}

                {/* C-EXP-M05: Show empty state per-tab when the active tab has no results */}
                {totalResults === 0 && !loading && (
                  <div className="text-center py-20 border-2 border-dashed rounded-3xl opacity-30">
                    <Search className="h-12 w-12 mx-auto mb-4" />
                    <p className="text-sm">No results found for "{query}"</p>
                  </div>
                )}
                {totalResults > 0 && !loading && activeTab !== 'all' && (() => {
                  const tabHasResults =
                    (activeTab === 'knowledge' && results.knowledge.length > 0) ||
                    (activeTab === 'people' && results.people.length > 0) ||
                    (activeTab === 'projects' && results.projects.length > 0)
                  if (!tabHasResults) {
                    return (
                      <div className="text-center py-12 border-2 border-dashed rounded-3xl opacity-30">
                        <Search className="h-10 w-10 mx-auto mb-3" />
                        <p className="text-sm">No {activeTab} results for "{query}"</p>
                        <p className="text-xs text-muted-foreground mt-1">Try the "all" tab to see results in other categories.</p>
                      </div>
                    )
                  }
                  return null
                })()}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
export default Explore
