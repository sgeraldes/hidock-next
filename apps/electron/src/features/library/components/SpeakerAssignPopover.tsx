/**
 * SpeakerAssignPopover
 *
 * Renders a transcript speaker label as a subtle button with three interactions:
 *   - Hover / focus  → an informational card (assigned: the person's metadata;
 *                      unassigned: an "unidentified speaker" hint).
 *   - Left click     → opens the assign popover.
 *   - Right click    → opens the same popover (no native context menu).
 *
 * The popover adapts to state:
 *   - Unassigned          → search-or-create picker with rich contact rows.
 *   - Assigned (default)  → a person summary header plus actions: View person,
 *                           Change identity (reveals the picker), and Reset to
 *                           unidentified (clears the assignment — every turn with
 *                           this label reverts to the raw label via the parent's
 *                           re-fetch of the speaker map).
 *
 * Data (speaker map, contacts) is owned by the parent (TranscriptViewer); this
 * component handles presentation + interaction only.
 */

import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, ExternalLink, UserCog, UserPlus, UserX } from 'lucide-react'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { HoverCard, HoverCardTrigger, HoverCardContent } from '@/components/ui/hover-card'
import { PersonHoverCard } from '@/components/entity/EntityHoverCards'
import { Badge } from '@/components/ui/badge'
import type { Person } from '@/types/knowledge'

interface SpeakerAssignPopoverProps {
  /** The raw speaker label from the transcript (e.g. "Speaker 2"). Assignment key. */
  label: string
  /** Resolved contact id for this label, if assigned. */
  assignedContactId?: string
  /** Resolved display name for this label, if assigned. */
  assignedName?: string
  /** All known contacts, for the searchable list. Loaded lazily by the parent. */
  contacts: Person[]
  /** Called when the popover opens, so the parent can lazily load contacts. */
  onOpen: () => void
  /** Assign this label to an existing contact. */
  onAssignContact: (contactId: string) => void
  /** Assign this label to a new person created from the typed name. */
  onAssignNew: (name: string) => void
  /** Remove the current assignment. */
  onUnassign: () => void
}

/** First character of a name, uppercased, for the avatar circle. */
function initialOf(name: string): string {
  const trimmed = name.trim()
  return trimmed ? trimmed[0].toUpperCase() : '?'
}

/** Secondary descriptor line for a contact: "role · company" if present, else email. */
function secondaryLine(contact: Person): string {
  const roleCompany = [contact.role, contact.company].filter(Boolean).join(' · ')
  return roleCompany || contact.email || ''
}

