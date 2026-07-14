/**
 * MergeIntoDialog — the "different person…" third door (B7 beyond-binary escape).
 *
 * When neither name on a merge card is the right keeper (e.g. "Sebastian Herrera"
 * vs "Sebastian Geraldes"), a yes/no forces an error. This dialog lets the user
 * pick the ACTUAL person to fold the reviewed duplicate into — a searchable contact
 * list with the same rich rows the speaker-assign picker uses. The chosen contact
 * becomes the merge keeper.
 */

import { useEffect, useMemo, useState } from 'react'
import { Check, Search } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { cleanRole } from '@/lib/roleHygiene'

/** Minimal contact shape the picker needs (from contacts:getAll). */
interface PickerContact {
  id: string
  name: string
  role?: string | null
  company?: string | null
  email?: string | null
  meeting_count?: number | null
}

function initialOf(name: string): string {
  const t = name.trim()
  return t ? t[0].toUpperCase() : '?'
}

function secondaryLine(c: PickerContact): string {
  const roleCompany = [cleanRole(c.role), c.company].filter(Boolean).join(' · ')
  return roleCompany || c.email || ''
}

function ContactRow({ contact, onSelect }: { contact: PickerContact; onSelect: () => void }) {
  const secondary = secondaryLine(contact)
  const count = contact.meeting_count ?? 0
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
    >
      <span
        aria-hidden="true"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary"
      >
        {initialOf(contact.name)}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium leading-tight">{contact.name}</span>
        {secondary && <span className="truncate text-xs text-muted-foreground leading-tight">{secondary}</span>}
      </span>
      {count > 0 && (
        <span className="shrink-0 text-xs text-muted-foreground">
          {count} meeting{count === 1 ? '' : 's'}
        </span>
      )}
      <Check className="h-4 w-4 shrink-0 text-transparent" aria-hidden="true" />
    </button>
  )
}

interface MergeIntoDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The name of the duplicate being reassigned — shown for context. */
  loserName: string
  /** Contact ids to hide from the list (the duplicate itself and the suggested keeper). */
  excludeIds: string[]
  /** Called with the chosen keeper contact when the user picks one. */
  onPick: (contactId: string, contactName: string) => void
}

/**
 * Searchable contact picker. Loads contacts on open (and on each query change),
 * filters out the excluded ids, and calls `onPick` with the chosen keeper.
 */
export function MergeIntoDialog({ open, onOpenChange, loserName, excludeIds, onPick }: MergeIntoDialogProps) {
  const [query, setQuery] = useState('')
  const [contacts, setContacts] = useState<PickerContact[]>([])
  const [loading, setLoading] = useState(false)
  const exclude = useMemo(() => new Set(excludeIds), [excludeIds])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        const res = await window.electronAPI.contacts.getAll({ search: query.trim() || undefined, limit: 50 })
        const list =
          res.success && res.data ? ((res.data.contacts as unknown as PickerContact[]) ?? []) : []
        if (!cancelled) setContacts(list)
      } catch {
        if (!cancelled) setContacts([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, query])

  // Reset the query whenever the dialog reopens.
  useEffect(() => {
    if (open) setQuery('')
  }, [open])

  const visible = contacts.filter((c) => !exclude.has(c.id)).slice(0, 50)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Merge into someone else</DialogTitle>
          <DialogDescription>
            Fold &lsquo;{loserName}&rsquo; into the person it really is. Pick the correct keeper.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search people…"
            aria-label="Search people"
            autoFocus
            className="w-full rounded-md border bg-background py-1.5 pl-8 pr-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        <div className="max-h-72 overflow-y-auto -mx-1 px-1">
          {loading ? (
            <p className="px-2 py-4 text-center text-xs text-muted-foreground">Loading…</p>
          ) : visible.length === 0 ? (
            <p className="px-2 py-4 text-center text-xs text-muted-foreground">No matching people</p>
          ) : (
            visible.map((c) => (
              <ContactRow
                key={c.id}
                contact={c}
                onSelect={() => {
                  onPick(c.id, c.name)
                  onOpenChange(false)
                }}
              />
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default MergeIntoDialog
