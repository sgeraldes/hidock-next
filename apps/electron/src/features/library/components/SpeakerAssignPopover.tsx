/**
 * SpeakerAssignPopover
 *
 * Renders a transcript speaker label as a subtle button. Clicking it opens a
 * popover to assign the label to a canonical contact — either an existing one
 * (searchable list) or a brand-new person (typed name). When a label is already
 * assigned, the button shows the resolved person's name (entity-styled) and the
 * popover offers an "Unassign" action.
 *
 * Data (speaker map, contacts) is owned by the parent (TranscriptViewer); this
 * component is presentational + interaction only.
 */

import { useMemo, useState } from 'react'
import { Check, UserPlus, X } from 'lucide-react'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
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
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const displayText = assignedName ?? label
  const isAssigned = Boolean(assignedContactId)

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

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (next) {
      setQuery('')
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

  function unassign() {
    onUnassign()
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={isAssigned ? `Speaker: ${displayText} (click to reassign)` : `Assign speaker ${label}`}
          className={
            isAssigned
              ? 'font-semibold text-primary hover:underline decoration-dotted underline-offset-2 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50'
              : 'font-semibold text-foreground/80 hover:text-foreground hover:underline decoration-dotted underline-offset-2 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50'
          }
        >
          {displayText}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <div className="p-2 border-b">
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

        {isAssigned && (
          <div className="p-1 border-b">
            <button
              type="button"
              onClick={unassign}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="h-4 w-4" aria-hidden="true" />
              Unassign {assignedName}
            </button>
          </div>
        )}

        <div className="max-h-56 overflow-y-auto p-1">
          {canCreate && (
            <button
              type="button"
              onClick={assignNew}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-primary hover:bg-accent"
            >
              <UserPlus className="h-4 w-4" aria-hidden="true" />
              Create &ldquo;{trimmed}&rdquo;
            </button>
          )}
          {filtered.length === 0 && !canCreate ? (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">No contacts found</p>
          ) : (
            filtered.map((contact) => (
              <button
                key={contact.id}
                type="button"
                onClick={() => assignContact(contact.id)}
                className="flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-sm text-left hover:bg-accent"
              >
                <span className="min-w-0 flex-1 truncate">
                  {contact.name}
                  {contact.email && (
                    <span className="ml-1 text-xs text-muted-foreground">{contact.email}</span>
                  )}
                </span>
                {contact.id === assignedContactId && <Check className="h-4 w-4 text-primary shrink-0" aria-hidden="true" />}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
