import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
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
  Bot,
  Loader2,
  AlertCircle,
  Copy,
  ChevronLeft,
  ChevronRight
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
import { toast } from '@/components/ui/toaster'
import type { Actionable, ActionableStatus } from '@/types/knowledge'
import type { OutputTemplateId } from '@/types'

// C-ACT-006: Simple loading skeleton for initial load
function ActionableSkeleton() {
  return (
    <div className="space-y-4">
      {[1, 2, 3].map((i) => (
        <Card key={i} className="overflow-hidden animate-pulse">
          <div className="flex items-stretch min-h-[100px]">
            <div className="w-1.5 bg-muted" />
            <div className="flex-1 p-5 space-y-3">
              <div className="flex items-center gap-2">
                <div className="h-4 w-4 rounded-full bg-muted" />
                <div className="h-3 w-20 bg-muted rounded" />
              </div>
              <div className="h-5 w-3/4 bg-muted rounded" />
              <div className="h-3 w-1/2 bg-muted rounded" />
              <div className="flex gap-2 mt-2">
                <div className="h-5 w-28 bg-muted rounded-full" />
                <div className="h-5 w-24 bg-muted rounded-full" />
              </div>
            </div>
          </div>
        </Card>
      ))}
    </div>
  )
}

// C-ACT-005: Pagination constants
const PAGE_SIZE = 20

