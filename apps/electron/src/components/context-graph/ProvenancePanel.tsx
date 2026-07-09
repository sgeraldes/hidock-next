import { X, ArrowUpRight, FileText, Users, FolderKanban, ListChecks, Crosshair } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { entityColor } from './graph-theme'
import type { Provenance, ProvenanceEntity } from './types'

interface ProvenancePanelProps {
  provenance: Provenance
  isDark: boolean
  /** Recenter the lens on / focus an entity. */
  onFocus: (entity: ProvenanceEntity) => void
  /** Navigate to an entity's detail page (person/meeting/project). */
  onOpen: (entity: ProvenanceEntity) => void
  /** True when the entity has a dedicated page. */
  canOpen: (entity: ProvenanceEntity) => boolean
  onClose: () => void
}

function formatDate(ms: number | null): string {
  if (ms == null) return ''
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

/**
 * The provenance trail: WHY a node exists. A one-line narrative
 * ("Decided in <meeting> · <date> · with <people>") over the grouped evidence
 * path — the meetings it emerged from, the people present, the project it
 * belongs to, and the actions it led to. Every entity is a click-through.
 */
export function ProvenancePanel({
  provenance,
  isDark,
  onFocus,
  onOpen,
  canOpen,
  onClose,
}: ProvenancePanelProps) {
  const node = provenance.node
  if (!node) return null

  const color = isDark ? entityColor(node.type).dark : entityColor(node.type).light

  const sections: Array<{ key: string; title: string; icon: typeof FileText; items: ProvenanceEntity[] }> = [
    { key: 'meetings', title: 'Evidence', icon: FileText, items: provenance.meetings },
    { key: 'people', title: 'People', icon: Users, items: provenance.people },
    { key: 'projects', title: 'Projects', icon: FolderKanban, items: provenance.projects },
    { key: 'actions', title: 'Led to', icon: ListChecks, items: provenance.actions },
  ]

  return (
    <aside className="w-80 shrink-0 border-l bg-muted/5 flex flex-col overflow-hidden">
      <div className="flex items-start justify-between gap-2 border-b px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: color }} />
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {node.type.replace(/_/g, ' ')}
            </span>
          </div>
          <h3 className="text-sm font-semibold mt-1 break-words leading-snug">{node.label}</h3>
        </div>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground shrink-0"
          aria-label="Close provenance"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="px-4 py-3 space-y-4 overflow-auto">
        {/* Narrative — the "why", in one line. */}
        {provenance.narrative && (
          <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-violet-600 dark:text-violet-300 mb-1">
              Why this is here
            </p>
            <p className="text-sm leading-relaxed text-foreground">{provenance.narrative}</p>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {canOpen(node) && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => onOpen(node)}>
              <ArrowUpRight className="h-3.5 w-3.5" />
              Open {node.type} page
            </Button>
          )}
          <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={() => onFocus(node)}>
            <Crosshair className="h-3.5 w-3.5" />
            Center lens here
          </Button>
        </div>

        {sections.map(({ key, title, icon: Icon, items }) =>
          items.length === 0 ? null : (
            <div key={key}>
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                <Icon className="h-3.5 w-3.5" />
                {title} ({items.length})
              </p>
              <ul className="space-y-0.5">
                {items.map((e, i) => (
                  <li key={`${e.id}-${i}`}>
                    <button
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/60'
                      )}
                      onClick={() => onFocus(e)}
                      title="Focus in lens"
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
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )
        )}
      </div>
    </aside>
  )
}

export default ProvenancePanel
