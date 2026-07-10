import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  X,
  ArrowUpRight,
  Crosshair,
  Pencil,
  UserPlus,
  Link2,
  GitMerge,
  Trash2,
  FileText,
  Users,
  FolderKanban,
  ListChecks,
  Loader2,
  Check,
  AlertTriangle,
  BadgeCheck,
  Sparkle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from '@/components/ui/toaster'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog'
import { entityColor } from './graph-theme'
import type { NodeDetail, Provenance, ProvenanceEntity, MergePreview, ContextGraphNode } from './types'
import { MergeIntoDialog } from '@/components/identity/MergeIntoDialog'

interface OpenTarget {
  type: string
  contactId?: string
  meetingId?: string
  projectId?: string
}

interface NodeInspectorProps {
  /** The graph node id being inspected. */
  nodeId: string
  /** Immediate header info before detail loads (from the clicked node). */
  fallback?: { type: string; label: string } | null
  isDark: boolean
  /** Center/pan-to the node in the canvas. */
  onLocate: (node: { id: string; type: string; label: string }) => void
  /** Navigate to an entity's detail page (person/meeting/project). */
  onOpenEntity: (target: OpenTarget) => void
  /** True when an entity has a dedicated page. */
  canOpen: (target: OpenTarget) => boolean
  /** Focus an entity in the current view (non-navigating). */
  onFocusEntity?: (entity: ProvenanceEntity) => void
  /** Called after the graph mutates so the parent can refresh. When a node was
   *  merged/renamed into another, `keeperId` is the surviving id; `removed` marks
   *  a deletion so the parent can clear its selection. */
  onChanged: (info: { keeperId?: string | null; removed?: boolean }) => void
  /** Provenance loaded — lets the parent highlight the evidence path. */
  onProvenanceLoaded?: (prov: Provenance | null) => void
  onClose: () => void
}

function formatDate(ms: number | null): string {
  if (ms == null) return ''
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

/** A labelled fact row in the "what this is" grid. */
function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground shrink-0">{label}</span>
      <span className="text-sm text-foreground text-right min-w-0 break-words">{value}</span>
    </div>
  )
}

const PRONOUN_PRESETS = ['He/Him', 'She/Her', 'They/Them']

/**
 * The node inspector: what a person (or any entity) IS, where it comes from, and
 * every edit the graph allows. Discoverability (identity + stats + aliases),
 * clickability (navigable sources), editability (rename-as-correction, convert to
 * contact, set identity, pronouns), and navigability (locate, merge, remove) —
 * all routed through the existing identity platform.
 */