export function Actionables() {
  const location = useLocation()
  const navigate = useNavigate()
  const [actionables, setActionables] = useState<Actionable[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<ActionableStatus | 'all'>('pending')

  // C-ACT-005: Pagination state
  const [currentPage, setCurrentPage] = useState(1)

  // Generation state
  const [generating, setGenerating] = useState(false)
  const [currentGeneratingTemplate, setCurrentGeneratingTemplate] = useState<string>('meeting_minutes')
  const [generatedOutput, setGeneratedOutput] = useState<{
    content: string
    templateId: string
    generatedAt: string
    sourceId?: string
  } | null>(null)
  const [generationError, setGenerationError] = useState<string | null>(null)
  const [showOutputModal, setShowOutputModal] = useState(false)
  const [generationHistory, setGenerationHistory] = useState<number[]>([])
  // B-ACT-002: Per-actionable loading state to prevent double-clicks
  const [loadingActionableIds, setLoadingActionableIds] = useState<Set<string>>(new Set())
  // AC-06: Use a ref to hold the latest generationHistory to avoid stale closure in useCallback
  const generationHistoryRef = useRef(generationHistory)
  generationHistoryRef.current = generationHistory

  // C-ACT-004: Client-side output cache to avoid redundant fetches
  // C-ACT-M02: Cache has max size limit to prevent memory leaks in long sessions
  const OUTPUT_CACHE_MAX_SIZE = 50
  const outputCacheRef = useRef<Map<string, { content: string; templateId: string; generatedAt: string; sourceId?: string }>>(new Map())

  // C-ACT-007: Confirmation dialog state for regeneration
  const [confirmRegenerate, setConfirmRegenerate] = useState<Actionable | null>(null)

  // C-ACT-M02: Cache insertion helper with size eviction
  const cacheOutput = useCallback((id: string, output: { content: string; templateId: string; generatedAt: string; sourceId?: string }) => {
    const cache = outputCacheRef.current
    // Evict oldest entries when cache exceeds max size
    if (cache.size >= OUTPUT_CACHE_MAX_SIZE) {
      const firstKey = cache.keys().next().value
      if (firstKey !== undefined) {
        cache.delete(firstKey)
      }
    }
    cache.set(id, output)
  }, [])

  const loadActionables = useCallback(async () => {
    setLoading(true)
    try {
      const data = await window.electronAPI.actionables.getAll()
      setActionables(data)
    } catch (error) {
      console.error('Failed to load actionables:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  // AC-06: Use ref to read generationHistory, avoiding stale closure and unstable deps
  // B-ACT-001: Client-side rate limit aligned with server-side (5/minute)
  // C-ACT-M01: Clean up old timestamps to prevent unbounded growth
  const handleAutoGenerate = useCallback(async (sourceId: string, templateId: string = 'meeting_minutes') => {
    const now = Date.now()
    const recentGenerations = generationHistoryRef.current.filter(t => now - t < 60000)
    if (recentGenerations.length >= 5) {
      toast.warning('Rate limit reached', 'Please wait a minute before generating again.')
      return
    }

    setGenerating(true)
    setCurrentGeneratingTemplate(templateId)
    setGenerationError(null)

    try {
      const result = await window.electronAPI.outputs.generate({
        templateId: templateId as OutputTemplateId,
        knowledgeCaptureId: sourceId
      })

      if (result.success) {
        const output = { ...result.data, sourceId }
        setGeneratedOutput(output)
        setShowOutputModal(true)
        // C-ACT-M01: Only keep timestamps within the rate limit window (prune old ones)
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
  }, [])

  // C-ACT-M05: Show toast feedback for copy to clipboard actions
  const copyToClipboard = async (text?: string) => {
    if (!text) return
    try {
      const result = await window.electronAPI.outputs.copyToClipboard(text)
      if (result.success) {
        toast.success('Copied', 'Content copied to clipboard')
      } else {
        toast.error('Copy failed', result.error.message || 'Failed to copy to clipboard')
      }
    } catch (error: any) {
      toast.error('Copy failed', error?.message || 'Failed to copy to clipboard')
    }
  }

  useEffect(() => {
    loadActionables()
  }, [loadActionables])

  // AC-07: Auto-dismiss error banner after 5 seconds
  useEffect(() => {
    if (!generationError) return
    const timer = setTimeout(() => {
      setGenerationError(null)
    }, 5000)
    return () => clearTimeout(timer)
  }, [generationError])

  // Handle navigation state from Library
  // C-ACT-M04: Clear navigation state after processing to prevent re-triggering on refresh
  useEffect(() => {
    const state = location.state as {
      sourceId?: string
      action?: 'generate'
      templateId?: string
    } | null

    if (state?.sourceId && state?.action === 'generate') {
      handleAutoGenerate(state.sourceId, state.templateId)
      // Clear the navigation state so page refresh doesn't re-trigger generation
      navigate(location.pathname, { replace: true, state: null })
    }
  }, [location.state, handleAutoGenerate, navigate, location.pathname])

  const filteredActionables = useMemo(() => {
    return actionables.filter(a => {
      if (statusFilter !== 'all' && a.status !== statusFilter) return false
      return true
    })
  }, [actionables, statusFilter])

  // C-ACT-005: Paginated subset of filtered actionables
  const totalPages = Math.max(1, Math.ceil(filteredActionables.length / PAGE_SIZE))
  const paginatedActionables = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE
    return filteredActionables.slice(start, start + PAGE_SIZE)
  }, [filteredActionables, currentPage])

  // C-ACT-005: Reset page to 1 when filter changes
  useEffect(() => {
    setCurrentPage(1)
  }, [statusFilter])

  // B-ACT-002: Per-actionable loading state, disable button during operation, server-side revert on failure
  const handleApprove = async (actionable: Actionable) => {
    // Prevent double-clicks
    if (loadingActionableIds.has(actionable.id)) return

    setLoadingActionableIds((prev) => new Set(prev).add(actionable.id))

    try {
      const templateId = actionable.suggestedTemplate || 'meeting_minutes'
      setGenerating(true)
      setCurrentGeneratingTemplate(templateId)
      setGenerationError(null)

      // Call generateOutput handler to update status to in_progress
      const approvalResult = await window.electronAPI.actionables.generateOutput(actionable.id)

      if (!approvalResult.success) {
        toast.error('Approval failed', approvalResult.error || 'Failed to approve actionable')
        return
      }

      // Now trigger actual output generation
      const result = await window.electronAPI.outputs.generate({
        templateId: templateId as OutputTemplateId,
        knowledgeCaptureId: actionable.sourceKnowledgeId,
        actionableId: actionable.id
      })

      if (result.success) {
        const output = { ...result.data, sourceId: actionable.sourceKnowledgeId }
        // C-ACT-004: Cache the generated output
        cacheOutput(actionable.id, output)
        setGeneratedOutput(output)
        setShowOutputModal(true)

        // Update actionable status to generated
        await window.electronAPI.actionables.updateStatus(actionable.id, 'generated')
        await loadActionables()
      } else {
        const errorMsg = result.error?.message || 'Failed to generate output'
        toast.error('Generation failed', errorMsg)
        // Revert status to pending on failure
        await window.electronAPI.actionables.updateStatus(actionable.id, 'pending').catch(() => {})
        await loadActionables()
      }
    } catch (error: any) {
      const errorMsg = error?.message || 'Failed to generate output'
      toast.error('Generation failed', errorMsg)
      console.error('Output generation failed:', error)
      // Revert status to pending on failure
      await window.electronAPI.actionables.updateStatus(actionable.id, 'pending').catch(() => {})
      await loadActionables()
    } finally {
      setGenerating(false)
      setLoadingActionableIds((prev) => {
        const next = new Set(prev)
        next.delete(actionable.id)
        return next
      })
    }
  }

  // B-ACT-003: Use toast instead of generationError for dismiss failures
  const handleDismiss = async (actionableId: string) => {
    try {
      const result = await window.electronAPI.actionables.updateStatus(actionableId, 'dismissed')

      if (result.success) {
        await loadActionables()
      } else {
        console.error('Failed to dismiss actionable:', result.error)
        toast.error('Dismiss failed', result.error || 'Failed to dismiss actionable')
      }
    } catch (error: any) {
      console.error('Error dismissing actionable:', error)
      toast.error('Dismiss failed', error?.message || 'Failed to dismiss actionable')
    }
  }

  // C-ACT-003: Consistent status icon mapping
  const getStatusIcon = (status: ActionableStatus) => {
    switch (status) {
      case 'pending': return <Clock className="h-4 w-4 text-amber-500" />
      case 'in_progress': return <RefreshCw className="h-4 w-4 text-blue-500 animate-spin" />
      case 'generated': return <CheckCircle2 className="h-4 w-4 text-emerald-500" />
      case 'shared': return <Mail className="h-4 w-4 text-violet-500" />
      case 'dismissed': return <X className="h-4 w-4 text-slate-400" />
    }
  }

  // C-ACT-003: Consistent status bar color mapping (all statuses covered)
  const getStatusBarColor = (status: ActionableStatus): string => {
    switch (status) {
      case 'pending': return 'bg-amber-500'
      case 'in_progress': return 'bg-blue-500'
      case 'generated': return 'bg-emerald-500'
      case 'shared': return 'bg-violet-500'
      case 'dismissed': return 'bg-slate-300'
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

        {/* Filter bar - AC-03 FIX: Added 'in_progress' to filter options */}
        <div className="flex items-center gap-2 mt-4 overflow-x-auto pb-2">
          {(['all', 'pending', 'in_progress', 'generated', 'shared', 'dismissed'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={cn(
                "px-4 py-1.5 rounded-full text-xs font-semibold border transition-all whitespace-nowrap capitalize",
                statusFilter === s
                  ? "bg-primary border-primary text-primary-foreground shadow-sm"
                  : "bg-background border-border text-muted-foreground hover:bg-muted"
              )}
            >
              {s === 'in_progress' ? 'In Progress' : s}
            </button>
          ))}
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-4xl mx-auto space-y-6">
          {/* C-ACT-006: Loading skeleton instead of spinner */}
          {loading && actionables.length === 0 ? (
            <ActionableSkeleton />
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
              {paginatedActionables.map((actionable) => (
                <Card key={actionable.id} className="group overflow-hidden hover:border-primary/30 transition-all shadow-sm">
                  <div className="flex items-stretch min-h-[100px]">
                    {/* C-ACT-003: Consistent status bar colors for all statuses */}
                    <div className={cn(
                      "w-1.5 transition-colors",
                      getStatusBarColor(actionable.status)
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
                          {actionable.confidence && actionable.status === 'pending' && (
                            <div className="flex items-center gap-1 text-[10px] font-medium bg-muted/50 px-2 py-0.5 rounded-full">
                              <Sparkles className="h-3 w-3 text-amber-500" />
                              <span className={cn(
                                actionable.confidence >= 0.8 ? "text-emerald-600" :
                                actionable.confidence >= 0.6 ? "text-amber-600" :
                                "text-red-600"
                              )}>
                                {Math.round(actionable.confidence * 100)}% confidence
                              </span>
                            </div>
                          )}
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
                          <>
                            {/* B-ACT-002: Per-actionable spinner, disabled during operation */}
                            <Button
                              onClick={() => handleApprove(actionable)}
                              size="sm"
                              className="flex-1 sm:flex-none gap-2 shadow-sm"
                              disabled={loadingActionableIds.has(actionable.id)}
                            >
                              {loadingActionableIds.has(actionable.id) ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Sparkles className="h-4 w-4" />
                              )}
                              {loadingActionableIds.has(actionable.id) ? 'Generating...' : 'Approve & Generate'}
                            </Button>
                            <Button
                              onClick={() => handleDismiss(actionable.id)}
                              variant="ghost"
                              size="sm"
                              className="flex-1 sm:flex-none gap-2 text-muted-foreground hover:text-destructive"
                              disabled={loadingActionableIds.has(actionable.id)}
                            >
                              <X className="h-4 w-4" />
                              Dismiss
                            </Button>
                          </>
                        )}
                        {/* C-ACT-M06: Show a disabled indicator for in_progress items */}
                        {actionable.status === 'in_progress' && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="flex-1 sm:flex-none gap-2"
                            disabled
                          >
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Processing...
                          </Button>
                        )}
                        {actionable.status === 'generated' && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="flex-1 sm:flex-none gap-2"
                            disabled={loadingActionableIds.has(actionable.id)}
                            onClick={async () => {
                              // B-ACT-004: Fetch existing output instead of re-generating
                              // C-ACT-004: Check client-side cache first
                              if (loadingActionableIds.has(actionable.id)) return

                              // Check cache first
                              const cached = outputCacheRef.current.get(actionable.id)
                              if (cached) {
                                setGeneratedOutput(cached)
                                setShowOutputModal(true)
                                return
                              }

                              setLoadingActionableIds((prev) => new Set(prev).add(actionable.id))

                              try {
                                const result = await window.electronAPI.outputs.getByActionableId(actionable.id)

                                if (result.success && result.data) {
                                  const output = { ...result.data, sourceId: actionable.sourceKnowledgeId }
                                  // C-ACT-004: Cache the fetched output
                                  cacheOutput(actionable.id, output)
                                  setGeneratedOutput(output)
                                  setShowOutputModal(true)
                                } else if (result.success && !result.data) {
                                  // No existing output found -- fall back to regeneration
                                  const templateId = actionable.suggestedTemplate || 'meeting_minutes'
                                  setGenerating(true)
                                  setCurrentGeneratingTemplate(templateId)
                                  const genResult = await window.electronAPI.outputs.generate({
                                    templateId: templateId as OutputTemplateId,
                                    knowledgeCaptureId: actionable.sourceKnowledgeId
                                  })
                                  if (genResult.success) {
                                    const output = { ...genResult.data, sourceId: actionable.sourceKnowledgeId }
                                    cacheOutput(actionable.id, output)
                                    setGeneratedOutput(output)
                                    setShowOutputModal(true)
                                  } else {
                                    toast.error('Failed to load output', genResult.error?.message || 'Unknown error')
                                  }
                                  setGenerating(false)
                                } else {
                                  toast.error('Failed to load output', result.error?.message || 'Unknown error')
                                }
                              } catch (error: any) {
                                toast.error('Failed to load output', error?.message || 'An unexpected error occurred')
                              } finally {
                                setLoadingActionableIds((prev) => {
                                  const next = new Set(prev)
                                  next.delete(actionable.id)
                                  return next
                                })
                              }
                            }}
                          >
                            {loadingActionableIds.has(actionable.id) ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <FileText className="h-4 w-4" />
                            )}
                            View Output
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}

          {/* C-ACT-005: Pagination controls */}
          {filteredActionables.length > PAGE_SIZE && (
            <div className="flex items-center justify-between pt-2">
              <span className="text-xs text-muted-foreground">
                Showing {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filteredActionables.length)} of {filteredActionables.length}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={currentPage <= 1}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-xs px-2">
                  Page {currentPage} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={currentPage >= totalPages}
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
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

      {/* C-ACT-M07: Error banner positioned at bottom to avoid overlapping header/nav */}
      {generationError && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 px-4 py-3 bg-destructive/10 border border-destructive/20 rounded-lg flex items-center justify-between gap-4 max-w-2xl w-full shadow-lg">
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

      {/* Loading Overlay - AC-08 FIX: Dynamic text based on template type */}
      {generating && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="text-center space-y-4 bg-card p-8 rounded-lg shadow-lg border">
            <Loader2 className="h-12 w-12 animate-spin mx-auto text-primary" />
            <div>
              <h3 className="text-lg font-semibold mb-1">
                Generating {
                  currentGeneratingTemplate === 'meeting_minutes' ? 'Meeting Minutes' :
                  currentGeneratingTemplate === 'interview_feedback' ? 'Interview Feedback' :
                  currentGeneratingTemplate === 'project_status' ? 'Project Status' :
                  currentGeneratingTemplate === 'action_items' ? 'Action Items' :
                  'Output'
                }...
              </h3>
              <p className="text-sm text-muted-foreground">This may take a few moments...</p>
            </div>
          </div>
        </div>
      )}

      {/* C-ACT-007: Confirmation dialog before regeneration */}
      <Dialog open={!!confirmRegenerate} onOpenChange={(open) => { if (!open) setConfirmRegenerate(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Regenerate Output?</DialogTitle>
            <DialogDescription>
              This will create a new output using the {confirmRegenerate?.suggestedTemplate || 'meeting_minutes'} template, replacing the previous result.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirmRegenerate(null)}>Cancel</Button>
            <Button onClick={() => {
              if (confirmRegenerate) {
                // Invalidate cache for this actionable
                outputCacheRef.current.delete(confirmRegenerate.id)
                handleApprove(confirmRegenerate)
              }
              setConfirmRegenerate(null)
            }}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Regenerate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Output Modal */}
      <Dialog open={showOutputModal} onOpenChange={setShowOutputModal}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>Generated Output</DialogTitle>
            <DialogDescription>
              Generated using {generatedOutput?.templateId?.replace(/_/g, ' ')} template
              {/* C-ACT-008: Show timestamp on generated output */}
              {generatedOutput?.generatedAt && (
                <span className="ml-2 text-xs text-muted-foreground">
                  &middot; {formatDateTime(generatedOutput.generatedAt)}
                </span>
              )}
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
export default Actionables
