import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Folder,
  FolderOpen,
  Search,
  Plus,
  RefreshCw,
  Clock,
  Trash2,
  Archive,
  CheckCircle2,
  CircleDot,
  FileText,
  Bot,
  Users,
  Edit,
  Check,
  X,
  Globe,
  ExternalLink,
  AlertTriangle,
  ShieldAlert,
  Pencil,
  Sparkles,
  ChevronRight,
  ChevronLeft,
  ArrowRight,
  BookOpen
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose
} from '@/components/ui/dialog'
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
import type { Project, KnowledgeCapture } from '@/types/knowledge'
import { EntityMention } from '@/components/entity'
import {
  IdentitySuggestionsSection,
  type IdentitySuggestionsSectionHandle
} from '@/components/identity/IdentitySuggestionsSection'

/** Resolved member info for display in the project detail */
interface ProjectMember {
  id: string
  name: string
  type: string
}

/** Project issue / risk / note (v29). */
interface ProjectNote {
  id: string
  project_id: string
  kind: 'issue' | 'risk' | 'note'
  content: string
  status: 'open' | 'resolved'
  created_at: string
  resolved_at: string | null
}

/** Actionable linked to a project (v29). */
interface ProjectActionable {
  id: string
  type: string
  title: string
  description: string | null
  sourceKnowledgeId: string
  status: string
  confidence: number | null
  createdAt: string
}
import { cn } from '@/lib/utils'
import { pageContent } from '@/lib/pageLayout'
import { toast } from '@/components/ui/toaster'

