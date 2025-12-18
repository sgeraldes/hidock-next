/**
 * People Page
 *
 * Displays people extracted from meetings with search, selection, and notes.
 */

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, User, Mail, Calendar, FileText, X, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useContactsStore } from '@/store'
import { cn, formatDate } from '@/lib/utils'
import type { Contact, Meeting } from '@/types'

export function Contacts() {
  const navigate = useNavigate()
  const {
    contacts,
    selectedContact,
    selectedContactMeetings,
    loading,
    searchQuery,
    total,
    loadContacts,
    selectContact,
    updateContact,
    setSearchQuery,
    clearSelection
  } = useContactsStore()

  const [editingNotes, setEditingNotes] = useState(false)
  const [notesValue, setNotesValue] = useState('')

  // Load contacts on mount
  useEffect(() => {
    loadContacts()
  }, [loadContacts])

  // Sync notes state when selected contact changes
  useEffect(() => {
    if (selectedContact) {
      setNotesValue(selectedContact.notes || '')
      setEditingNotes(false)
    }
  }, [selectedContact])

  const handleSaveNotes = async () => {
    if (selectedContact) {
      await updateContact(selectedContact.id, notesValue)
      setEditingNotes(false)
    }
  }

  const handleMeetingClick = (meeting: Meeting) => {
    navigate(`/meeting/${meeting.id}`)
  }

  return (
    <div className="flex h-full">
      {/* People List */}
      <div className="w-80 border-r flex flex-col">
        {/* Header */}
        <div className="p-4 border-b space-y-3">
          <div>
            <h1 className="text-xl font-semibold">People</h1>
            <p className="text-xs text-muted-foreground mt-1">
              Everyone mentioned in your knowledge base
            </p>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search people..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {total} {total === 1 ? 'person' : 'people'} found
          </p>
        </div>

        {/* People List */}
        <div className="flex-1 overflow-auto">
          {loading && contacts.length === 0 ? (
            <div className="p-4 text-center text-muted-foreground">
              Loading people...
            </div>
          ) : contacts.length === 0 ? (
            <div className="p-4 text-center space-y-2">
              <p className="text-muted-foreground">No people found</p>
              <p className="text-xs text-muted-foreground">
                People are automatically added from your conversations and meetings
              </p>
            </div>
          ) : (
            <div className="divide-y">
              {contacts.map((contact) => (
                <ContactListItem
                  key={contact.id}
                  contact={contact}
                  isSelected={selectedContact?.id === contact.id}
                  onClick={() => selectContact(contact.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Person Detail */}
      <div className="flex-1 flex flex-col">
        {selectedContact ? (
          <>
            {/* Person Header */}
            <div className="p-6 border-b">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-4">
                  <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
                    <User className="h-8 w-8 text-primary" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-semibold">{selectedContact.name}</h2>
                    {selectedContact.email && (
                      <div className="flex items-center gap-1 text-muted-foreground mt-1">
                        <Mail className="h-4 w-4" />
                        <span>{selectedContact.email}</span>
                      </div>
                    )}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={clearSelection}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              {/* Stats */}
              <div className="flex gap-6 mt-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Meetings:</span>
                  <span className="ml-1 font-medium">{selectedContact.meeting_count}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">First seen:</span>
                  <span className="ml-1 font-medium">{formatDate(selectedContact.first_seen_at)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Last seen:</span>
                  <span className="ml-1 font-medium">{formatDate(selectedContact.last_seen_at)}</span>
                </div>
              </div>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-auto p-6 space-y-6">
              {/* Notes Section */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-medium flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    Notes
                  </h3>
                  {editingNotes ? (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setNotesValue(selectedContact.notes || '')
                          setEditingNotes(false)
                        }}
                      >
                        Cancel
                      </Button>
                      <Button size="sm" onClick={handleSaveNotes}>
                        Save
                      </Button>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditingNotes(true)}
                    >
                      Edit
                    </Button>
                  )}
                </div>
                {editingNotes ? (
                  <Textarea
                    value={notesValue}
                    onChange={(e) => setNotesValue(e.target.value)}
                    placeholder="Add notes about this person..."
                    className="min-h-[100px]"
                    autoFocus
                  />
                ) : (
                  <div className="text-sm text-muted-foreground bg-muted/30 rounded-md p-3 min-h-[60px]">
                    {selectedContact.notes || 'No notes yet. Click Edit to add notes.'}
                  </div>
                )}
              </div>

              {/* Meetings Section */}
              <div>
                <h3 className="font-medium flex items-center gap-2 mb-3">
                  <Calendar className="h-4 w-4" />
                  Meetings ({selectedContactMeetings.length})
                </h3>
                {selectedContactMeetings.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No meetings recorded</p>
                ) : (
                  <div className="space-y-2">
                    {selectedContactMeetings.map((meeting) => (
                      <button
                        key={meeting.id}
                        onClick={() => handleMeetingClick(meeting)}
                        className="w-full text-left p-3 rounded-md border hover:bg-accent transition-colors group"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="font-medium group-hover:text-primary transition-colors">
                              {meeting.subject}
                            </div>
                            <div className="text-sm text-muted-foreground">
                              {formatDate(meeting.start_time)}
                            </div>
                          </div>
                          <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary" />
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <User className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>Select a person to view details</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

interface ContactListItemProps {
  contact: Contact
  isSelected: boolean
  onClick: () => void
}

function ContactListItem({ contact, isSelected, onClick }: ContactListItemProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full text-left p-3 hover:bg-accent transition-colors',
        isSelected && 'bg-primary/10'
      )}
    >
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
          <User className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-medium truncate">{contact.name}</div>
          {contact.email && (
            <div className="text-sm text-muted-foreground truncate">{contact.email}</div>
          )}
          <div className="text-xs text-muted-foreground mt-0.5">
            {contact.meeting_count} meeting{contact.meeting_count !== 1 ? 's' : ''}
          </div>
        </div>
      </div>
    </button>
  )
}
