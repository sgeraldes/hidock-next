import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { 
  ArrowLeft, 
  Mail, 
  Building, 
  Briefcase, 
  Clock, 
  MessageSquare, 
  Tag, 
  Calendar,
  Edit,
  RefreshCw,
  ExternalLink,
  Bot
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { formatDateTime } from '@/lib/utils'
import type { Person, PersonType } from '@/types/knowledge'
import { cn } from '@/lib/utils'

export function PersonDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [person, setPerson] = useState<Person | null>(null)
  const [meetings, setMeetings] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'timeline' | 'knowledge'>('timeline')

  const loadDetails = async () => {
    if (!id) return
    setLoading(true)
    try {
      const result = await window.electronAPI.contacts.getById(id)
      if (result.success && result.data.contact) {
        const c = result.data.contact as any
        setPerson({
          ...c,
          type: c.type || 'unknown',
          tags: c.tags ? (typeof c.tags === 'string' ? JSON.parse(c.tags) : c.tags) : [],
          firstSeenAt: c.first_seen_at || c.firstSeenAt,
          lastSeenAt: c.last_seen_at || c.lastSeenAt,
          interactionCount: c.meeting_count || c.interactionCount || 0,
          createdAt: c.created_at || c.createdAt || new Date().toISOString()
        })
      }
    } catch (error) {
      console.error('Failed to load person details:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadDetails()
  }, [id])

  const getTypeColor = (type: PersonType) => {
    switch (type) {
      case 'team': return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
      case 'candidate': return 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'
      case 'customer': return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
      case 'external': return 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
      default: return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-400'
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!person) {
    return (
      <div className="flex flex-col h-full items-center justify-center gap-4">
        <p className="text-muted-foreground">Person not found</p>
        <Button onClick={() => navigate('/people')}>Back to People</Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Sticky Header */}
      <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-10">
        <div className="px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate('/people')}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="flex items-center gap-3">
              <div className={cn(
                "w-12 h-12 rounded-2xl flex items-center justify-center text-xl font-bold shadow-sm border",
                getTypeColor(person.type)
              )}>
                {person.name.charAt(0)}
              </div>
              <div>
                <h1 className="text-xl font-bold leading-tight">{person.name}</h1>
                <div className="flex items-center gap-2 mt-1">
                  <span className={cn(
                    "px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider",
                    getTypeColor(person.type)
                  )}>
                    {person.type}
                  </span>
                  {person.company && (
                    <span className="text-xs text-muted-foreground">• {person.company}</span>
                  )}
                </div>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => loadDetails()}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
            <Button size="sm" variant="default">
              <Edit className="h-4 w-4 mr-2" />
              Edit
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 overflow-auto">
        <div className="max-w-5xl mx-auto p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Left Column: Info Card */}
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Information</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {person.email && (
                    <div className="flex items-start gap-3">
                      <Mail className="h-4 w-4 text-muted-foreground mt-0.5" />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-muted-foreground mb-0.5">Email</p>
                        <p className="text-sm font-medium truncate">{person.email}</p>
                      </div>
                    </div>
                  )}
                  {person.role && (
                    <div className="flex items-start gap-3">
                      <Briefcase className="h-4 w-4 text-muted-foreground mt-0.5" />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-muted-foreground mb-0.5">Role</p>
                        <p className="text-sm font-medium truncate">{person.role}</p>
                      </div>
                    </div>
                  )}
                  <div className="flex items-start gap-3">
                    <Clock className="h-4 w-4 text-muted-foreground mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-muted-foreground mb-0.5">Last Interaction</p>
                      <p className="text-sm font-medium">{formatDateTime(person.lastSeenAt)}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 border-t pt-4">
                    <MessageSquare className="h-4 w-4 text-primary mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-muted-foreground mb-0.5">Total Interactions</p>
                      <p className="text-sm font-bold">{person.interactionCount}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {person.tags.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Tags</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-2">
                      {person.tags.map(tag => (
                        <div key={tag} className="flex items-center gap-1.5 text-xs bg-secondary px-3 py-1 rounded-full border border-border/50">
                          <Tag className="h-3 w-3" />
                          {tag}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>

            {/* Right Column: Timeline & Knowledge */}
            <div className="md:col-span-2 space-y-6">
              <div className="w-full">
                <div className="grid w-full grid-cols-2 bg-muted/50 p-1 rounded-lg">
                  <button 
                    onClick={() => setActiveTab('timeline')}
                    className={cn(
                      "flex items-center justify-center gap-2 py-2 px-4 rounded-md text-sm font-medium transition-all",
                      activeTab === 'timeline' ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <Calendar className="h-4 w-4" />
                    Timeline
                  </button>
                  <button 
                    onClick={() => setActiveTab('knowledge')}
                    className={cn(
                      "flex items-center justify-center gap-2 py-2 px-4 rounded-md text-sm font-medium transition-all",
                      activeTab === 'knowledge' ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <Bot className="h-4 w-4" />
                    Knowledge Map
                  </button>
                </div>
                
                {activeTab === 'timeline' && (
                  <div className="mt-6 space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
                    {meetings.length === 0 ? (
                      <div className="text-center py-12 border rounded-xl bg-muted/5">
                        <Calendar className="h-10 w-10 mx-auto text-muted-foreground opacity-20 mb-3" />
                        <p className="text-sm text-muted-foreground">No meetings recorded with this person</p>
                      </div>
                    ) : (
                      meetings.map((meeting) => (
                        <Card key={meeting.id} className="group hover:border-primary/30 transition-all cursor-pointer overflow-hidden shadow-sm" onClick={() => navigate(`/meeting/${meeting.id}`)}>
                          <div className="flex items-stretch h-full">
                            <div className="w-1 bg-muted group-hover:bg-primary transition-colors" />
                            <div className="flex-1 p-4">
                              <div className="flex items-start justify-between">
                                <div>
                                  <h3 className="text-sm font-semibold group-hover:text-primary transition-colors">{meeting.subject}</h3>
                                  <p className="text-xs text-muted-foreground mt-1">
                                    {formatDateTime(meeting.start_time)}
                                  </p>
                                </div>
                                <ExternalLink className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                              </div>
                            </div>
                          </div>
                        </Card>
                      ))
                    )}
                  </div>
                )}

                {activeTab === 'knowledge' && (
                  <div className="mt-6 animate-in fade-in slide-in-from-top-2 duration-300">
                    <Card>
                      <CardContent className="py-12 text-center">
                        <Bot className="h-12 w-12 mx-auto text-primary opacity-20 mb-4" />
                        <h3 className="text-lg font-medium mb-2">Knowledge Map</h3>
                        <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                          AI visualization of topics and discussions related to {person.name} is coming soon.
                        </p>
                      </CardContent>
                    </Card>
                  </div>
                )}
              </div>

              {person.notes && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Notes</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm whitespace-pre-wrap leading-relaxed">{person.notes}</p>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}