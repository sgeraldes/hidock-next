import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { User, Folder, CalendarDays } from 'lucide-react'
import { cn } from '@/lib/utils'
import { badgeVariants } from '@/components/ui/badge'
import { HoverCard, HoverCardTrigger, HoverCardContent } from '@/components/ui/hover-card'
import { PersonHoverCard, ProjectHoverCard, MeetingHoverCard } from './EntityHoverCards'
import type { PersonHoverField, ProjectHoverField, MeetingHoverField } from './EntityHoverCards'

export type EntityType = 'person' | 'project' | 'meeting' | 'date'

export interface EntityMentionProps {
  type: EntityType
  /** Canonical id (contact id / project id / meeting id). Absent → unresolved. */
  id?: string
  /** Display label. */
  name: string
  /** ISO date string — required for type="date" navigation. */
  date?: string
  /** Show a leading type icon. */
  showIcon?: boolean
  className?: string
  /**
   * Fields the surrounding surface already shows, so the hover card can skip
   * them (incremental disclosure). Defaults to just the label — a mention chip
   * shows only the entity name — so the card surfaces everything else.
   */
  visibleFields?: string[]
}

const ICONS: Record<EntityType, React.ElementType> = {
  person: User,
  project: Folder,
  meeting: CalendarDays,
  date: CalendarDays
}

/**
 * Renders an entity (person / project / meeting / date) as a navigable, hoverable
 * chip. Click navigates to the entity's page; hover/focus shows a quick-stats card
 * (except dates). When the entity can't be resolved to an id, it renders as a
 * subtly-styled non-interactive chip so the text is still visually marked.
 */
export function EntityMention({ type, id, name, date, showIcon = false, className, visibleFields }: EntityMentionProps) {
  const navigate = useNavigate()
  const Icon = ICONS[type]
  const label = name?.trim() || ''

  const resolved = type === 'date' ? Boolean(date) : Boolean(id)

  // Unresolved: styled but inert. Marks the entity without a dead link.
  if (!resolved) {
    return (
      <span
        className={cn(badgeVariants({ variant: 'neutral' }), 'font-normal opacity-75', className)}
        title={label}
      >
        {showIcon && <Icon className="h-3 w-3 shrink-0" />}
        <span className="truncate max-w-[220px]">{label}</span>
      </span>
    )
  }

  const ariaLabel =
    type === 'date' ? `Open calendar on ${label}` : `Open ${type} ${label}`

  const handleClick = () => {
    switch (type) {
      case 'person':
        navigate(`/person/${id}`)
        break
      case 'project':
        navigate('/projects', { state: { selectedId: id } })
        break
      case 'meeting':
        navigate(`/meeting/${id}`)
        break
      case 'date':
        navigate('/calendar', { state: { date } })
        break
    }
  }

  const button = (
    <button
      type="button"
      onClick={handleClick}
      aria-label={ariaLabel}
      className={cn(
        badgeVariants({ variant: type }),
        'cursor-pointer hover:brightness-105 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className
      )}
      title={label}
    >
      {showIcon && <Icon className="h-3 w-3 shrink-0" />}
      <span className="truncate max-w-[220px]">{label}</span>
    </button>
  )

  // Dates have no hover card.
  if (type === 'date') return button

  // A mention chip shows only the label, so by default the card skips just the
  // name/title and surfaces everything else.
  const vf = visibleFields ?? (type === 'meeting' ? ['title'] : ['name'])

  return (
    <HoverCard>
      <HoverCardTrigger asChild>{button}</HoverCardTrigger>
      <HoverCardContent>
        {type === 'person' && <PersonHoverCard id={id!} name={label} visibleFields={vf as PersonHoverField[]} />}
        {type === 'project' && <ProjectHoverCard id={id!} name={label} visibleFields={vf as ProjectHoverField[]} />}
        {type === 'meeting' && <MeetingHoverCard id={id!} name={label} visibleFields={vf as MeetingHoverField[]} />}
      </HoverCardContent>
    </HoverCard>
  )
}

export default EntityMention