function Avatar({ name, className = '' }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary ${className}`}
    >
      {initialOf(name)}
    </span>
  )
}

/** A rich contact row in the picker: avatar, name, secondary line, meeting count. */
function ContactRow({
  contact,
  selected,
  onSelect
}: {
  contact: Person
  selected: boolean
  onSelect: () => void
}) {
  const secondary = secondaryLine(contact)
  const count = contact.interactionCount
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
    >
      <Avatar name={contact.name} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium leading-tight">{contact.name}</span>
        {secondary && <span className="truncate text-xs text-muted-foreground leading-tight">{secondary}</span>}
      </span>
      {typeof count === 'number' && count > 0 && (
        <span className="shrink-0 text-xs text-muted-foreground">
          {count} meeting{count === 1 ? '' : 's'}
        </span>
      )}
      {selected && <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />}
    </button>
  )
}

/** Compact summary of the currently-assigned person, shown atop the popover. */
function AssignedSummary({ person, fallbackName }: { person?: Person; fallbackName: string }) {
  const name = person?.name ?? fallbackName
  const secondary = person ? secondaryLine(person) : ''
  return (
    <div className="flex items-center gap-2">
      <Avatar name={name} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-semibold leading-tight">{name}</span>
        {secondary && <span className="truncate text-xs text-muted-foreground leading-tight">{secondary}</span>}
      </div>
      {person?.type && (
        <Badge variant="person" className="shrink-0 capitalize">
          {person.type}
        </Badge>
      )}
    </div>
  )
}

/** Hover-card body shown for an unassigned speaker label. */
function UnidentifiedHint({ label }: { label: string }) {
  return (
    <div className="space-y-1">
      <p className="text-sm font-semibold leading-tight">Unidentified speaker</p>
      <p className="text-xs text-muted-foreground">
        {label} hasn&rsquo;t been matched to a person yet. Click to identify.
      </p>
    </div>
  )
}

export function SpeakerAssignPopover({
  label,
  assignedContactId,
  assignedName,
  contacts,
  onOpen,
  onAssignContact,
  onAssignNew,
  onUnassign
}: SpeakerAssignPopoverProps) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  // For an assigned speaker, the picker is hidden behind "Change identity".
  const [changing, setChanging] = useState(false)

  const displayText = assignedName ?? label
  const isAssigned = Boolean(assignedContactId)
  const assignedPerson = useMemo(
    () => (assignedContactId ? contacts.find((c) => c.id === assignedContactId) : undefined),
    [contacts, assignedContactId]
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q
      ? contacts.filter((c) => c.name.toLowerCase().includes(q) || (c.email ?? '').toLowerCase().includes(q))
      : contacts
    return list.slice(0, 50)
  }, [contacts, query])

  // Offer "create new" when the typed name doesn't exactly match an existing contact.
  const trimmed = query.trim()
  const exactMatch = contacts.some((c) => c.name.toLowerCase() === trimmed.toLowerCase())
  const canCreate = trimmed.length >= 2 && !exactMatch

  // Whether the search-or-create picker is visible: always for unassigned, and
  // for assigned only after the user chooses "Change identity".
  const showPicker = !isAssigned || changing

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (next) {
      setQuery('')
      setChanging(false)
      onOpen()
    }
  }

  function assignContact(contactId: string) {
    onAssignContact(contactId)
    setOpen(false)
  }

  function assignNew() {
    if (!canCreate) return
    onAssignNew(trimmed)
    setOpen(false)
  }

  function reset() {
    onUnassign()
    setOpen(false)
  }

  function viewPerson() {
    if (!assignedContactId) return
    setOpen(false)
    navigate(`/person/${assignedContactId}`)
  }

  return (
    <HoverCard suppressed={open}>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <HoverCardTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              onContextMenu={(e) => {
                e.preventDefault()
                if (!open) handleOpenChange(true)
              }}
              aria-label={
                isAssigned
                  ? `Speaker: ${displayText} (click for options)`
                  : `Assign speaker ${label}`
              }
              className={
                isAssigned
                  ? 'font-semibold text-primary hover:underline decoration-dotted underline-offset-2 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50'
                  : 'font-semibold text-foreground/80 hover:text-foreground hover:underline decoration-dotted underline-offset-2 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50'
              }
            >
              {displayText}
            </button>
          </PopoverTrigger>
        </HoverCardTrigger>

        <PopoverContent align="start" className="w-72 p-0">
          {isAssigned && (
            <div className="border-b p-2">
              <AssignedSummary person={assignedPerson} fallbackName={displayText} />
              <div className="mt-2 grid gap-0.5">
                <button
                  type="button"
                  onClick={viewPerson}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                >
                  <ExternalLink className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  View person
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setChanging(true)
                    setQuery('')
                  }}
                  aria-expanded={changing}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                >
                  <UserCog className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  Change identity
                </button>
                <button
                  type="button"
                  onClick={reset}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:outline-none"
                >
                  <UserX className="h-4 w-4" aria-hidden="true" />
                  Reset to unidentified
                </button>
              </div>
            </div>
          )}

          {showPicker && (
            <>
              <div className="border-b p-2">
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search or create person..."
                  aria-label="Search or create person"
                  className="w-full text-sm px-2 py-1.5 rounded border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                  autoFocus
                />
              </div>

              <div className="max-h-56 overflow-y-auto p-1">
                {canCreate && (
                  <button
                    type="button"
                    onClick={assignNew}
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-primary hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                  >
                    <UserPlus className="h-4 w-4" aria-hidden="true" />
                    Create &ldquo;{trimmed}&rdquo;
                  </button>
                )}
                {filtered.length === 0 && !canCreate ? (
                  <p className="px-2 py-3 text-center text-xs text-muted-foreground">No contacts found</p>
                ) : (
                  filtered.map((contact) => (
                    <ContactRow
                      key={contact.id}
                      contact={contact}
                      selected={contact.id === assignedContactId}
                      onSelect={() => assignContact(contact.id)}
                    />
                  ))
                )}
              </div>
            </>
          )}
        </PopoverContent>
      </Popover>

      <HoverCardContent align="start" className="w-64">
        {isAssigned && assignedContactId ? (
          <PersonHoverCard id={assignedContactId} name={displayText} />
        ) : (
          <UnidentifiedHint label={label} />
        )}
      </HoverCardContent>
    </HoverCard>
  )
}
