import { useState, useEffect, useMemo, useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import {
  RefreshCw,
  FileText,
  CheckCircle2,
  Clock,
  Mail,
  X,
  ListTodo,
  Users,
  Sparkles,
  Trash2,
  Bot,
  Loader2,
  AlertCircle,
  Copy
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { cn, formatDateTime } from '@/lib/utils'
import type { Actionable, ActionableStatus } from '@/types/knowledge'

export function Actionables() {
  const location = useLocation()
  const navigate = useNavigate()
  const [actionables, setActionables] = useState<Actionable[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<ActionableStatus | 'all'>('pending')

  // Generation state
  const [generating, setGenerating] = useState(false)
  const [generatedOutput, setGeneratedOutput] = useState<{
    content: string
    templateId: string
    generatedAt: string
    sourceId?: string
  } | null>(null)
  const [generationError, setGenerationError] = useState<string | null>(null)
  const [showOutputModal, setShowOutputModal] = useState(false)
  const [generationHistory, setGenerationHistory] = useState<number[]>([])

  const loadActionables = async () => {
    setLoading(true)
    try {
      const data = await window.electronAPI.actionables.getAll()
      setActionables(data)
    } catch (error) {
      console.error('Failed to load actionables:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleAutoGenerate = useCallback(async (sourceId: string) => {
    // Check rate limiting (max 3/minute)
    const now = Date.now()
    const recentGenerations = generationHistory.filter(t => now - t < 60000)
    if (recentGenerations.length >= 3) {
      setGenerationError('Rate limit reached. Please wait a minute before generating again.')
      return
    }

    setGenerating(true)
    setGenerationError(null)

    try {
      const result = await window.electronAPI.outputs.generate({
        templateId: 'meeting_minutes',
        knowledgeCaptureId: sourceId
      })

      if (result.success) {
        setGeneratedOutput({ ...result.data, sourceId })
        setShowOutputModal(true)
        // Use functional update to avoid stale closure and clean old entries
        setGenerationHistory(prev => [...prev.filter(t => now - t < 60000), now])
      } else {
        setGenerationError(result.error.message || 'Failed to generate output')
      }
    } catch (error: any) {
      setGenerationError(error.message || 'Failed to generate output')
      console.error('Output generation failed:', error)
    } finally {
      setGenerating(false)
    }
  }, [generationHistory])

  const copyToClipboard = async (text?: string) => {
    if (!text) return
    try {
      const result = await window.electronAPI.outputs.copyToClipboard(text)
      if (result.success) {
        console.log('Copied to clipboard')
      } else {
        console.error('Failed to copy:', result.error.message)
      }
    } catch (error) {
      console.error('Failed to copy to clipboard:', error)
    }
  }

  useEffect(() => {
    loadActionables()
  }, [])

  // Handle navigation state from Library
  useEffect(() => {
    const state = location.state as {
      sourceId?: string
      action?: 'generate'
    } | null

    if (state?.sourceId && state?.action === 'generate') {
      handleAutoGenerate(state.sourceId)
    }
  }, [location.state, handleAutoGenerate])

  const filteredActionables = useMemo(() => {
    return actionables.filter(a => {
      if (statusFilter !== 'all' && a.status !== statusFilter) return false
      return true
    })
  }, [actionables, statusFilter])

  const handleGenerate = async (a: Actionable) => {
    try {
      // Trigger generation
      const result = await window.electronAPI.outputs.generate({
        templateId: (a.suggestedTemplate as any) || 'minutes',
        sourceId: a.sourceKnowledgeId,
        title: `Output for ${a.title}`
      } as any)
      console.log('Generation result:', result)

      
      // Reload
      loadActionables()
    } catch (error) {
      console.error('Failed to generate output:', error)
    }
  }

  const getStatusIcon = (status: ActionableStatus) => {
    switch (status) {
      case 'pending': return <Clock className="h-4 w-4 text-amber-500" />
      case 'in_progress': return <RefreshCw className="h-4 w-4 text-blue-500 animate-spin" />
      case 'generated': return <CheckCircle2 className="h-4 w-4 text-emerald-500" />
      case 'shared': return <Mail className="h-4 w-4 text-blue-500" />
      case 'dismissed': return <X className="h-4 w-4 text-slate-400" />
    }
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <header className="border-b px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Actionables</h1>
            <p className="text-sm text-muted-foreground">Proactive suggestions and tasks from your knowledge</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={loadActionables}>
              <RefreshCw className={cn("h-4 w-4 mr-2", loading && "animate-spin")} />
              Refresh
            </Button>
          </div>
        </div>

        {/* Filter bar */}
        <div className="flex items-center gap-2 mt-4 overflow-x-auto pb-2">
          {['all', 'pending', 'generated', 'shared', 'dismissed'].map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s as any)}
              className={cn(
                "px-4 py-1.5 rounded-full text-xs font-semibold border transition-all whitespace-nowrap capitalize",
                statusFilter === s 
                  ? "bg-primary border-primary text-primary-foreground shadow-sm" 
                  : "bg-background border-border text-muted-foreground hover:bg-muted"
              )}
            >
              {s}
            </button>
          ))}
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-4xl mx-auto space-y-6">
          {loading && actionables.length === 0 ? (
            <div className="flex items-center justify-center py-20">
              <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : filteredActionables.length === 0 ? (
            <Card className="border-dashed bg-muted/5">
              <CardContent className="py-16 text-center">
                <ListTodo className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-30" />
                <h3 className="text-lg font-medium mb-2">No {statusFilter} Actionables</h3>
                <p className="text-muted-foreground text-sm max-w-xs mx-auto">
                  Suggestions will appear here as you transcribe meetings and capture knowledge.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {filteredActionables.map((actionable) => (
                <Card key={actionable.id} className="group overflow-hidden hover:border-primary/30 transition-all shadow-sm">
                  <div className="flex items-stretch min-h-[100px]">
                    <div className={cn(
                      "w-1.5 transition-colors",
                      actionable.status === 'pending' ? "bg-amber-500" : 
                      actionable.status === 'generated' ? "bg-emerald-500" : "bg-muted"
                    )} />
                    <div className="flex-1 p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          {getStatusIcon(actionable.status)}
                          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{actionable.type.replace('_', ' ')}</span>
                        </div>
                        <h3 className="text-lg font-bold leading-tight truncate pr-4">{actionable.title}</h3>
                        {actionable.description && (
                          <p className="text-sm text-muted-foreground mt-1 line-clamp-1 italic pr-4">"{actionable.description}"</p>
                        )}
                        <div className="flex items-center gap-3 mt-3">
                          <div className="flex items-center gap-1 text-[10px] text-muted-foreground font-medium bg-muted/50 px-2 py-0.5 rounded-full">
                            <Clock className="h-3 w-3" />
                            <span>{formatDateTime(actionable.createdAt)}</span>
                          </div>
                          {actionable.suggestedRecipients.length > 0 && (
                            <div className="flex items-center gap-1 text-[10px] text-muted-foreground font-medium bg-muted/50 px-2 py-0.5 rounded-full">
                              <Users className="h-3 w-3" />
                              <span>{actionable.suggestedRecipients.length} recipients</span>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0 w-full sm:w-auto border-t sm:border-0 pt-4 sm:pt-0">
                        {actionable.status === 'pending' && (
                          <Button onClick={() => handleGenerate(actionable)} size="sm" className="flex-1 sm:flex-none gap-2 shadow-sm">
                            <Sparkles className="h-4 w-4" />
                            Generate Now
                          </Button>
                        )}
                        {actionable.status === 'generated' && (
                          <Button variant="outline" size="sm" className="flex-1 sm:flex-none gap-2">
                            <FileText className="h-4 w-4" />
                            View Artifact
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-destructive transition-colors">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}

          {/* AI Logic Suggestion Placeholder */}
          <Card className="border-primary/20 bg-primary/5 rounded-2xl overflow-hidden mt-8">
            <CardContent className="p-6">
              <div className="flex items-center gap-2 mb-3">
                <Bot className="h-5 w-5 text-primary" />
                <h3 className="font-bold text-sm uppercase tracking-wider">How suggestions work</h3>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">
                HiDock automatically detects the intent to share information or follow up.
                For example, after a meeting with a candidate, I'll suggest generating **Interview Feedback**.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Error Banner */}
      {generationError && (
        <div className="fixed top-0 left-0 right-0 z-40 px-4 py-3 bg-destructive/10 border-b border-destructive/20 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 flex-1">
            <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0" />
            <span className="text-sm text-destructive font-medium">{generationError}</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setGenerationError(null)}
            className="text-destructive hover:text-destructive"
          >
            Dismiss
          </Button>
        </div>
      )}

      {/* Loading Overlay */}
      {generating && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="text-center space-y-4 bg-card p-8 rounded-lg shadow-lg border">
            <Loader2 className="h-12 w-12 animate-spin mx-auto text-primary" />
            <div>
              <h3 className="text-lg font-semibold mb-1">Generating Meeting Minutes</h3>
              <p className="text-sm text-muted-foreground">This may take a few moments...</p>
            </div>
          </div>
        </div>
      )}

      {/* Output Modal */}
      <Dialog open={showOutputModal} onOpenChange={setShowOutputModal}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>Generated Output</DialogTitle>
            <DialogDescription>
              Generated using {generatedOutput?.templateId} template
            </DialogDescription>
          </DialogHeader>
          <div className="prose prose-sm max-w-none dark:prose-invert bg-muted/30 p-4 rounded-md border">
            <ReactMarkdown>{generatedOutput?.content || ''}</ReactMarkdown>
          </div>
          <DialogFooter className="gap-2">
            {generatedOutput?.sourceId && (
              <Button
                variant="outline"
                onClick={() => navigate('/library', { state: { selectedId: generatedOutput.sourceId } })}
              >
                <FileText className="h-4 w-4 mr-2" />
                View Source
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => copyToClipboard(generatedOutput?.content)}
            >
              <Copy className="h-4 w-4 mr-2" />
              Copy to Clipboard
            </Button>
            <Button onClick={() => setShowOutputModal(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}