export function NodeInspector({
  nodeId,
  fallback,
  isDark,
  onLocate,
  onOpenEntity,
  canOpen,
  onFocusEntity,
  onChanged,
  onProvenanceLoaded,
  onClose,
}: NodeInspectorProps) {
  const [detail, setDetail] = useState<NodeDetail | null>(null)
  const [provenance, setProvenance] = useState<Provenance | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  // Editors / dialogs
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [editingPronouns, setEditingPronouns] = useState(false)
  const [pronounValue, setPronounValue] = useState('')
  const [confirmConvert, setConfirmConvert] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)
  const [mergeOpen, setMergeOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [detRes, provRes] = await Promise.all([
        window.electronAPI.contextGraph.nodeDetail(nodeId),
        window.electronAPI.contextGraph.provenance(nodeId),
      ])
      const det = detRes.success && detRes.data ? detRes.data : null
      setDetail(det)
      const prov = provRes.success && provRes.data ? (provRes.data as Provenance) : null
      setProvenance(prov)
      onProvenanceLoaded?.(prov)
    } catch {
      setDetail(null)
      setProvenance(null)
      onProvenanceLoaded?.(null)
    } finally {
      setLoading(false)
    }
  }, [nodeId, onProvenanceLoaded])

  useEffect(() => {
    void load()
  }, [load])

  const node = detail?.node ?? null
  const type = node?.type ?? fallback?.type ?? 'entity'
  const label = node?.label ?? fallback?.label ?? '…'
  const color = isDark ? entityColor(type).dark : entityColor(type).light
  const isPerson = type === 'person'
  const linked = detail?.linked ?? false
  const openTarget: OpenTarget | null = node
    ? { type: node.type, contactId: node.contactId, meetingId: node.meetingId, projectId: node.projectId }
    : null

  const refreshAfter = useCallback(
    (info: { keeperId?: string | null; removed?: boolean }) => {
      onChanged(info)
      if (!info.removed) void load()
    },
    [onChanged, load]
  )

  // ---- Actions -------------------------------------------------------------
  const doRename = useCallback(async () => {
    const next = renameValue.trim()
    if (!next || !node) return
    setBusy(true)
    try {
      const res = await window.electronAPI.contextGraph.rename(node.id, next)
      if (res.success && res.data) {
        const { outcome, scope, nodeId: keeperId } = res.data
        if (outcome === 'noop') {
          toast.info('No change', 'The name is already correct.')
        } else if (outcome === 'merged') {
          toast.success('Names merged', `"${label}" folded into the existing "${next}".`)
        } else {
          toast.success(
            'Name corrected',
            scope === 'contact'
              ? `Updated everywhere "${label}" appears → "${next}".`
              : `Corrected in the graph → "${next}".`
          )
        }
        setRenaming(false)
        refreshAfter({ keeperId })
      } else {
        toast.error('Rename failed', res.error ?? 'Unexpected error')
      }
    } catch (e) {
      toast.error('Rename failed', e instanceof Error ? e.message : 'Unexpected error')
    } finally {
      setBusy(false)
    }
  }, [renameValue, node, label, refreshAfter])

  const doSetPronouns = useCallback(
    async (value: string) => {
      if (!node) return
      setBusy(true)
      try {
        const res = await window.electronAPI.contextGraph.setPronouns(node.id, value)
        if (res.success) {
          toast.success(value ? 'Pronouns set' : 'Pronouns cleared', value ? `${label}: ${value}` : undefined)
          setEditingPronouns(false)
          refreshAfter({})
        } else {
          toast.error('Could not set pronouns', res.error ?? 'Unexpected error')
        }
      } finally {
        setBusy(false)
      }
    },
    [node, label, refreshAfter]
  )

  const doConvert = useCallback(async () => {
    if (!node) return
    setBusy(true)
    try {
      const res = await window.electronAPI.contextGraph.convertToContact(node.id)
      if (res.success && res.data) {
        toast.success(
          res.data.reusedExisting ? 'Linked to existing contact' : 'Contact created',
          `"${label}" is now a saved contact.`
        )
        setConfirmConvert(false)
        refreshAfter({ keeperId: res.data.nodeId })
      } else {
        toast.error('Could not convert', res.error ?? 'Unexpected error')
      }
    } catch (e) {
      toast.error('Could not convert', e instanceof Error ? e.message : 'Unexpected error')
    } finally {
      setBusy(false)
    }
  }, [node, label, refreshAfter])

  const doLink = useCallback(
    async (contactId: string, contactName: string) => {
      if (!node) return
      setBusy(true)
      try {
        const res = await window.electronAPI.contextGraph.linkContact(node.id, contactId)
        if (res.success && res.data) {
          toast.success('Identity set', `"${label}" is ${contactName}.`)
          refreshAfter({ keeperId: res.data.nodeId })
        } else {
          toast.error('Could not set identity', res.error ?? 'Unexpected error')
        }
      } finally {
        setBusy(false)
      }
    },
    [node, label, refreshAfter]
  )

  const doDelete = useCallback(async () => {
    if (!node) return
    setBusy(true)
    try {
      const res = await window.electronAPI.contextGraph.deleteNode(node.id)
      if (res.success && res.data?.removed) {
        toast.success('Removed', `"${label}" and ${res.data.removedEdges} link(s) removed from the graph.`)
        setConfirmDelete(false)
        onProvenanceLoaded?.(null)
        refreshAfter({ removed: true })
      } else {
        toast.error('Could not remove', res.error ?? 'Nothing to remove')
      }
    } finally {
      setBusy(false)
    }
  }, [node, label, refreshAfter, onProvenanceLoaded])

  const onMerged = useCallback(
    (keeperId: string, loserLabel: string) => {
      toast.success('Merged', `"${loserLabel}" folded into "${label}".`)
      onProvenanceLoaded?.(null)
      refreshAfter({ keeperId })
    },
    [label, refreshAfter, onProvenanceLoaded]
  )

  // ---- Render --------------------------------------------------------------
  const sources: Array<{ key: string; title: string; icon: typeof FileText; items: ProvenanceEntity[] }> = useMemo(
    () => [
      { key: 'meetings', title: 'Appears in', icon: FileText, items: provenance?.meetings ?? [] },
      { key: 'people', title: 'With', icon: Users, items: provenance?.people ?? [] },
      { key: 'projects', title: 'Projects', icon: FolderKanban, items: provenance?.projects ?? [] },
      { key: 'actions', title: 'Led to', icon: ListChecks, items: provenance?.actions ?? [] },
    ],
    [provenance]
  )

  return (
    <aside className="w-80 shrink-0 border-l bg-muted/5 flex flex-col overflow-hidden" aria-label="Node details">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 border-b px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: color }} />
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {type.replace(/_/g, ' ')}
            </span>
            {isPerson &&
              (linked ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                  <BadgeCheck className="h-3 w-3" />
                  Linked contact
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                  <Sparkle className="h-3 w-3" />
                  Extracted name
                </span>
              ))}
          </div>
          <h3 className="text-sm font-semibold mt-1 break-words leading-snug">{label}</h3>
          {detail?.pronouns && (
            <span className="mt-1 inline-block rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
              {detail.pronouns}
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
          aria-label="Close details"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="px-4 py-3 space-y-4 overflow-auto">
        {loading && !detail ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          <>
            {/* What this is — net-new identity facts, never a re-print of the label. */}
            <section aria-label="Identity" className="rounded-lg border bg-background/40 px-3 py-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                What this is
              </p>
              {isPerson && !linked && (
                <p className="text-xs text-muted-foreground mb-2 leading-relaxed">
                  A name pulled from transcripts — not a saved contact yet. Convert it or set its identity to
                  make it real.
                </p>
              )}
              <div className="divide-y divide-border/50">
                {detail?.role && <Fact label="Role" value={detail.role} />}
                {detail?.company && <Fact label="Org" value={detail.company} />}
                {detail?.email && <Fact label="Email" value={detail.email} />}
                <Fact
                  label="Meetings"
                  value={<span className="tabular-nums">{detail?.meetingCount ?? 0}</span>}
                />
                {(detail?.firstSeenMs || detail?.lastSeenMs) && (
                  <Fact
                    label="Seen"
                    value={
                      <span className="tabular-nums">
                        {formatDate(detail?.firstSeenMs ?? null)}
                        {detail?.firstSeenMs && detail?.lastSeenMs && detail.firstSeenMs !== detail.lastSeenMs
                          ? ` → ${formatDate(detail?.lastSeenMs ?? null)}`
                          : ''}
                      </span>
                    }
                  />
                )}
                {(detail?.peopleCount ?? 0) + (detail?.projectCount ?? 0) > 0 && (
                  <Fact
                    label="Connections"
                    value={
                      <span className="tabular-nums">
                        {[
                          detail?.peopleCount ? `${detail.peopleCount} people` : '',
                          detail?.projectCount ? `${detail.projectCount} projects` : '',
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    }
                  />
                )}
              </div>
              {detail && detail.aliases.length > 0 && (
                <div className="mt-2">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Also known as</p>
                  <div className="flex flex-wrap gap-1">
                    {detail.aliases.map((a) => (
                      <span key={a} className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                        {a}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </section>

            {/* Narrative */}
            {provenance?.narrative && (
              <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 px-3 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-violet-600 dark:text-violet-300 mb-1">
                  Why this is here
                </p>
                <p className="text-sm leading-relaxed text-foreground">{provenance.narrative}</p>
              </div>
            )}

            {/* Actions */}
            <section aria-label="Actions" className="space-y-2">
              {renaming ? (
                <div className="rounded-lg border p-2 space-y-2">
                  <label htmlFor="ni-rename" className="text-[11px] font-medium text-muted-foreground">
                    Correct the name {linked ? '(updates the contact everywhere)' : '(fixes it across the graph)'}
                  </label>
                  <Input
                    id="ni-rename"
                    value={renameValue}
                    autoFocus
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void doRename()
                      if (e.key === 'Escape') setRenaming(false)
                    }}
                    aria-label="New name"
                  />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={doRename} disabled={busy || !renameValue.trim()} className="gap-1.5">
                      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                      Save correction
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setRenaming(false)} disabled={busy}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : editingPronouns ? (
                <div className="rounded-lg border p-2 space-y-2">
                  <p className="text-[11px] font-medium text-muted-foreground">Set pronouns</p>
                  <div className="flex flex-wrap gap-1.5">
                    {PRONOUN_PRESETS.map((p) => (
                      <Button key={p} size="sm" variant="outline" onClick={() => void doSetPronouns(p)} disabled={busy}>
                        {p}
                      </Button>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Input
                      value={pronounValue}
                      placeholder="Custom…"
                      onChange={(e) => setPronounValue(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && void doSetPronouns(pronounValue)}
                      aria-label="Custom pronouns"
                    />
                    <Button size="sm" variant="ghost" onClick={() => setEditingPronouns(false)} disabled={busy}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => node && onLocate({ id: node.id, type: node.type, label: node.label })}
                  >
                    <Crosshair className="h-3.5 w-3.5" />
                    Locate
                  </Button>
                  {openTarget && canOpen(openTarget) && (
                    <Button variant="outline" size="sm" className="gap-1.5" onClick={() => onOpenEntity(openTarget)}>
                      <ArrowUpRight className="h-3.5 w-3.5" />
                      Open page
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => {
                      setRenameValue(label)
                      setRenaming(true)
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Rename
                  </Button>
                  {isPerson && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => {
                        setPronounValue(detail?.pronouns ?? '')
                        setEditingPronouns(true)
                      }}
                    >
                      <BadgeCheck className="h-3.5 w-3.5" />
                      Pronouns
                    </Button>
                  )}
                  {isPerson && !linked && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => setConfirmConvert(true)}
                    >
                      <UserPlus className="h-3.5 w-3.5" />
                      To contact
                    </Button>
                  )}
                  {isPerson && !linked && (
                    <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setLinkOpen(true)}>
                      <Link2 className="h-3.5 w-3.5" />
                      Set identity
                    </Button>
                  )}
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setMergeOpen(true)}>
                    <GitMerge className="h-3.5 w-3.5" />
                    Merge
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 text-destructive hover:text-destructive"
                    onClick={() => setConfirmDelete(true)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Remove
                  </Button>
                </div>
              )}
            </section>

            {/* Clickable sources */}
            {sources.some((s) => s.items.length > 0) && (
              <section aria-label="Sources" className="space-y-3">
                {sources.map(({ key, title, icon: Icon, items }) =>
                  items.length === 0 ? null : (
                    <div key={key}>
                      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                        <Icon className="h-3.5 w-3.5" />
                        {title} ({items.length})
                      </p>
                      <ul className="space-y-0.5">
                        {items.map((e, i) => {
                          const navigable = canOpen({
                            type: e.type,
                            contactId: e.contactId,
                            meetingId: e.meetingId,
                            projectId: e.projectId,
                          })
                          return (
                            <li key={`${e.id}-${i}`}>
                              <button
                                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group"
                                onClick={() =>
                                  navigable
                                    ? onOpenEntity({
                                        type: e.type,
                                        contactId: e.contactId,
                                        meetingId: e.meetingId,
                                        projectId: e.projectId,
                                      })
                                    : onFocusEntity?.(e)
                                }
                                title={navigable ? `Open ${e.type.replace(/_/g, ' ')}` : 'Focus in graph'}
                                aria-label={`${navigable ? 'Open' : 'Focus'} ${e.label}`}
                              >
                                <span
                                  className="h-2 w-2 rounded-full shrink-0"
                                  style={{ backgroundColor: isDark ? entityColor(e.type).dark : entityColor(e.type).light }}
                                />
                                <span className="truncate flex-1">{e.label}</span>
                                {e.dateMs != null && (
                                  <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">
                                    {formatDate(e.dateMs)}
                                  </span>
                                )}
                                {navigable && (
                                  <ArrowUpRight className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100" />
                                )}
                              </button>
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  )
                )}
              </section>
            )}
          </>
        )}
      </div>

      {/* Convert-to-contact confirm */}
      <AlertDialog open={confirmConvert} onOpenChange={setConfirmConvert}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Make &ldquo;{label}&rdquo; a contact?</AlertDialogTitle>
            <AlertDialogDescription>
              This creates a real, saved contact from this extracted name and binds every mention of it to that
              contact. You can add role and company on the person page afterwards.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); void doConvert() }} disabled={busy}>
              {busy ? 'Creating…' : 'Create contact'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Remove confirm */}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove &ldquo;{label}&rdquo; from the graph?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes the node and its {detail?.degree ?? 0} link(s) from the context graph. It does not
              delete any meeting, recording, or contact — only this graph node.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); void doDelete() }}
              disabled={busy}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {busy ? 'Removing…' : 'Remove'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Set identity — reuse the contacts picker */}
      {node && (
        <MergeIntoDialog
          open={linkOpen}
          onOpenChange={setLinkOpen}
          loserName={label}
          excludeIds={detail?.contactId ? [detail.contactId] : []}
          onPick={(contactId, contactName) => void doLink(contactId, contactName)}
        />
      )}

      {/* Merge two nodes */}
      {node && (
        <MergeNodeDialog
          open={mergeOpen}
          onOpenChange={setMergeOpen}
          keeper={{ id: node.id, label, type }}
          isDark={isDark}
          onMerged={onMerged}
        />
      )}
    </aside>
  )
}

// ===========================================================================
// MergeNodeDialog — pick a second node, preview the blast radius, then commit.
// ===========================================================================

interface MergeNodeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  keeper: { id: string; label: string; type: string }
  isDark: boolean
  onMerged: (keeperId: string, loserLabel: string) => void
}

function MergeNodeDialog({ open, onOpenChange, keeper, isDark, onMerged }: MergeNodeDialogProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ContextGraphNode[]>([])
  const [picked, setPicked] = useState<ContextGraphNode | null>(null)
  const [preview, setPreview] = useState<MergePreview | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) {
      setQuery('')
      setResults([])
      setPicked(null)
      setPreview(null)
    }
  }, [open])

  useEffect(() => {
    if (!open || picked) return
    let cancelled = false
    const t = setTimeout(async () => {
      const q = query.trim()
      if (!q) return setResults([])
      const res = await window.electronAPI.contextGraph.search(q)
      if (cancelled) return
      const list = res.success && res.data ? res.data : []
      // Same type, never the keeper itself.
      setResults(list.filter((n) => n.type === keeper.type && n.id !== keeper.id).slice(0, 8))
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [query, open, picked, keeper.id, keeper.type])

  const choose = useCallback(
    async (n: ContextGraphNode) => {
      setPicked(n)
      const res = await window.electronAPI.contextGraph.mergePreview(keeper.id, n.id)
      if (res.success && res.data) setPreview(res.data)
    },
    [keeper.id]
  )

  const commit = useCallback(async () => {
    if (!picked) return
    setBusy(true)
    try {
      const res = await window.electronAPI.contextGraph.mergeNodes(keeper.id, picked.id)
      if (res.success && res.data) {
        onMerged(res.data.keeperId, picked.label)
        onOpenChange(false)
      } else {
        toast.error('Merge failed', res.error ?? 'Unexpected error')
      }
    } finally {
      setBusy(false)
    }
  }, [picked, keeper.id, onMerged, onOpenChange])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Merge into &ldquo;{keeper.label}&rdquo;</DialogTitle>
          <DialogDescription>
            Fold another {keeper.type.replace(/_/g, ' ')} that is the same as &ldquo;{keeper.label}&rdquo; into it.
            &ldquo;{keeper.label}&rdquo; is kept.
          </DialogDescription>
        </DialogHeader>

        {!picked ? (
          <>
            <Input
              value={query}
              autoFocus
              placeholder={`Search a ${keeper.type.replace(/_/g, ' ')}…`}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search a node to merge"
            />
            <div className="max-h-64 overflow-y-auto -mx-1 px-1">
              {results.length === 0 ? (
                <p className="px-2 py-4 text-center text-xs text-muted-foreground">
                  {query.trim() ? 'No matching nodes' : 'Type to search'}
                </p>
              ) : (
                results.map((n) => (
                  <button
                    key={n.id}
                    onClick={() => void choose(n)}
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: isDark ? entityColor(n.type).dark : entityColor(n.type).light }}
                    />
                    <span className="truncate flex-1">{n.label}</span>
                  </button>
                ))
              )}
            </div>
          </>
        ) : (
          <div className="space-y-3">
            {/* Blast radius — WHAT gets merged, before committing. */}
            <div className="rounded-lg border p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-medium">{picked.label}</span>
                <span className="text-muted-foreground shrink-0">→</span>
                <span className="truncate font-medium">{keeper.label}</span>
              </div>
              {preview ? (
                <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                  <p>
                    <span className="tabular-nums text-foreground">{preview.b?.edges ?? 0}</span> link(s) from
                    &ldquo;{picked.label}&rdquo; move onto &ldquo;{keeper.label}&rdquo;.
                  </p>
                  {preview.shared > 0 && (
                    <p>
                      <span className="tabular-nums text-foreground">{preview.shared}</span> shared connection(s)
                      collapse into one.
                    </p>
                  )}
                  <p>
                    Result: <span className="tabular-nums text-foreground">{preview.resulting}</span> link(s) on
                    the kept node.
                  </p>
                  {preview.contactMerge && (
                    <p className="flex items-start gap-1.5 rounded bg-amber-500/10 px-2 py-1 text-amber-700 dark:text-amber-400">
                      <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                      Both are saved contacts — this merges the contacts too (undoable from the person page).
                    </p>
                  )}
                </div>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground flex items-center gap-1.5">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Computing impact…
                </p>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          {picked && (
            <Button variant="ghost" size="sm" onClick={() => { setPicked(null); setPreview(null) }} disabled={busy}>
              Back
            </Button>
          )}
          <Button size="sm" onClick={commit} disabled={!picked || busy} className="gap-1.5">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitMerge className="h-3.5 w-3.5" />}
            Merge
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default NodeInspector