export function Projects() {
  const [projects, setProjects] = useState<Project[]>([])
  const [activeProject, setActiveProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'active' | 'archived' | 'all'>('active')

  // B-PRJ-006: Create project dialog state (replaces prompt())
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createDescription, setCreateDescription] = useState('')

  // B-PRJ-007: Delete project dialog state (replaces confirm())
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [projectMembers, setProjectMembers] = useState<ProjectMember[]>([])

  // Dismiss-vs-delete: the delete dialog doubles as the dismiss confirm for a
  // discovered project. Dismiss routes through projects:dismissDiscovered, which
  // writes a durable rejection tombstone (v41) BEFORE deleting — a bare delete
  // let the next transcript re-analysis silently re-create the same project.
  const [dismissMode, setDismissMode] = useState(false)

  // Inline description editing state
  const [isEditingDescription, setIsEditingDescription] = useState(false)
  const [editDescription, setEditDescription] = useState('')

  // Inline name editing state (R3b rename)
  const [isEditingName, setIsEditingName] = useState(false)
  const [editName, setEditName] = useState('')

  // Metadata: folder-on-disk + webpage (R3b)
  const [isEditingFolder, setIsEditingFolder] = useState(false)
  const [editFolder, setEditFolder] = useState('')
  const [isEditingUrl, setIsEditingUrl] = useState(false)
  const [editUrl, setEditUrl] = useState('')

  // Issues / risks + actionables (R3b)
  const [notes, setNotes] = useState<ProjectNote[]>([])
  const [actionables, setActionables] = useState<ProjectActionable[]>([])

  // Linked knowledge items — resolved so the count card becomes a clickable list.
  const [knowledgeItems, setKnowledgeItems] = useState<KnowledgeCapture[]>([])

  // Provenance: the meeting(s) this project was discovered FROM (via
  // meeting_projects). getById already returns them; the detail surfaces them so a
  // discovered project links back to its source instead of being a dead end.
  const [sourceMeetings, setSourceMeetings] = useState<{ id: string; subject: string }[]>([])
  const [newIssue, setNewIssue] = useState('')
  const [newRisk, setNewRisk] = useState('')

  // Discovery sweep: analyze projects for possible duplicates → new suggestions.
  const [discovering, setDiscovering] = useState(false)
  const suggestionsRef = useRef<IdentitySuggestionsSectionHandle>(null)

  // Identity suggestions coexist with the project hub. When a project is open the
  // full group cards would overflow the (non-scrolling) main pane and evict the hub
  // the user just clicked, so we collapse them into a compact banner that expands on
  // demand. This count decides whether that banner appears; the section itself still
  // owns the live queue (we do NOT modify it), so we re-read the count on collapse.
  const [projectSuggestionCount, setProjectSuggestionCount] = useState(0)
  const [reviewExpanded, setReviewExpanded] = useState(false)

  const refreshSuggestionCount = useCallback(async () => {
    try {
      const res = await window.electronAPI.identity.getSuggestions('pending')
      const count =
        res.success && Array.isArray(res.data)
          ? (res.data as Array<{ kind?: string }>).filter((s) => s.kind === 'project').length
          : 0
      setProjectSuggestionCount(count)
    } catch {
      setProjectSuggestionCount(0)
    }
  }, [])

  useEffect(() => {
    refreshSuggestionCount()
  }, [refreshSuggestionCount])

  const collapseReview = useCallback(() => {
    setReviewExpanded(false)
    refreshSuggestionCount()
  }, [refreshSuggestionCount])

  // Selecting/deselecting a project always lands on the hub, never mid-review.
  useEffect(() => {
    setReviewExpanded(false)
  }, [activeProject?.id])

  const navigate = useNavigate()

  // Debounce: skip firing on initial mount
  const isFirstMount = useRef(true)

  // B-PRJ-005: Memoized loadProjects with useCallback
  const loadProjects = useCallback(async () => {
    setLoading(true)
    try {
      const result = await window.electronAPI.projects.getAll({
        search: searchQuery,
        status: statusFilter
      })
      if (result.success) {
        const mapped = result.data.projects.map((p: any) => ({
          ...p,
          status: p.status || 'active',
          createdAt: p.created_at || p.createdAt || new Date().toISOString()
        }))
        setProjects(mapped)
      }
    } catch (error) {
      console.error('Failed to load projects:', error)
      toast.error('Failed to load projects', error instanceof Error ? error.message : 'An unexpected error occurred')
    } finally {
      setLoading(false)
    }
  }, [searchQuery, statusFilter])

  // Initial load: fire immediately
  useEffect(() => {
    loadProjects()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Subsequent changes: debounce search/filter
  useEffect(() => {
    if (isFirstMount.current) {
      isFirstMount.current = false
      return
    }
    const timer = setTimeout(() => {
      loadProjects()
    }, 300)
    return () => clearTimeout(timer)
  }, [loadProjects])

  const handleDiscover = useCallback(async () => {
    setDiscovering(true)
    try {
      const result = await window.electronAPI.identity.discoverProjects()
      if (result.success && result.data) {
        const { candidatePairs, suggestionsCreated, autoMergeable } = result.data
        toast.success(
          'Discovery complete',
          `${candidatePairs} candidate pairs analyzed, ${suggestionsCreated} new ${suggestionsCreated === 1 ? 'suggestion' : 'suggestions'}, ${autoMergeable} high-confidence`
        )
        suggestionsRef.current?.reload()
        refreshSuggestionCount()
      } else {
        toast.error('Discovery failed', result.error || 'Unknown error')
      }
    } catch (error) {
      console.error('Failed to discover projects:', error)
      toast.error('Discovery failed', error instanceof Error ? error.message : 'An unexpected error occurred')
    } finally {
      setDiscovering(false)
    }
  }, [refreshSuggestionCount])

  // Projects are already filtered server-side by searchQuery and statusFilter
  const filteredProjects = projects

  // B-PRJ-006: Create project via Dialog instead of prompt()
  const handleCreateProject = async () => {
    if (!createName.trim()) return

    try {
      const result = await window.electronAPI.projects.create({
        name: createName.trim(),
        description: createDescription.trim() || undefined
      })
      if (result.success) {
        const p = result.data as any
        const mapped: Project = {
          ...p,
          status: p.status || 'active',
          createdAt: p.created_at || p.createdAt || new Date().toISOString()
        }
        setProjects(prev => [mapped, ...prev])
        setActiveProject(mapped)
        toast.success('Project created', `"${mapped.name}" has been created.`)
      }
    } catch (error) {
      console.error('Failed to create project:', error)
      toast.error('Failed to create project', error instanceof Error ? error.message : 'An unexpected error occurred')
    }

    setCreateDialogOpen(false)
    setCreateName('')
    setCreateDescription('')
  }

  const openCreateDialog = () => {
    setCreateName('')
    setCreateDescription('')
    setCreateDialogOpen(true)
  }

  // B-PRJ-007: Delete project via AlertDialog instead of confirm().
  // In dismiss mode (discovered project) the same confirm routes through
  // dismissDiscovered so the rejection is durable across re-analysis.
  const handleDeleteProject = async () => {
    if (!activeProject) return
    const dismissing = dismissMode
    try {
      const result = dismissing
        ? await window.electronAPI.projects.dismissDiscovered(activeProject.id)
        : await window.electronAPI.projects.delete(activeProject.id)
      if (result.success) {
        if (dismissing) {
          toast.success('Discovery dismissed', `"${activeProject.name}" won't be re-created from transcripts.`)
        } else {
          toast.success('Project deleted', `"${activeProject.name}" has been deleted.`)
        }
        setProjects(prev => prev.filter(p => p.id !== activeProject.id))
        setActiveProject(null)
      }
    } catch (error) {
      console.error('Failed to delete project:', error)
      toast.error(
        dismissing ? 'Failed to dismiss project' : 'Failed to delete project',
        error instanceof Error ? error.message : 'An unexpected error occurred'
      )
    }
    setDeleteDialogOpen(false)
    setDismissMode(false)
  }

  // Load a project's issues/risks/notes and linked actionables (R3b)
  const loadProjectExtras = useCallback(async (projectId: string) => {
    try {
      const [notesRes, actionablesRes] = await Promise.all([
        window.electronAPI.projects.getNotes({ projectId }),
        window.electronAPI.projects.getActionables(projectId)
      ])
      setNotes(notesRes.success ? notesRes.data : [])
      setActionables(actionablesRes.success ? actionablesRes.data : [])
    } catch (err) {
      console.error('Failed to load project extras:', err)
      setNotes([])
      setActionables([])
    }
  }, [])

  // Load project details with knowledgeIds/personIds when selected
  const handleSelectProject = async (project: Project) => {
    setActiveProject(project)
    setProjectMembers([])
    setNotes([])
    setActionables([])
    setKnowledgeItems([])
    setSourceMeetings([])
    setDetailLoading(true)
    setIsEditingDescription(false)
    setIsEditingName(false)
    setIsEditingFolder(false)
    setIsEditingUrl(false)
    try {
      const result = await window.electronAPI.projects.getById(project.id)
      if (result.success && result.data.project) {
        const p = result.data.project as any
        const detailed: Project = {
          id: p.id,
          name: p.name,
          description: p.description,
          status: p.status || 'active',
          createdAt: p.created_at || p.createdAt || new Date().toISOString(),
          knowledgeIds: p.knowledgeIds,
          personIds: p.personIds,
          folderPath: p.folderPath ?? p.folder_path ?? null,
          url: p.url ?? null
        }
        setActiveProject(detailed)
        setEditFolder(detailed.folderPath || '')
        setEditUrl(detailed.url || '')

        // Provenance: meetings linked to this project (the source it was discovered
        // from). Present for auto-discovered projects; empty for hand-created ones.
        const rawMeetings = Array.isArray((result.data as any).meetings) ? (result.data as any).meetings : []
        setSourceMeetings(
          rawMeetings
            .filter((m: any) => m && m.id)
            .map((m: any) => ({ id: String(m.id), subject: (m.subject || m.title || 'Untitled meeting') as string }))
        )

        void loadProjectExtras(detailed.id)

        // Resolve linked knowledge items so the count becomes a clickable list.
        if (detailed.knowledgeIds && detailed.knowledgeIds.length > 0) {
          try {
            const items = await window.electronAPI.knowledge?.getByIds?.(detailed.knowledgeIds)
            setKnowledgeItems(Array.isArray(items) ? items : [])
          } catch {
            setKnowledgeItems([])
          }
        }

        // Resolve person names from IDs in parallel (fixes N+1 query)
        if (detailed.personIds && detailed.personIds.length > 0) {
          const memberPromises = detailed.personIds.map(async (personId): Promise<ProjectMember> => {
            try {
              const contactResult = await window.electronAPI.contacts.getById(personId)
              if (contactResult.success && contactResult.data.contact) {
                const c = contactResult.data.contact as any
                return { id: c.id, name: c.name, type: c.type || 'unknown' }
              }
            } catch {
              // Skip unresolvable contacts
            }
            return { id: personId, name: personId.substring(0, 8) + '...', type: 'unknown' }
          })
          const members = await Promise.all(memberPromises)
          setProjectMembers(members)
        }
      }
    } catch (err) {
      console.error('Failed to load project details:', err)
      toast.error('Failed to load project details', err instanceof Error ? err.message : 'An unexpected error occurred')
    } finally {
      setDetailLoading(false)
    }
  }

  // Save description inline
  const handleSaveDescription = async () => {
    if (!activeProject) return
    try {
      const result = await window.electronAPI.projects.update({
        id: activeProject.id,
        description: editDescription.trim() || null
      })
      if (result.success) {
        const updated: Project = { ...activeProject, description: editDescription.trim() || null }
        setActiveProject(updated)
        setProjects(prev => prev.map(p => p.id === activeProject.id ? updated : p))
        toast.success('Description updated', 'Project description has been saved.')
      }
    } catch (err) {
      console.error('Failed to update description:', err)
      toast.error('Failed to update description', err instanceof Error ? err.message : 'An unexpected error occurred')
    }
    setIsEditingDescription(false)
  }

  // Apply a partial update to the active project, syncing local + list state.
  const applyProjectUpdate = useCallback(async (patch: Partial<Project>): Promise<boolean> => {
    if (!activeProject) return false
    try {
      const result = await window.electronAPI.projects.update({ id: activeProject.id, ...patch } as any)
      if (result.success) {
        const updated: Project = { ...activeProject, ...patch }
        setActiveProject(updated)
        setProjects(prev => prev.map(p => (p.id === activeProject.id ? { ...p, ...patch } : p)))
        return true
      }
      toast.error('Failed to update project')
      return false
    } catch (err) {
      console.error('Failed to update project:', err)
      toast.error('Failed to update project', err instanceof Error ? err.message : 'An unexpected error occurred')
      return false
    }
  }, [activeProject])

  // Rename (inline)
  const handleSaveName = async () => {
    const trimmed = editName.trim()
    if (!activeProject || !trimmed || trimmed === activeProject.name) {
      setIsEditingName(false)
      return
    }
    if (await applyProjectUpdate({ name: trimmed })) {
      toast.success('Project renamed', `Now "${trimmed}".`)
    }
    setIsEditingName(false)
  }

  // Folder path (inline + Browse)
  const handleSaveFolder = async () => {
    if (!activeProject) return
    const value = editFolder.trim()
    if (value === (activeProject.folderPath || '')) {
      setIsEditingFolder(false)
      return
    }
    if (await applyProjectUpdate({ folderPath: value || null })) {
      toast.success('Folder updated')
    }
    setIsEditingFolder(false)
  }

  const handleBrowseFolder = async () => {
    try {
      const result = await window.electronAPI.storage.selectFolder?.(activeProject?.folderPath || undefined)
      if (result?.success && result.data) {
        setEditFolder(result.data)
        if (await applyProjectUpdate({ folderPath: result.data })) {
          toast.success('Folder updated')
        }
        setIsEditingFolder(false)
      }
    } catch (err) {
      console.error('Failed to pick folder:', err)
      toast.error('Failed to pick folder')
    }
  }

  const handleOpenFolder = async () => {
    if (!activeProject) return
    try {
      const result = await window.electronAPI.projects.openFolder(activeProject.id)
      if (!result.success) {
        toast.error('Cannot open folder', (result as any).error?.message || 'Folder is not set or does not exist.')
      }
    } catch (err) {
      console.error('Failed to open folder:', err)
      toast.error('Failed to open folder')
    }
  }

  // Webpage URL (inline)
  const handleSaveUrl = async () => {
    if (!activeProject) return
    const value = editUrl.trim()
    if (value === (activeProject.url || '')) {
      setIsEditingUrl(false)
      return
    }
    if (await applyProjectUpdate({ url: value || null })) {
      toast.success('URL updated')
    }
    setIsEditingUrl(false)
  }

  // Issues / risks / notes CRUD
  const handleAddNote = async (kind: 'issue' | 'risk', content: string) => {
    if (!activeProject) return
    const trimmed = content.trim()
    if (!trimmed) return
    try {
      const result = await window.electronAPI.projects.addNote({ projectId: activeProject.id, kind, content: trimmed })
      if (result.success) {
        setNotes(prev => [result.data, ...prev])
        if (kind === 'issue') setNewIssue('')
        else setNewRisk('')
      } else {
        toast.error(`Failed to add ${kind}`)
      }
    } catch (err) {
      console.error(`Failed to add ${kind}:`, err)
      toast.error(`Failed to add ${kind}`)
    }
  }

  const handleToggleNote = async (note: ProjectNote) => {
    const nextStatus = note.status === 'open' ? 'resolved' : 'open'
    try {
      const result = await window.electronAPI.projects.updateNote({ id: note.id, status: nextStatus })
      if (result.success) {
        setNotes(prev => prev.map(n => (n.id === note.id ? result.data : n)))
      }
    } catch (err) {
      console.error('Failed to update note:', err)
      toast.error('Failed to update')
    }
  }

  const handleDeleteNote = async (id: string) => {
    try {
      const result = await window.electronAPI.projects.deleteNote({ id })
      if (result.success) {
        setNotes(prev => prev.filter(n => n.id !== id))
      }
    } catch (err) {
      console.error('Failed to delete note:', err)
      toast.error('Failed to delete')
    }
  }

  const issues = notes.filter(n => n.kind === 'issue')
  const risks = notes.filter(n => n.kind === 'risk')

  return (
    <div className="flex h-full bg-background">
      {/* Sidebar - Projects List */}
      <aside className="w-80 border-r flex flex-col bg-muted/10">
        <div className="p-4 border-b space-y-4">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold">Projects</h1>
            <div className="flex items-center gap-1">
              <Button
                onClick={handleDiscover}
                disabled={discovering}
                size="sm"
                variant="outline"
                className="h-8 gap-1"
                title="Analyze projects for possible duplicates"
              >
                <Sparkles className={cn("h-4 w-4", discovering && "animate-pulse")} />
                {discovering ? 'Discovering…' : 'Discover'}
              </Button>
              <Button onClick={openCreateDialog} size="sm" className="h-8 gap-1">
                <Plus className="h-4 w-4" />
                New
              </Button>
            </div>
          </div>

          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search projects..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-9"
            />
          </div>

          <div className="flex gap-1 p-1 bg-muted rounded-lg">
            {(['all', 'active', 'archived'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={cn(
                  "flex-1 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all",
                  statusFilter === s ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-auto p-2">
          {loading && projects.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filteredProjects.length === 0 ? (
            <div className="text-center py-12 px-4">
              <Folder className="h-8 w-8 mx-auto text-muted-foreground opacity-20 mb-3" />
              <p className="text-xs text-muted-foreground mb-3">
                {searchQuery
                  ? `No projects matching "${searchQuery}"`
                  : statusFilter === 'all'
                    ? 'No projects yet'
                    : `No ${statusFilter} projects`}
              </p>
              {!searchQuery && (
                <Button onClick={openCreateDialog} size="sm" variant="outline" className="h-7 text-xs gap-1">
                  <Plus className="h-3 w-3" />
                  Create Project
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-1">
              {filteredProjects.map((project, index) => {
                const isActive = activeProject?.id === project.id
                return (
                  <button
                    key={project.id}
                    type="button"
                    onClick={() => handleSelectProject(project)}
                    aria-current={isActive ? 'true' : undefined}
                    title={`${project.name} · ${project.status} · created ${new Date(project.createdAt).toLocaleDateString()}`}
                    style={{ animationDelay: `${Math.min(index, 8) * 35}ms` }}
                    className={cn(
                      "animate-rise-in lift w-full text-left p-3 rounded-xl cursor-pointer group",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      isActive
                        ? "bg-primary text-primary-foreground shadow-md"
                        : "border border-transparent bg-card/40 text-muted-foreground hover:text-foreground hover:border-border"
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <div className={cn(
                        "w-10 h-10 rounded-xl flex items-center justify-center border shadow-sm shrink-0",
                        isActive ? "bg-primary-foreground/10 border-primary-foreground/20" : "bg-background border-border"
                      )}>
                        <Folder className={cn("h-5 w-5", isActive ? "text-primary-foreground" : "text-muted-foreground")} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold truncate">{project.name}</p>
                        <div className="flex items-center gap-2 mt-1 text-[10px] opacity-70">
                          <span
                            className={cn(
                              "h-1.5 w-1.5 rounded-full shrink-0",
                              project.status === 'active'
                                ? "bg-emerald-500"
                                : isActive ? "bg-primary-foreground/50" : "bg-slate-400 dark:bg-slate-500"
                            )}
                            title={project.status === 'active' ? 'Active project' : 'Archived project'}
                            aria-hidden="true"
                          />
                          <Clock className="h-3 w-3" aria-hidden="true" />
                          <span>{new Date(project.createdAt).toLocaleDateString()}</span>
                        </div>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </aside>

      {/* Main Detail Area */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Project identity suggestions.
            - No project open: full section inline (self-hides when empty; populated by Discover).
            - Project open + suggestions present: a compact one-line banner so the hub the user
              selected stays reachable. "Review" expands the full section; "Back" collapses it. */}
        {activeProject && projectSuggestionCount > 0 ? (
          reviewExpanded ? (
            <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
              <button
                type="button"
                onClick={collapseReview}
                className="flex items-center gap-2 px-8 pt-6 pb-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 rounded"
                aria-label={`Back to ${activeProject.name}`}
              >
                <ChevronLeft className="h-4 w-4" />
                Back to {activeProject.name}
              </button>
              <div className="flex-1 overflow-auto px-8 pb-6">
                <IdentitySuggestionsSection kind="project" ref={suggestionsRef} />
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setReviewExpanded(true)}
              className="mx-8 mt-6 mb-2 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2 text-sm hover:bg-amber-500/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              aria-label={`Review ${projectSuggestionCount} project name ${projectSuggestionCount === 1 ? 'suggestion' : 'suggestions'}`}
            >
              <Sparkles className="h-4 w-4 text-amber-500 flex-shrink-0" />
              <span className="font-medium">
                {projectSuggestionCount} project name {projectSuggestionCount === 1 ? 'suggestion' : 'suggestions'}
              </span>
              <span className="text-xs text-muted-foreground hidden sm:inline">— possible duplicate names to confirm</span>
              <span className="ml-auto inline-flex items-center gap-1 text-primary font-medium">
                Review <ChevronRight className="h-4 w-4" />
              </span>
            </button>
          )
        ) : (
          !activeProject && (
            <div className="px-8 pt-6 empty:hidden">
              <IdentitySuggestionsSection kind="project" ref={suggestionsRef} />
            </div>
          )
        )}
        {!(activeProject && projectSuggestionCount > 0 && reviewExpanded) && (
          activeProject && detailLoading ? (
          <div className="flex-1 flex flex-col items-center justify-center">
            <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground mb-4" />
            <p className="text-sm text-muted-foreground">Loading project details...</p>
          </div>
        ) : activeProject ? (
          <div className="flex flex-col flex-1 min-h-0 overflow-hidden animate-in fade-in slide-in-from-right-2 duration-300">
            {/* Header */}
            <header className="border-b px-8 py-6 h-[120px] flex items-center justify-between">
              <div className="flex items-center gap-4 min-w-0">
                <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center shadow-inner">
                  <Folder className="h-7 w-7 text-primary" />
                </div>
                <div className="min-w-0">
                  {isEditingName ? (
                    <div className="flex items-center gap-2">
                      <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveName()
                          if (e.key === 'Escape') setIsEditingName(false)
                        }}
                        className="text-2xl font-bold h-auto py-1"
                        autoFocus
                        aria-label="Project name"
                      />
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleSaveName} aria-label="Save name" title="Save (Enter)">
                        <Check className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setIsEditingName(false)} aria-label="Cancel rename" title="Cancel (Escape)">
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <div className="group flex items-center gap-2">
                      <h2 className="text-2xl font-bold truncate" title={activeProject.name}>{activeProject.name}</h2>
                      <button
                        onClick={() => { setEditName(activeProject.name); setIsEditingName(true) }}
                        className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 transition-opacity p-1 rounded hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                        aria-label="Edit project name"
                        title="Rename project"
                      >
                        <Pencil className="h-4 w-4 text-muted-foreground" />
                      </button>
                    </div>
                  )}
                  <div className="flex items-center gap-3 mt-1">
                    <span
                      title={activeProject.status === 'active' ? 'Active project' : 'Archived project'}
                      className={cn(
                        "px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border",
                        activeProject.status === 'active'
                          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20"
                          : "bg-slate-500/10 text-slate-600 dark:text-slate-300 border-slate-500/20"
                      )}
                    >
                      {activeProject.status}
                    </span>
                    <span className="text-xs text-muted-foreground">Created {new Date(activeProject.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 gap-2"
                  onClick={async () => {
                    const newStatus: 'active' | 'archived' = activeProject.status === 'active' ? 'archived' : 'active'
                    try {
                      const result = await window.electronAPI.projects.update({ id: activeProject.id, status: newStatus })
                      if (result.success) {
                        const updated: Project = { ...activeProject, status: newStatus }
                        setActiveProject(updated)
                        setProjects(prev => prev.map(p => p.id === activeProject.id ? updated : p))
                      }
                    } catch (error) {
                      console.error('Failed to update project status:', error)
                      toast.error('Failed to update project', error instanceof Error ? error.message : 'An unexpected error occurred')
                    }
                  }}
                >
                  <Archive className="h-4 w-4" />
                  {activeProject.status === 'active' ? 'Archive' : 'Activate'}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 text-muted-foreground hover:text-destructive"
                  onClick={() => { setDismissMode(false); setDeleteDialogOpen(true) }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </header>

            {/* Content */}
            <div className="flex-1 overflow-auto p-8">
              <div className={cn(pageContent, 'space-y-8')}>
                {/* Provenance / discovered-project honest state.
                    An auto-discovered project links back to the meeting(s) it was
                    inferred from. When it ALSO has zero knowledge items and zero
                    people it is a thin (possibly spurious) discovery, so we show an
                    explicit review state — source · merge · dismiss — instead of a
                    bare "0 Items / 0 Involved" dead end. The review card is gated on
                    PROVENANCE (linked meetings): a hand-created empty project is not
                    "discovered", so it gets a neutral getting-started state instead. */}
                {(() => {
                  const knowledgeCount = activeProject.knowledgeIds?.length ?? 0
                  const peopleCount = activeProject.personIds?.length ?? 0
                  const isDiscovered = sourceMeetings.length > 0
                  const sourceChips = sourceMeetings.map((m) => (
                    <EntityMention key={m.id} type="meeting" id={m.id} name={m.subject} showIcon />
                  ))

                  if (knowledgeCount === 0 && peopleCount === 0 && !isDiscovered) {
                    // Manual empty project — honest but neutral (not "discovered").
                    return (
                      <Card className="animate-rise-in bg-muted/5">
                        <CardContent className="p-6">
                          <div className="flex items-start gap-3">
                            <span title="Empty project">
                              <FolderOpen className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" aria-hidden="true" />
                            </span>
                            <div className="min-w-0 space-y-1">
                              <h3 className="text-sm font-bold">No items yet</h3>
                              <p className="text-sm text-muted-foreground">
                                Add knowledge or link meetings to start building this project's hub.
                              </p>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    )
                  }

                  if (knowledgeCount === 0 && peopleCount === 0) {
                    return (
                      <Card className="animate-rise-in border-amber-500/30 bg-amber-500/[0.06]">
                        <CardContent className="p-6 space-y-4">
                          <div className="flex items-start gap-3">
                            <span title="Automatically discovered from a transcript">
                              <Sparkles className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" aria-hidden="true" />
                            </span>
                            <div className="min-w-0 space-y-1">
                              <h3 className="text-sm font-bold">Discovered automatically</h3>
                              <p className="text-sm text-muted-foreground">
                                No knowledge items or people are linked yet — this project was inferred from a
                                mention in a transcript. Review its source, merge it into an existing project, or
                                dismiss it.
                              </p>
                            </div>
                          </div>

                          {sourceMeetings.length > 0 && (
                            <div className="space-y-1.5">
                              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                                Discovered from
                              </p>
                              <div className="flex flex-wrap gap-1.5">{sourceChips}</div>
                            </div>
                          )}

                          <div className="flex flex-wrap items-center gap-2 pt-1">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 gap-1.5"
                              onClick={handleDiscover}
                              disabled={discovering}
                              title="Scan projects for a likely duplicate to merge this into"
                            >
                              <Sparkles className={cn('h-3.5 w-3.5', discovering && 'animate-pulse')} />
                              {discovering ? 'Finding duplicates…' : 'Merge into another project'}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 gap-1.5 text-muted-foreground hover:text-destructive"
                              onClick={() => { setDismissMode(true); setDeleteDialogOpen(true) }}
                              title="Dismiss this discovered project (won't be re-created from transcripts)"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Dismiss
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    )
                  }

                  if (sourceMeetings.length > 0) {
                    return (
                      <Card className="animate-rise-in bg-muted/5">
                        <CardContent className="p-4">
                          <div className="flex flex-wrap items-center gap-2">
                            <span title="Automatically discovered from a transcript">
                              <Sparkles className="h-4 w-4 text-primary shrink-0" aria-hidden="true" />
                            </span>
                            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                              Discovered from
                            </span>
                            <div className="flex flex-wrap gap-1.5">{sourceChips}</div>
                          </div>
                        </CardContent>
                      </Card>
                    )
                  }

                  return null
                })()}

                {/* Stats Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <Card className="lift animate-rise-in bg-muted/5" style={{ animationDelay: '0ms' }}>
                    <CardContent className="pt-6">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Knowledge</p>
                        <span title="Knowledge items linked to this project"><FileText className="h-4 w-4 text-primary" aria-hidden="true" /></span>
                      </div>
                      <p className="text-2xl font-bold mt-2">{activeProject.knowledgeIds?.length ?? '\u2014'} {activeProject.knowledgeIds ? 'Items' : ''}</p>
                    </CardContent>
                  </Card>
                  <Card className="lift animate-rise-in bg-muted/5" style={{ animationDelay: '45ms' }}>
                    <CardContent className="pt-6">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">People</p>
                        <span title="People involved in this project"><Users className="h-4 w-4 text-primary" aria-hidden="true" /></span>
                      </div>
                      <p className="text-2xl font-bold mt-2">{activeProject.personIds?.length ?? '\u2014'} {activeProject.personIds ? 'Involved' : ''}</p>
                      {projectMembers.length > 0 && (
                        <div className="mt-3 space-y-1.5">
                          {projectMembers.slice(0, 5).map((member) => (
                            <div key={member.id} className="flex items-center gap-2 text-xs">
                              <div
                                className="w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold shrink-0"
                                title={member.name}
                                aria-hidden="true"
                              >
                                {member.name.charAt(0).toUpperCase()}
                              </div>
                              <EntityMention type="person" id={member.id} name={member.name} />
                            </div>
                          ))}
                          {projectMembers.length > 5 && (
                            <p className="text-[10px] text-muted-foreground pl-7">+{projectMembers.length - 5} more</p>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                  <Card className="lift animate-rise-in bg-muted/5" style={{ animationDelay: '90ms' }}>
                    <CardContent className="pt-6">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Actions</p>
                        <span title="Action items linked to this project"><CheckCircle2 className="h-4 w-4 text-primary" aria-hidden="true" /></span>
                      </div>
                      <p className="text-2xl font-bold mt-2">{actionables.length || '\u2014'} {actionables.length ? 'Items' : ''}</p>
                    </CardContent>
                  </Card>
                </div>

                {/* Linked knowledge \u2014 the count above, made browsable. Rows deep-link into Library. */}
                {activeProject.knowledgeIds && activeProject.knowledgeIds.length > 0 && (
                  <Card className="animate-rise-in bg-muted/5" style={{ animationDelay: '120ms' }}>
                    <CardContent className="p-6 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span title="Knowledge captured for this project"><BookOpen className="h-4 w-4 text-primary" aria-hidden="true" /></span>
                          <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Knowledge</h3>
                          <span className="text-xs text-muted-foreground">{activeProject.knowledgeIds.length}</span>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs gap-1"
                          onClick={() => navigate('/library')}
                        >
                          View all in Library
                          <ArrowRight className="h-3 w-3" />
                        </Button>
                      </div>
                      {knowledgeItems.length === 0 ? (
                        <p className="text-sm text-muted-foreground italic">
                          {activeProject.knowledgeIds.length} linked {activeProject.knowledgeIds.length === 1 ? 'item' : 'items'} \u2014 open Library to browse them.
                        </p>
                      ) : (
                        <div className="space-y-1.5">
                          {knowledgeItems.slice(0, 5).map((k) => (
                            <button
                              key={k.id}
                              onClick={() => navigate('/library', { state: { selectedId: k.id } })}
                              title={`Open "${k.title || 'Untitled'}" in Library`}
                              className="w-full flex items-center gap-3 p-2.5 rounded-lg text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group"
                            >
                              <FileText className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-primary transition-colors" aria-hidden="true" />
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">{k.title || 'Untitled'}</p>
                                {(k.summary || k.capturedAt) && (
                                  <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                                    {k.summary || new Date(k.capturedAt).toLocaleDateString()}
                                  </p>
                                )}
                              </div>
                              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" aria-hidden="true" />
                            </button>
                          ))}
                          {knowledgeItems.length > 5 && (
                            <button
                              onClick={() => navigate('/library')}
                              className="w-full text-center text-xs text-muted-foreground hover:text-primary transition-colors py-1.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              +{knowledgeItems.length - 5} more in Library
                            </button>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}

                {/* Location & Links (folder-on-disk + webpage) */}
                <Card className="animate-rise-in bg-muted/5" style={{ animationDelay: '150ms' }}>
                  <CardContent className="p-6 space-y-5">
                    <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Location & Links</h3>

                    {/* Folder on disk */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                        <Folder className="h-3.5 w-3.5" />
                        Folder on disk
                      </div>
                      {isEditingFolder ? (
                        <div className="flex items-center gap-2">
                          <Input
                            value={editFolder}
                            onChange={(e) => setEditFolder(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveFolder()
                              if (e.key === 'Escape') { setEditFolder(activeProject.folderPath || ''); setIsEditingFolder(false) }
                            }}
                            placeholder="C:\\path\\to\\repo"
                            className="h-8 text-sm font-mono"
                            autoFocus
                          />
                          <Button variant="outline" size="sm" className="h-8 gap-1 shrink-0" onClick={handleBrowseFolder}>
                            <FolderOpen className="h-3.5 w-3.5" /> Browse
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={handleSaveFolder} aria-label="Save folder">
                            <Check className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => { setEditFolder(activeProject.folderPath || ''); setIsEditingFolder(false) }} aria-label="Cancel">
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          {activeProject.folderPath ? (
                            <>
                              <button
                                onClick={handleOpenFolder}
                                className="flex items-center gap-2 min-w-0 flex-1 text-sm font-mono text-left hover:text-primary transition-colors"
                                title="Open folder in file explorer"
                              >
                                <FolderOpen className="h-4 w-4 shrink-0 text-primary" />
                                <span className="truncate">{activeProject.folderPath}</span>
                              </button>
                              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => { setEditFolder(activeProject.folderPath || ''); setIsEditingFolder(true) }} aria-label="Edit folder" title="Edit folder">
                                <Edit className="h-3.5 w-3.5 text-muted-foreground" />
                              </Button>
                            </>
                          ) : (
                            <Button variant="outline" size="sm" className="h-8 gap-1 text-xs" onClick={() => { setEditFolder(''); setIsEditingFolder(true) }}>
                              <Plus className="h-3.5 w-3.5" /> Set folder path
                            </Button>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Webpage URL */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                        <Globe className="h-3.5 w-3.5" />
                        Webpage
                      </div>
                      {isEditingUrl ? (
                        <div className="flex items-center gap-2">
                          <Input
                            value={editUrl}
                            onChange={(e) => setEditUrl(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveUrl()
                              if (e.key === 'Escape') { setEditUrl(activeProject.url || ''); setIsEditingUrl(false) }
                            }}
                            placeholder="https://example.com"
                            className="h-8 text-sm"
                            autoFocus
                          />
                          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={handleSaveUrl} aria-label="Save URL">
                            <Check className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => { setEditUrl(activeProject.url || ''); setIsEditingUrl(false) }} aria-label="Cancel">
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          {activeProject.url ? (
                            <>
                              <a
                                href={activeProject.url}
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center gap-2 min-w-0 flex-1 text-sm text-primary hover:underline"
                                title={activeProject.url}
                              >
                                <ExternalLink className="h-4 w-4 shrink-0" />
                                <span className="truncate">{activeProject.url}</span>
                              </a>
                              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => { setEditUrl(activeProject.url || ''); setIsEditingUrl(true) }} aria-label="Edit URL" title="Edit URL">
                                <Edit className="h-3.5 w-3.5 text-muted-foreground" />
                              </Button>
                            </>
                          ) : (
                            <Button variant="outline" size="sm" className="h-8 gap-1 text-xs" onClick={() => { setEditUrl(''); setIsEditingUrl(true) }}>
                              <Plus className="h-3.5 w-3.5" /> Add webpage URL
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* Issues & Risks */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-rise-in" style={{ animationDelay: '210ms' }}>
                  <NoteList
                    title="Issues"
                    icon={<span title="Open issues on this project"><AlertTriangle className="h-4 w-4 text-amber-500" aria-hidden="true" /></span>}
                    items={issues}
                    newValue={newIssue}
                    onNewValueChange={setNewIssue}
                    onAdd={() => handleAddNote('issue', newIssue)}
                    onToggle={handleToggleNote}
                    onDelete={handleDeleteNote}
                    placeholder="Add an issue..."
                  />
                  <NoteList
                    title="Risks"
                    icon={<span title="Risks tracked for this project"><ShieldAlert className="h-4 w-4 text-rose-500" aria-hidden="true" /></span>}
                    items={risks}
                    newValue={newRisk}
                    onNewValueChange={setNewRisk}
                    onAdd={() => handleAddNote('risk', newRisk)}
                    onToggle={handleToggleNote}
                    onDelete={handleDeleteNote}
                    placeholder="Add a risk..."
                  />
                </div>

                {/* Action items by project */}
                <Card className="animate-rise-in bg-muted/5" style={{ animationDelay: '180ms' }}>
                  <CardContent className="p-6 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span title="Action items surfaced from this project's knowledge"><CheckCircle2 className="h-4 w-4 text-primary" aria-hidden="true" /></span>
                        <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Action Items</h3>
                      </div>
                      {actionables.length > 0 && (
                        <span className="text-xs text-muted-foreground">{actionables.length}</span>
                      )}
                    </div>
                    {actionables.length === 0 ? (
                      <p className="text-sm text-muted-foreground italic">No action items linked to this project yet.</p>
                    ) : (
                      <div className="space-y-1.5">
                        {actionables.map((a) => (
                          <button
                            key={a.id}
                            onClick={() => navigate('/actionables')}
                            title={`Open "${a.title}" in Actionables`}
                            className="w-full flex items-center gap-3 p-2.5 rounded-lg text-left hover:bg-muted transition-colors group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">{a.title}</p>
                              <p className="text-[10px] text-muted-foreground mt-0.5">{new Date(a.createdAt).toLocaleDateString()}</p>
                            </div>
                            <span
                              title={`Status: ${a.status}`}
                              className={cn(
                                "px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border shrink-0",
                                a.status === 'shared' || a.status === 'generated'
                                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20"
                                  : a.status === 'dismissed'
                                    ? "bg-slate-500/10 text-slate-600 dark:text-slate-300 border-slate-500/20"
                                    : "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20"
                              )}
                            >
                              {a.status}
                            </span>
                            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" aria-hidden="true" />
                          </button>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Description (inline editable) */}
                <div className="space-y-3 animate-rise-in" style={{ animationDelay: '240ms' }}>
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Description</h3>
                    {!isEditingDescription && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs gap-1"
                        onClick={() => {
                          setEditDescription(activeProject.description || '')
                          setIsEditingDescription(true)
                        }}
                      >
                        <Edit className="h-3 w-3" />
                        Edit
                      </Button>
                    )}
                  </div>
                  {isEditingDescription ? (
                    <div className="space-y-2">
                      <textarea
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                        className="w-full text-sm border rounded-xl px-4 py-3 bg-background min-h-[80px] leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring"
                        placeholder="Add a project description..."
                        autoFocus
                      />
                      <div className="flex items-center gap-2">
                        <Button size="sm" className="h-7 text-xs gap-1" onClick={handleSaveDescription}>
                          <Check className="h-3 w-3" />
                          Save
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => setIsEditingDescription(false)}>
                          <X className="h-3 w-3" />
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm leading-relaxed text-muted-foreground bg-muted/20 p-4 rounded-xl border italic">
                      {activeProject.description || "No description provided for this project."}
                    </p>
                  )}
                </div>

                {/* AI Suggestions */}
                <Card className="animate-rise-in border-primary/20 bg-primary/5" style={{ animationDelay: '270ms' }}>
                  <CardContent className="p-6">
                    <div className="flex items-center gap-2 mb-4">
                      <span title="AI-generated project insight"><Bot className="h-5 w-5 text-primary" aria-hidden="true" /></span>
                      <h3 className="font-bold text-sm uppercase tracking-wider">AI Project Insight</h3>
                    </div>
                    <p className="text-sm leading-relaxed text-muted-foreground italic">
                      AI-generated insights for "{activeProject.name}" will appear here once knowledge items are linked to this project.
                    </p>
                    <div className="mt-4 flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs bg-background"
                        disabled
                        title="Coming soon"
                        onClick={() => toast.info('Coming soon', 'Report generation is not yet available.')}
                      >
                        Generate Status Report
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs bg-background"
                        disabled
                        title="Coming soon"
                        onClick={() => toast.info('Coming soon', 'Decision summarization is not yet available.')}
                      >
                        Summarize Decisions
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                {/* Placeholder for tabs content */}
                <div className="pt-4 text-center py-20 border-2 border-dashed rounded-3xl opacity-30">
                  <Folder className="h-12 w-12 mx-auto mb-4" />
                  <p className="text-sm">Knowledge Timeline and Related People visualization will appear here.</p>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground p-8">
            <div className="w-20 h-20 rounded-3xl bg-muted/20 flex items-center justify-center mb-6">
              <Folder className="h-10 w-10 opacity-20" />
            </div>
            <h2 className="text-xl font-bold text-foreground mb-2">Select a Project</h2>
            <p className="text-sm max-w-xs text-center leading-relaxed">
              Choose a project from the sidebar to view aggregated knowledge, people, and AI insights.
            </p>
            <Button onClick={openCreateDialog} variant="outline" className="mt-8 gap-2">
              <Plus className="h-4 w-4" />
              Create New Project
            </Button>
          </div>
        )
        )}
      </main>

      {/* B-PRJ-006: Create Project Dialog (replaces prompt()) */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Project</DialogTitle>
            <DialogDescription>
              Enter a name for your new project.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium mb-1 block">Project Name</label>
              <Input
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="Enter project name..."
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && createName.trim()) {
                    handleCreateProject()
                  }
                }}
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Description (optional)</label>
              <textarea
                value={createDescription}
                onChange={(e) => setCreateDescription(e.target.value)}
                placeholder="Brief description..."
                className="w-full text-sm border rounded px-3 py-2 bg-background min-h-[60px]"
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button onClick={handleCreateProject} disabled={!createName.trim()}>
              Create Project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* B-PRJ-007: Delete Project AlertDialog (replaces confirm()).
          Doubles as the dismiss confirm for discovered projects (dismissMode). */}
      <AlertDialog
        open={deleteDialogOpen}
        onOpenChange={(open) => { setDeleteDialogOpen(open); if (!open) setDismissMode(false) }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{dismissMode ? 'Dismiss Discovered Project' : 'Delete Project'}</AlertDialogTitle>
            <AlertDialogDescription>
              {dismissMode
                ? `Dismiss "${activeProject?.name}"? It will be deleted and remembered as dismissed, so re-analyzing transcripts won't re-create it. Creating a project with this name manually is still allowed.`
                : `Are you sure you want to delete "${activeProject?.name}"? This will remove all meeting associations for this project. This action cannot be undone.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDeleteProject}
            >
              {dismissMode ? 'Dismiss' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
/** Compact add/toggle/delete list for a project's issues or risks (R3b). */
interface NoteListProps {
  title: string
  icon: ReactNode
  items: ProjectNote[]
  newValue: string
  onNewValueChange: (value: string) => void
  onAdd: () => void
  onToggle: (note: ProjectNote) => void
  onDelete: (id: string) => void
  placeholder: string
}

function NoteList({ title, icon, items, newValue, onNewValueChange, onAdd, onToggle, onDelete, placeholder }: NoteListProps) {
  const openCount = items.filter(i => i.status === 'open').length
  return (
    <Card className="bg-muted/5">
      <CardContent className="p-5 space-y-3">
        <div className="flex items-center gap-2">
          {icon}
          <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">{title}</h3>
          {openCount > 0 && (
            <span className="ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">{openCount} open</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Input
            value={newValue}
            onChange={(e) => onNewValueChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') onAdd() }}
            placeholder={placeholder}
            className="h-8 text-sm"
          />
          <Button size="icon" variant="outline" className="h-8 w-8 shrink-0" onClick={onAdd} disabled={!newValue.trim()} aria-label={`Add ${title}`}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground italic py-1">No {title.toLowerCase()} yet.</p>
        ) : (
          <div className="space-y-1">
            {items.map((item) => (
              <div key={item.id} className="group flex items-center gap-2 py-1">
                <button
                  onClick={() => onToggle(item)}
                  className="shrink-0"
                  aria-label={item.status === 'open' ? 'Mark resolved' : 'Reopen'}
                  title={item.status === 'open' ? 'Mark resolved' : 'Reopen'}
                >
                  {item.status === 'resolved' ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  ) : (
                    <CircleDot className="h-4 w-4 text-muted-foreground hover:text-primary transition-colors" />
                  )}
                </button>
                <span className={cn(
                  "text-sm flex-1 min-w-0",
                  item.status === 'resolved' && "line-through text-muted-foreground"
                )}>
                  {item.content}
                </span>
                <button
                  onClick={() => onDelete(item.id)}
                  className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity shrink-0 text-muted-foreground hover:text-destructive"
                  aria-label={`Delete ${title}`}
                  title="Delete"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export default Projects
