import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
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
  ChevronRight,
  ChevronDown,
  Terminal
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
import { cn } from '@/lib/utils'
import { formatSmartDate, formatRelativeDate } from '@/lib/smartDate'
import { pageContent } from '@/lib/pageLayout'
import { toast } from '@/components/ui/toaster'
import { Checkbox } from '@/components/ui/checkbox'
import { EntityMention, useContactResolver } from '@/components/entity'
import { ActionableDetail } from '@/components/actionables/ActionableDetail'
import { getTemplateInfo, humanizeActionableType } from '@/components/actionables/templateInfo'
import { ActionablesControls } from '@/components/actionables/ActionablesControls'
import { BulkActionBar } from '@/components/actionables/BulkActionBar'
import {
  sortActionables,
  groupActionables,
  filterByType,
  filterByDate,
  distinctTypes,
  type ActionableSortKey,
  type ActionableGroupKey,
  type DateFilterKey,
  type SortDirection
} from '@/components/actionables/actionablesFilters'
import { useActionablesStore, useActionablesCounts } from '@/store/features/useActionablesStore'
import type { Actionable, ActionableStatus } from '@/types/knowledge'
import type { OutputTemplateId } from '@/types'

// C-ACT-006: Simple loading skeleton for initial load. Mirrors the real card's
// no-stripe treatment (elevation + hairline border), so the transition to loaded
// content doesn't shift the layout.
function ActionableSkeleton() {
  return (
    <div className="space-y-4">
      {[1, 2, 3].map((i) => (
        <Card key={i} className="overflow-hidden animate-pulse shadow-sm">
          <div className="min-h-[100px] p-5 space-y-3">
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
  const { resolveRecipient } = useContactResolver()
  // Shared store is the single source of truth so the sidebar nav badge and this
  // page stay in sync and counts are always exact (no "99+" cap).
  const actionables = useActionablesStore((s) => s.actionables)
  const loading = useActionablesStore((s) => s.loading)
  const loadActionables = useActionablesStore((s) => s.loadActionables)
  const counts = useActionablesCounts()
  const [statusFilter, setStatusFilter] = useState<ActionableStatus | 'all'>('pending')

  // Sort / group / filter controls
  const [sortKey, setSortKey] = useState<ActionableSortKey>('date')
  const [sortDir, setSortDir] = useState<SortDirection>('desc')
  const [groupKey, setGroupKey] = useState<ActionableGroupKey>('none')
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [dateFilter, setDateFilter] = useState<DateFilterKey>('all')

  // Bulk selection (transient — a Set of actionable ids)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)

  // C-ACT-005: Pagination state
  const [currentPage, setCurrentPage] = useState(1)

  // Card detail expansion — clicking a card's title area toggles an inline
  // detail panel (evidence at the decision point). Only one open at a time.
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const toggleExpanded = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id))
  }, [])

  // Generation state
  const [generating, setGenerating] = useState(false)
  const [currentGeneratingTemplate, setCurrentGeneratingTemplate] = useState<string>('meeting_minutes')
  const [generatedOutput, setGeneratedOutput] = useState<{
    content: string
    templateId: string
    generatedAt: string
    sourceId?: string
    savedPath?: string
    actionableId?: string
  } | null>(null)
  // Tracks whether an "Open in Claude Code" launch is in flight (disables the CTA)
  const [launchingClaude, setLaunchingClaude] = useState(false)
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
  const outputCacheRef = useRef<Map<string, { content: string; templateId: string; generatedAt: string; sourceId?: string; savedPath?: string; actionableId?: string }>>(new Map())

  // C-ACT-007: Confirmation dialog state for regeneration
  const [confirmRegenerate, setConfirmRegenerate] = useState<Actionable | null>(null)

  // Cancellable generation: each run gets a nonce; Cancel bumps the nonce so
  // in-flight results are discarded when the IPC eventually resolves.
  const generationNonceRef = useRef(0)
  const cancelGeneration = useCallback((actionableId?: string) => {
    generationNonceRef.current++
    setGenerating(false)
    if (actionableId) {
      setLoadingActionableIds((prev) => {
        const next = new Set(prev)
        next.delete(actionableId)
        return next
      })
      // Revert the server-side in_progress status
      window.electronAPI.actionables.updateStatus(actionableId, 'pending').catch(() => {})
    }
    toast.info('Generation cancelled', 'The output will be discarded when it finishes.')
  }, [])
  const [cancellableActionableId, setCancellableActionableId] = useState<string | undefined>(undefined)

  // C-ACT-M02: Cache insertion helper with size eviction
  const cacheOutput = useCallback((id: string, output: { content: string; templateId: string; generatedAt: string; sourceId?: string; savedPath?: string; actionableId?: string }) => {
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
    setCancellableActionableId(undefined)
    const nonce = generationNonceRef.current

    try {
      const result = await window.electronAPI.outputs.generate({
        templateId: templateId as OutputTemplateId,
        knowledgeCaptureId: sourceId
      })
      if (nonce !== generationNonceRef.current) return // cancelled — discard

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
      if (nonce !== generationNonceRef.current) return
      setGenerationError(error.message || 'Failed to generate output')
      console.error('Output generation failed:', error)
    } finally {
      if (nonce === generationNonceRef.current) setGenerating(false)
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

  // "Open in Claude Code" — launches a Claude Code terminal session pointed at
  // the handoff prompt. The main process resolves the working directory (source
  // project folder → configured handoff folder); if none is known it replies
  // needsFolder and we prompt the user to pick one, then retry with it.
  const openInClaudeCode = async () => {
    const output = generatedOutput
    if (!output?.content) return
    setLaunchingClaude(true)
    try {
      const attempt = (cwd?: string) =>
        window.electronAPI.outputs.launchClaudeCode({
          filePath: output.savedPath,
          content: output.content,
          templateId: output.templateId,
          actionableId: output.actionableId,
          cwd
        })

      let res = await attempt()

      // No working directory known — ask the user to choose one, then retry.
      if (res.success && res.data?.needsFolder) {
        const pick = await window.electronAPI.storage.selectFolder?.()
        if (!pick?.success || !pick.data) {
          toast.info('Cancelled', 'Pick a folder to open Claude Code in.')
          return
        }
        res = await attempt(pick.data)
      }

      if (res.success && res.data?.launched) {
        toast.success('Opening Claude Code', res.data.cwd ? `Launched in ${res.data.cwd}` : 'Terminal opened.')
      } else if (!res.success) {
        toast.error('Could not open Claude Code', res.error?.message || 'Unknown error')
      }
    } catch (error: any) {
      toast.error('Could not open Claude Code', error?.message || 'An unexpected error occurred')
    } finally {
      setLaunchingClaude(false)
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

  // Distinct actionable types present, for the Type filter dropdown.
  const typeOptions = useMemo(() => distinctTypes(actionables), [actionables])

  // Filter: status (tabs) + type + date window.
  const filteredActionables = useMemo(() => {
    let list = actionables.filter((a) => statusFilter === 'all' || a.status === statusFilter)
    list = filterByType(list, typeFilter)
    list = filterByDate(list, dateFilter)
    return list
  }, [actionables, statusFilter, typeFilter, dateFilter])

  // Sort by date / confidence / type in the chosen direction.
  const sortedActionables = useMemo(
    () => sortActionables(filteredActionables, sortKey, sortDir),
    [filteredActionables, sortKey, sortDir]
  )

  // Pagination applies only when NOT grouping (grouping renders every bucket).
  const grouped = groupKey !== 'none'
  const totalPages = Math.max(1, Math.ceil(sortedActionables.length / PAGE_SIZE))
  const paginatedActionables = useMemo(() => {
    if (grouped) return sortedActionables
    const start = (currentPage - 1) * PAGE_SIZE
    return sortedActionables.slice(start, start + PAGE_SIZE)
  }, [sortedActionables, currentPage, grouped])

  // The groups actually rendered (a single unlabelled group when grouping is off).
  const renderGroups = useMemo(
    () => groupActionables(paginatedActionables, groupKey),
    [paginatedActionables, groupKey]
  )

  // C-ACT-005: Reset page when any filter/sort/group input changes.
  useEffect(() => {
    setCurrentPage(1)
  }, [statusFilter, typeFilter, dateFilter, sortKey, sortDir, groupKey])

  // ---- Bulk selection (operates over the full filtered/sorted set) ----
  const visibleIds = useMemo(() => sortedActionables.map((a) => a.id), [sortedActionables])
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id))

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleSelectAll = useCallback(() => {
    setSelectedIds(() => {
      const everyOn = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id))
      return everyOn ? new Set<string>() : new Set(visibleIds)
    })
  }, [visibleIds, selectedIds])

  const clearSelection = useCallback(() => setSelectedIds(new Set()), [])

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
      setCancellableActionableId(actionable.id)
      const nonce = generationNonceRef.current

      // Call generateOutput handler to update status to in_progress
      const approvalResult = await window.electronAPI.actionables.generateOutput(actionable.id)
      if (nonce !== generationNonceRef.current) return // cancelled — discard

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
      if (nonce !== generationNonceRef.current) return // cancelled — discard

      if (result.success) {
        const output = { ...result.data, sourceId: actionable.sourceKnowledgeId, actionableId: actionable.id }
        // C-ACT-004: Cache the generated output
        cacheOutput(actionable.id, output)
        setGeneratedOutput(output)
        setShowOutputModal(true)

        // Update actionable status to generated (idempotent on the main side —
        // outputs:generate already moves it to 'generated' when actionableId is set)
        await window.electronAPI.actionables.updateStatus(actionable.id, 'generated')
        await loadActionables()

        // Post-generation feedback: confirm completion with the saved filename
        // and a one-click way to open it. The item now leaves the Pending list.
        const savedPath = output.savedPath
        const filename = savedPath ? savedPath.replace(/^.*[\\/]/, '') : undefined
        toast.success(
          'Output generated',
          filename ? `Saved as ${filename}` : 'The document is ready.',
          savedPath
            ? {
                action: {
                  label: 'Open file',
                  onClick: () => {
                    window.electronAPI.outputs.openInFolder(savedPath).then((res) => {
                      if (!res.success) {
                        toast.error('Open failed', res.error?.message || 'Could not open the file')
                      }
                    })
                  }
                }
              }
            : undefined
        )
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

  // ---- Bulk actions over the current selection ----
  const handleBulkDismiss = async () => {
    const targets = actionables.filter((a) => selectedIds.has(a.id) && a.status !== 'dismissed')
    if (targets.length === 0) {
      toast.info('Nothing to dismiss', 'The selected items are already dismissed.')
      return
    }
    setBulkBusy(true)
    let ok = 0
    let failed = 0
    try {
      for (const a of targets) {
        try {
          const res = await window.electronAPI.actionables.updateStatus(a.id, 'dismissed')
          if (res.success) ok++
          else failed++
        } catch {
          failed++
        }
      }
      await loadActionables()
      clearSelection()
      if (failed === 0) toast.success('Dismissed', `${ok} actionable${ok === 1 ? '' : 's'} dismissed.`)
      else toast.warning('Partially dismissed', `${ok} dismissed, ${failed} failed.`)
    } finally {
      setBulkBusy(false)
    }
  }

  const handleBulkGenerate = async () => {
    const targets = actionables.filter((a) => selectedIds.has(a.id) && a.status === 'pending')
    if (targets.length === 0) {
      toast.info('Nothing to generate', 'Select one or more pending actionables to generate.')
      return
    }
    setBulkBusy(true)
    let ok = 0
    let failed = 0
    try {
      for (const a of targets) {
        try {
          const templateId = (a.suggestedTemplate || 'meeting_minutes') as OutputTemplateId
          const result = await window.electronAPI.outputs.generate({
            templateId,
            knowledgeCaptureId: a.sourceKnowledgeId,
            actionableId: a.id
          })
          if (result.success) {
            await window.electronAPI.actionables.updateStatus(a.id, 'generated').catch(() => {})
            ok++
          } else {
            failed++
            await window.electronAPI.actionables.updateStatus(a.id, 'pending').catch(() => {})
          }
        } catch {
          failed++
          await window.electronAPI.actionables.updateStatus(a.id, 'pending').catch(() => {})
        }
      }
      await loadActionables()
      clearSelection()
      if (failed === 0) toast.success('Outputs generated', `${ok} output${ok === 1 ? '' : 's'} generated.`)
      else toast.warning('Partially generated', `${ok} generated, ${failed} failed.`)
    } finally {
      setBulkBusy(false)
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

  // Status semantics carried by a WHOLE-CARD wash instead of a side-stripe
  // (thick colored left borders are banned in this design language). The tint is
  // intentionally faint (~4%) so it reads as status context, not an alarm — the
  // colored status icon does the loud signalling. Both themes verified for
  // contrast against `bg-card`.
  const getStatusTint = (status: ActionableStatus): string => {
    switch (status) {
      case 'pending': return 'bg-amber-500/[0.05] dark:bg-amber-400/[0.04]'
      case 'in_progress': return 'bg-blue-500/[0.05] dark:bg-blue-400/[0.04]'
      case 'generated': return 'bg-emerald-500/[0.05] dark:bg-emerald-400/[0.04]'
      case 'shared': return 'bg-violet-500/[0.05] dark:bg-violet-400/[0.04]'
      case 'dismissed': return 'bg-muted/30'
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

        {/* Filter bar - AC-03 FIX: Added 'in_progress'. Each tab shows the EXACT
            count (no "99+" cap) sourced from the shared actionables store. */}
        <div className="flex items-center gap-2 mt-4 overflow-x-auto pb-2">
          {(['all', 'pending', 'in_progress', 'generated', 'shared', 'dismissed'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={cn(
                "px-4 py-1.5 rounded-full text-xs font-semibold border transition-all whitespace-nowrap capitalize flex items-center gap-1.5",
                statusFilter === s
                  ? "bg-primary border-primary text-primary-foreground shadow-sm"
                  : "bg-background border-border text-muted-foreground hover:bg-muted"
              )}
            >
              <span>{s === 'in_progress' ? 'In Progress' : s}</span>
              <span
                className={cn(
                  "tabular-nums rounded-full px-1.5 text-[10px] font-bold",
                  statusFilter === s ? "bg-primary-foreground/20" : "bg-muted-foreground/10"
                )}
              >
                {counts[s]}
              </span>
            </button>
          ))}
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        <div className={cn(pageContent, 'space-y-6')}>
          {/* Sort / group / filter / select-all toolbar — shown whenever there is
              anything to organize, so filters remain reachable even if the current
              status tab is empty. */}
          {actionables.length > 0 && (
            <ActionablesControls
              sortKey={sortKey}
              onSortKeyChange={setSortKey}
              sortDir={sortDir}
              onToggleSortDir={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
              groupKey={groupKey}
              onGroupKeyChange={setGroupKey}
              typeFilter={typeFilter}
              onTypeFilterChange={setTypeFilter}
              typeOptions={typeOptions}
              dateFilter={dateFilter}
              onDateFilterChange={setDateFilter}
              allSelected={allSelected}
              onToggleSelectAll={toggleSelectAll}
              visibleCount={sortedActionables.length}
            />
          )}

          {/* C-ACT-006: Loading skeleton instead of spinner */}
          {loading && actionables.length === 0 ? (
            <ActionableSkeleton />
          ) : sortedActionables.length === 0 ? (
            <Card className="border-dashed bg-muted/5">
              <CardContent className="py-16 text-center">
                <ListTodo className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-30" />
                <h3 className="text-lg font-medium mb-2">No matching Actionables</h3>
                <p className="text-muted-foreground text-sm max-w-xs mx-auto">
                  {actionables.length === 0
                    ? 'Suggestions will appear here as you transcribe meetings and capture knowledge.'
                    : 'No actionables match the current filters. Try widening the status, type, or date filters.'}
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-6">
              {renderGroups.map((group) => (
                <div key={group.key} className="space-y-4">
                  {group.label && (
                    <div className="flex items-center gap-2 sticky top-0 z-10 -mx-1 px-1 py-1 bg-background/95 backdrop-blur-sm">
                      <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{group.label}</h2>
                      <span className="text-[10px] font-semibold text-muted-foreground/70 tabular-nums">{group.items.length}</span>
                      <div className="flex-1 h-px bg-border" />
                    </div>
                  )}
                  {group.items.map((actionable, index) => (
                <Card
                  key={actionable.id}
                  style={{ animationDelay: `${Math.min(index, 6) * 45}ms` }}
                  className={cn(
                    // Standard card treatment: hairline border + shadow-sm elevation
                    // + hover lift (`.lift`), no side-stripe. Entrance rises in with a
                    // staggered delay (reduced-motion collapses it via the global CSS).
                    "group animate-rise-in lift overflow-hidden border shadow-sm",
                    getStatusTint(actionable.status),
                    selectedIds.has(actionable.id) && "ring-2 ring-primary ring-offset-1 ring-offset-background"
                  )}
                >
                  <div className="min-h-[100px]">
                    {/* min-w-0 lets the title truncate instead of pushing the action buttons out of the card */}
                    <div className="min-w-0 p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                      {/* Bulk-select checkbox */}
                      <div className="flex items-start pt-1 sm:self-center sm:pt-0">
                        <Checkbox
                          checked={selectedIds.has(actionable.id)}
                          onCheckedChange={() => toggleSelect(actionable.id)}
                          aria-label={`Select actionable: ${actionable.title}`}
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        {/* Clickable title area toggles the inline detail panel.
                            Kept separate from the recipients row below so those
                            person chips remain independently clickable. */}
                        <button
                          type="button"
                          onClick={() => toggleExpanded(actionable.id)}
                          aria-expanded={expandedId === actionable.id}
                          className="text-left w-full group/exp rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <div className="flex items-center gap-2 mb-1">
                            {getStatusIcon(actionable.status)}
                            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{humanizeActionableType(actionable.type)}</span>
                            <ChevronDown className={cn(
                              "h-3.5 w-3.5 text-muted-foreground transition-transform ml-auto sm:ml-0",
                              expandedId === actionable.id && "rotate-180"
                            )} />
                          </div>
                          <h3
                            className={cn(
                              "text-lg font-bold leading-tight pr-4 group-hover/exp:text-primary transition-colors",
                              expandedId === actionable.id ? "whitespace-normal" : "truncate"
                            )}
                            title={actionable.title}
                          >
                            {actionable.title}
                          </h3>
                          {actionable.description && expandedId !== actionable.id && (
                            <p className="text-sm text-muted-foreground mt-1 line-clamp-1 italic pr-4">"{actionable.description}"</p>
                          )}
                        </button>
                        <div className="flex items-center gap-3 mt-3">
                          <div
                            className="flex items-center gap-1 text-[10px] text-muted-foreground font-medium bg-muted/50 px-2 py-0.5 rounded-full"
                            title={formatSmartDate(actionable.createdAt)}
                          >
                            <Clock className="h-3 w-3" />
                            {/* Absolute date carries the YEAR; relative hint gives recency at a glance. */}
                            <span>{formatSmartDate(actionable.createdAt, { time: false })}</span>
                            {formatRelativeDate(actionable.createdAt) && (
                              <span className="text-muted-foreground/70">· {formatRelativeDate(actionable.createdAt)}</span>
                            )}
                          </div>
                          {actionable.confidence && actionable.status === 'pending' && (
                            // Confidence carries hierarchy through weight + tint, not
                            // alarm colors: a strong signal (>=80%) reads as a solid
                            // emerald pill, a moderate one quiets to a neutral chip, and
                            // a weak one recedes into muted text — so 95% visibly
                            // outranks 70% on a squint test without shouting "error".
                            <div className={cn(
                              "flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full",
                              actionable.confidence >= 0.8
                                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 font-semibold"
                                : actionable.confidence >= 0.6
                                  ? "bg-muted/60 text-foreground/70 font-medium"
                                  : "bg-muted/40 text-muted-foreground font-normal"
                            )}>
                              <Sparkles className={cn(
                                "h-3 w-3",
                                actionable.confidence >= 0.8 ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"
                              )} />
                              <span>{Math.round(actionable.confidence * 100)}% confidence</span>
                            </div>
                          )}
                          {actionable.suggestedRecipients.length > 0 && (
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <Users className="h-3 w-3 text-muted-foreground" />
                              {actionable.suggestedRecipients.map((recipient, ri) => {
                                const contact = resolveRecipient(recipient)
                                return (
                                  <EntityMention
                                    key={`${recipient}-${ri}`}
                                    type="person"
                                    id={contact?.id}
                                    name={contact?.name || recipient}
                                  />
                                )
                              })}
                            </div>
                          )}
                        </div>

                        {/* Inline detail panel — full context at the decision point */}
                        {expandedId === actionable.id && (
                          <ActionableDetail actionable={actionable} resolveRecipient={resolveRecipient} />
                        )}
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
                              {loadingActionableIds.has(actionable.id)
                                ? 'Generating...'
                                : getTemplateInfo(actionable.suggestedTemplate).actionLabel}
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
                                  const output = { ...result.data, sourceId: actionable.sourceKnowledgeId, actionableId: actionable.id }
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
                                    const output = { ...genResult.data, sourceId: actionable.sourceKnowledgeId, actionableId: actionable.id }
                                    cacheOutput(actionable.id, output)
                                    setGeneratedOutput(output)
                                    setShowOutputModal(true)
                                  } else {
                                    toast.error('Failed to load output', genResult.error?.message || 'Unknown error')
                                  }
                                  setGenerating(false)
                                } else {
                                  toast.error('Failed to load output', (!result.success && result.error?.message) || 'Unknown error')
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
              ))}
            </div>
          )}

          {/* C-ACT-005: Pagination controls (only when the flat list is un-grouped) */}
          {!grouped && sortedActionables.length > PAGE_SIZE && (
            <div className="flex items-center justify-between pt-2">
              <span className="text-xs text-muted-foreground">
                Showing {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, sortedActionables.length)} of {sortedActionables.length}
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

      {/* Bulk action bar — appears while items are selected. Hidden when the error
          banner is up so the two don't stack on top of each other. */}
      {!generationError && (
        <BulkActionBar
          count={selectedIds.size}
          onGenerate={handleBulkGenerate}
          onDismiss={handleBulkDismiss}
          onClear={clearSelection}
          busy={bulkBusy}
        />
      )}

      {/* C-ACT-M07: Error banner positioned at bottom to avoid overlapping header/nav */}
      {generationError && (
        <div className="animate-rise-in fixed bottom-4 left-1/2 -translate-x-1/2 z-40 px-4 py-3 bg-destructive/10 border border-destructive/20 rounded-xl flex items-center justify-between gap-4 max-w-2xl w-full shadow-lg">
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
          <div className="animate-rise-in text-center space-y-4 bg-card p-8 rounded-xl shadow-lg border">
            <Loader2 className="h-12 w-12 animate-spin mx-auto text-primary" />
            <div>
              <h3 className="text-lg font-semibold mb-1">
                Generating {getTemplateInfo(currentGeneratingTemplate).name}...
              </h3>
              <p className="text-sm text-muted-foreground">This may take a few moments...</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => cancelGeneration(cancellableActionableId)}>
              <X className="h-4 w-4 mr-2" />
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* C-ACT-007: Confirmation dialog before regeneration */}
      <Dialog open={!!confirmRegenerate} onOpenChange={(open) => { if (!open) setConfirmRegenerate(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Regenerate Output?</DialogTitle>
            <DialogDescription>
              This will create a new {getTemplateInfo(confirmRegenerate?.suggestedTemplate).name} ({getTemplateInfo(confirmRegenerate?.suggestedTemplate).format}), replacing the previous result.
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
              {getTemplateInfo(generatedOutput?.templateId).name}
              {/* C-ACT-008: Show timestamp on generated output */}
              {generatedOutput?.generatedAt && (
                <span className="ml-2 text-xs text-muted-foreground">
                  &middot; {formatSmartDate(generatedOutput.generatedAt)}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="prose prose-sm max-w-none dark:prose-invert bg-muted/30 p-4 rounded-md border">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{generatedOutput?.content || ''}</ReactMarkdown>
          </div>
          <DialogFooter className="gap-2">
            {generatedOutput?.templateId === 'claude_code_prompt' && (
              // Primary CTA for the Claude Code handoff — closes the loop by
              // launching a Claude Code session pointed at the generated prompt.
              <Button
                onClick={openInClaudeCode}
                disabled={launchingClaude}
                className="gap-2 sm:mr-auto"
                title="Opens Claude Code in the source project folder (or a folder you choose) and hands off this prompt"
              >
                {launchingClaude ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Terminal className="h-4 w-4" />
                )}
                Open in Claude Code
              </Button>
            )}
            {generatedOutput?.sourceId && (
              <Button
                variant="outline"
                onClick={() => navigate('/library', { state: { selectedId: generatedOutput.sourceId } })}
              >
                <FileText className="h-4 w-4 mr-2" />
                View Source
              </Button>
            )}
            {generatedOutput?.savedPath && (
              <Button
                variant="outline"
                onClick={async () => {
                  const res = await window.electronAPI.outputs.openInFolder(generatedOutput.savedPath!)
                  if (!res.success) {
                    toast.error('Open failed', res.error?.message || 'Could not open folder')
                  }
                }}
                title={generatedOutput.savedPath}
              >
                <FileText className="h-4 w-4 mr-2" />
                Show Saved File
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
