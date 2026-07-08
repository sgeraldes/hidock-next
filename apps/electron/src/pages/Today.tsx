import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Sun,
  CalendarDays,
  Sparkles,
  ListTodo,
  Bot,
  FileText,
  ArrowRight,
  RefreshCw,
  Terminal,
  Clock,
  BookOpen,
  Settings as SettingsIcon
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

interface BriefingMeeting {
  id: string
  subject: string
  start_time: string
  end_time: string
  location?: string
  organizer_name?: string
}

interface BriefingRecentItem {
  recordingId: string
  title: string
  filename?: string
  dateRecorded?: string
  summary?: string
  actionItems: string[]
  wordCount?: number
}

interface BriefingActionable {
  id: string
  type: string
  title: string
  description?: string
  suggestedTemplate?: string
  sourceKnowledgeId: string
  confidence?: number
  createdAt?: string
}

interface BriefingData {
  todayMeetings: BriefingMeeting[]
  recentKnowledge: BriefingRecentItem[]
  pendingActionables: BriefingActionable[]
  calendar: { configured: boolean; syncEnabled: boolean; lastSyncAt: string | null }
  stats: { transcribedCount: number; indexedChunks: number; pendingActionables: number }
}

function greeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 19) return 'Good afternoon'
  return 'Good evening'
}

function formatTime(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatDay(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
}

export function Today() {
  const navigate = useNavigate()
  const [data, setData] = useState<BriefingData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await window.electronAPI.briefing.get()
      if (res.success && res.data) {
        setData(res.data as BriefingData)
      } else {
        setError(res.error || 'Failed to load briefing')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load briefing')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const latest = data?.recentKnowledge[0]

  const generateFor = (sourceId: string, templateId: string) => {
    navigate('/actionables', { state: { sourceId, action: 'generate', templateId } })
  }

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-end justify-between">
          <div>
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Sun className="h-4 w-4" />
              {new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
            </div>
            <h1 className="text-3xl font-bold mt-1">{greeting()}, Sebastián</h1>
            {data && (
              <p className="text-sm text-muted-foreground mt-2">
                {data.stats.transcribedCount} meetings in your knowledge base · {data.stats.indexedChunks} memory
                chunks indexed · {data.stats.pendingActionables} pending actions
              </p>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={cn('h-4 w-4 mr-2', loading && 'animate-spin')} />
            Refresh
          </Button>
        </div>

        {error && (
          <Card className="border-destructive/50">
            <CardContent className="py-4 text-sm text-destructive">{error}</CardContent>
          </Card>
        )}

        {/* Today's meetings */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarDays className="h-4 w-4" />
              Today's meetings
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!data?.calendar.configured ? (
              <div className="flex items-center justify-between gap-4 rounded-lg border border-dashed p-4">
                <div className="text-sm text-muted-foreground">
                  Your Outlook calendar isn't connected yet. Add your Outlook ICS URL in Settings and your meetings
                  will appear here, correlate with recordings automatically, and enrich every transcript.
                </div>
                <Button size="sm" onClick={() => navigate('/settings')}>
                  <SettingsIcon className="h-4 w-4 mr-2" />
                  Connect calendar
                </Button>
              </div>
            ) : data.todayMeetings.length === 0 ? (
              <p className="text-sm text-muted-foreground">No meetings scheduled today.</p>
            ) : (
              <div className="space-y-2">
                {data.todayMeetings.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => navigate(`/meeting/${m.id}`)}
                    className="w-full flex items-center gap-3 rounded-lg border p-3 text-left hover:bg-muted/50 transition-colors"
                  >
                    <Clock className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <span className="text-sm font-medium w-24 flex-shrink-0">
                      {formatTime(m.start_time)}–{formatTime(m.end_time)}
                    </span>
                    <span className="text-sm truncate flex-1">{m.subject}</span>
                    {m.organizer_name && (
                      <span className="text-xs text-muted-foreground truncate">{m.organizer_name}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Follow up on your last meeting */}
        {latest && (
          <Card className="border-primary/30 bg-primary/[0.03]">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Sparkles className="h-4 w-4 text-amber-500" />
                Follow up on your last meeting
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <div className="font-semibold">{latest.title}</div>
                <div className="text-xs text-muted-foreground">
                  {formatDay(latest.dateRecorded)} · {latest.wordCount ?? '—'} words
                  {latest.actionItems.length > 0 && ` · ${latest.actionItems.length} action items detected`}
                </div>
                {latest.summary && (
                  <p className="text-sm text-muted-foreground mt-2 line-clamp-2">{latest.summary}</p>
                )}
              </div>
              {latest.actionItems.length > 0 && (
                <ul className="text-sm space-y-1">
                  {latest.actionItems.slice(0, 4).map((a, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="text-muted-foreground">→</span>
                      <span className="line-clamp-1">{a}</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap gap-2 pt-1">
                <Button size="sm" onClick={() => generateFor(latest.recordingId, 'claude_code_prompt')}>
                  <Terminal className="h-4 w-4 mr-2" />
                  Claude Code handoff
                </Button>
                <Button size="sm" variant="outline" onClick={() => generateFor(latest.recordingId, 'meeting_minutes')}>
                  <FileText className="h-4 w-4 mr-2" />
                  Meeting minutes
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => navigate('/assistant', { state: { contextId: latest.recordingId } })}
                >
                  <Bot className="h-4 w-4 mr-2" />
                  Ask the assistant
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => navigate('/library', { state: { selectedId: latest.recordingId } })}
                >
                  Open in Library
                  <ArrowRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Pending actions */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center justify-between text-base">
                <span className="flex items-center gap-2">
                  <ListTodo className="h-4 w-4" />
                  Next actions
                </span>
                <Button variant="ghost" size="sm" onClick={() => navigate('/actionables')}>
                  View all
                  <ArrowRight className="h-4 w-4 ml-1" />
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!data || data.pendingActionables.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nothing pending. New suggestions appear here after each transcription.
                </p>
              ) : (
                <div className="space-y-2">
                  {data.pendingActionables.slice(0, 5).map((a) => (
                    <div key={a.id} className="flex items-center gap-3 rounded-lg border p-3">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{a.title}</div>
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          {a.type.replace(/_/g, ' ')}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-shrink-0"
                        onClick={() => generateFor(a.sourceKnowledgeId, a.suggestedTemplate || 'meeting_minutes')}
                      >
                        <Sparkles className="h-4 w-4 mr-1" />
                        Generate
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recent knowledge */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center justify-between text-base">
                <span className="flex items-center gap-2">
                  <BookOpen className="h-4 w-4" />
                  Recent knowledge
                </span>
                <Button variant="ghost" size="sm" onClick={() => navigate('/library')}>
                  Library
                  <ArrowRight className="h-4 w-4 ml-1" />
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!data || data.recentKnowledge.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Transcribe recordings from your HiDock and they'll show up here.
                </p>
              ) : (
                <div className="space-y-2">
                  {data.recentKnowledge.map((k) => (
                    <button
                      key={k.recordingId}
                      onClick={() => navigate('/library', { state: { selectedId: k.recordingId } })}
                      className="w-full rounded-lg border p-3 text-left hover:bg-muted/50 transition-colors"
                    >
                      <div className="text-sm font-medium truncate">{k.title}</div>
                      <div className="text-xs text-muted-foreground">{formatDay(k.dateRecorded)}</div>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

export default Today
