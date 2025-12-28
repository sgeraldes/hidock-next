import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { 
  Search, 
  RefreshCw, 
  FileText, 
  Users, 
  Folder, 
  MessageSquare, 
  Bot, 
  ChevronRight,
  TrendingUp,
  Sparkles,
  Zap,
  Clock,
  ExternalLink
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatDateTime } from '@/lib/utils'
import { cn } from '@/lib/utils'

interface SearchResults {
  knowledge: any[]
  people: any[]
  projects: any[]
}

export function Explore() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResults | null>(null)
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<'all' | 'knowledge' | 'people' | 'projects'>('all')

  const handleSearch = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!query.trim()) return

    setLoading(true)
    try {
      const res = await window.electronAPI.rag.globalSearch({ query, limit: 10 })
      if (res.success) {
        setResults(res.data)
      }
    } catch (error) {
      console.error('Search failed:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      if (query.trim()) handleSearch()
    }, 500)
    return () => clearTimeout(timer)
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

          <form onSubmit={handleSearch} className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <Input
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
          
          {!results && !loading && (
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
                  <Button variant="ghost" size="sm" className="w-full justify-between hover:bg-blue-500/10 h-10 px-3">
                    <span className="text-sm">Summarize recent activity</span>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="sm" className="w-full justify-between hover:bg-blue-500/10 h-10 px-3">
                    <span className="text-sm">Find unresolved tasks</span>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </CardContent>
              </Card>
            </div>
          )}

          {results && (
            <div className="space-y-6">
              <div className="flex items-center justify-between border-b pb-4">
                <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">
                  Search Results ({totalResults})
                </h2>
                <div className="flex bg-muted p-1 rounded-lg gap-1">
                  {['all', 'knowledge', 'people', 'projects'].map((t) => (
                    <button
                      key={t}
                      onClick={() => setActiveTab(t as any)}
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
                {(activeTab === 'all' || activeTab === 'knowledge') && results.knowledge.length > 0 && (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <FileText className="h-4 w-4" />
                      <h3 className="text-sm font-bold uppercase tracking-wider">Knowledge ({results.knowledge.length})</h3>
                    </div>
                    <div className="grid grid-cols-1 gap-3">
                      {results.knowledge.map(k => (
                        <Card key={k.id} className="group hover:border-primary/30 cursor-pointer transition-all shadow-sm" onClick={() => navigate(`/library`)}>
                          <CardContent className="p-4 flex items-center justify-between gap-4">
                            <div className="min-w-0 flex-1">
                              <h4 className="font-semibold text-sm group-hover:text-primary transition-colors truncate">{k.title}</h4>
                              <p className="text-xs text-muted-foreground line-clamp-1 mt-1">{k.summary || "No summary available"}</p>
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
                  </div>
                )}

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
                              <h4 className="font-semibold text-sm group-hover:text-blue-600 transition-colors truncate">{p.name}</h4>
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
                      {results.projects.map(pr => (
                        <Card key={pr.id} className="group hover:border-emerald-500/30 cursor-pointer transition-all shadow-sm" onClick={() => navigate(`/projects`)}>
                          <CardContent className="p-4 flex items-center justify-between gap-4">
                            <div className="flex items-center gap-3 min-w-0 flex-1">
                              <div className="w-9 h-9 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-600 border border-emerald-500/20">
                                <Folder className="h-5 w-5" />
                              </div>
                              <div className="min-w-0">
                                <h4 className="font-semibold text-sm group-hover:text-emerald-600 transition-colors truncate">{pr.name}</h4>
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

                {totalResults === 0 && !loading && (
                  <div className="text-center py-20 border-2 border-dashed rounded-3xl opacity-30">
                    <Search className="h-12 w-12 mx-auto mb-4" />
                    <p className="text-sm">No results found for "{query}"</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}