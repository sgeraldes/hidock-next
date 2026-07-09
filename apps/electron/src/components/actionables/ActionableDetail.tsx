import { useEffect, useState, type ElementType, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileText, Sparkles, Clock, Users, CalendarDays, ArrowRight } from 'lucide-react'
import { formatDateTime } from '@/lib/utils'
import { EntityMention, type ResolvedContact } from '@/components/entity'
import { getTemplateInfo, OUTPUT_DESTINATION } from './templateInfo'
import type { Actionable, KnowledgeCapture } from '@/types/knowledge'

interface ActionableDetailProps {
  actionable: Actionable
  /** Resolver from the parent's useContactResolver — reused so we hit one cache. */
  resolveRecipient: (value?: string | null) => ResolvedContact | undefined
}

function DetailSection({
  icon: Icon,
  label,
  children
}: {
  icon: ElementType
  label: string
  children: ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        <Icon className="h-3 w-3" />
        <span>{label}</span>
      </div>
      <div className="text-sm text-foreground/90">{children}</div>
    </div>
  )
}

/**
 * Inline detail panel shown when an actionable card is expanded. Surfaces the
 * evidence a user needs BEFORE approving: the full (never-truncated) title and
 * quote, the concrete output that "Generate" will produce and where it lands,
 * the clickable source meeting/recording, recipients, and the detected date.
 */
export function ActionableDetail({ actionable, resolveRecipient }: ActionableDetailProps) {
  const navigate = useNavigate()
  const [source, setSource] = useState<KnowledgeCapture | null>(null)
  const [sourceLoading, setSourceLoading] = useState(true)

  const template = getTemplateInfo(actionable.suggestedTemplate)

  // Lazily fetch the source knowledge capture only when the card is expanded
  // (this component mounts on expand), so collapsed cards make no extra IPC call.
  useEffect(() => {
    let cancelled = false
    setSourceLoading(true)
    window.electronAPI.knowledge
      .getById(actionable.sourceKnowledgeId)
      .then((kc) => {
        if (!cancelled) setSource(kc)
      })
      .catch(() => {
        if (!cancelled) setSource(null)
      })
      .finally(() => {
        if (!cancelled) setSourceLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [actionable.sourceKnowledgeId])

  const sourceTitle = source?.title?.trim() || 'Source recording'
  const sourceDate = source?.capturedAt ? formatDateTime(source.capturedAt) : null

  return (
    <div className="mt-4 border-t pt-4 space-y-4">
      {/* Full description / quote — never truncated here */}
      {actionable.description && (
        <DetailSection icon={FileText} label="What was detected">
          <p className="italic text-muted-foreground leading-relaxed whitespace-pre-wrap">
            "{actionable.description}"
          </p>
        </DetailSection>
      )}

      {/* Generate WHAT — the concrete outcome before approval */}
      <DetailSection icon={Sparkles} label="Will generate">
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold">{template.name}</span>
            <span className="text-[10px] font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
              {template.format}
            </span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">{template.description}</p>
          <p className="text-xs text-muted-foreground/80 leading-relaxed pt-1">{OUTPUT_DESTINATION}</p>
        </div>
      </DetailSection>

      {/* Source — clickable meeting (hover card) or recording link */}
      <DetailSection icon={CalendarDays} label="Source">
        {sourceLoading ? (
          <span className="text-xs text-muted-foreground">Loading source…</span>
        ) : source?.meetingId ? (
          <span className="inline-flex items-center gap-1.5 flex-wrap">
            <EntityMention type="meeting" id={source.meetingId} name={sourceTitle} showIcon />
            {sourceDate && <span className="text-xs text-muted-foreground">· {sourceDate}</span>}
          </span>
        ) : source?.sourceRecordingId ? (
          <button
            type="button"
            onClick={() =>
              navigate('/library', { state: { selectedId: source.sourceRecordingId } })
            }
            className="inline-flex items-center gap-1.5 text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
          >
            <FileText className="h-3.5 w-3.5 shrink-0" />
            <span className="font-medium">{sourceTitle}</span>
            {sourceDate && <span className="text-xs text-muted-foreground">· {sourceDate}</span>}
            <ArrowRight className="h-3 w-3 shrink-0 opacity-60" />
          </button>
        ) : (
          <span className="text-xs text-muted-foreground">{sourceTitle}{sourceDate ? ` · ${sourceDate}` : ''}</span>
        )}
      </DetailSection>

      {/* Recipients — resolver-backed person chips */}
      {actionable.suggestedRecipients.length > 0 && (
        <DetailSection icon={Users} label="Recipients">
          <div className="flex items-center gap-1.5 flex-wrap">
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
        </DetailSection>
      )}

      {/* Detected date */}
      <DetailSection icon={Clock} label="Detected">
        <span className="text-sm text-muted-foreground">{formatDateTime(actionable.createdAt)}</span>
      </DetailSection>
    </div>
  )
}

export default ActionableDetail
