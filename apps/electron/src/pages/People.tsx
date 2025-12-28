import { useState, useEffect, useMemo } from 'react'
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
  UserPlus
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { formatDateTime } from '@/lib/utils'
import type { Person, PersonType } from '@/types/knowledge'
import { cn } from '@/lib/utils'

export function People() {
  const navigate = useNavigate()
  const [people, setPeople] = useState<Person[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<PersonType | 'all'>('all')

  const loadPeople = async () => {
    setLoading(true)
    try {
      const result = await window.electronAPI.contacts.getAll({ 
        search: searchQuery,
        limit: 100 
      })
      if (result.success) {
        const mappedPeople = result.data.contacts.map((c: any) => ({
          ...c,
          firstSeenAt: c.first_seen_at || c.firstSeenAt,
          lastSeenAt: c.last_seen_at || c.lastSeenAt,
          interactionCount: c.meeting_count || c.interactionCount || 0
        }))
        setPeople(mappedPeople)
      }
    } catch (error) {
      console.error('Failed to load people:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadPeople()
  }, [searchQuery])

  const filteredPeople = useMemo(() => {
    return people.filter(p => {
      if (typeFilter !== 'all' && p.type !== typeFilter) return false
      return true
    })
  }, [people, typeFilter])

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
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="border-b px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">People</h1>
            <p className="text-sm text-muted-foreground">Everyone mentioned in your knowledge base</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => loadPeople()}>
              <RefreshCw className={cn("h-4 w-4 mr-2", loading && "animate-spin")} />
              Refresh
            </Button>
            <Button size="sm" variant="default" disabled>
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
          
          <div className="flex items-center gap-2 overflow-x-auto pb-2 sm:pb-0 w-full sm:w-auto">
            <Filter className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <div className="flex gap-1">
              {['all', 'team', 'candidate', 'customer', 'external'].map((t) => (
                <button
                  key={t}
                  onClick={() => setTypeFilter(t as any)}
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
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-5xl mx-auto">
          {loading && people.length === 0 ? (
            <div className="flex items-center justify-center py-20">
              <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : filteredPeople.length === 0 ? (
            <Card>
              <CardContent className="py-16 text-center">
                <Users className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                <h3 className="text-lg font-medium mb-2">No People Found</h3>
                <p className="text-muted-foreground">
                  Try changing your search or filter settings.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredPeople.map((person) => (
                <Card 
                  key={person.id} 
                  className="group hover:border-primary/50 transition-all cursor-pointer overflow-hidden shadow-sm hover:shadow-md"
                  onClick={() => navigate(`/person/${person.id}`)}
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
                      <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
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
                        <span>{person.interactionCount} interactions</span>
                      </div>
                      <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        <span>{new Date(person.lastSeenAt).toLocaleDateString()}</span>
                      </div>
                    </div>

                    {person.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {person.tags.slice(0, 3).map(tag => (
                          <div key={tag} className="flex items-center gap-1 text-[10px] bg-secondary px-2 py-0.5 rounded-full">
                            <Tag className="h-2.5 w-2.5" />
                            {tag}
                          </div>
                        ))}
                        {person.tags.length > 3 && (
                          <span className="text-[10px] text-muted-foreground">+{person.tags.length - 3} more</span>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}