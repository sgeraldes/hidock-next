import { create } from 'zustand'
import type { Note, NoteTemplate } from '../types/models'

interface NotesState {
  notes: Note[]
  templates: NoteTemplate[]
  generationProgress: number | null
  // Actions
  fetchForSession: (sessionId: string) => Promise<void>
  generate: (sessionId: string, templateId?: string) => Promise<Note | null>
  update: (noteId: string, content: string) => Promise<void>
  fetchTemplates: () => Promise<void>
}

export const useNotesStore = create<NotesState>((set) => ({
  notes: [],
  templates: [],
  generationProgress: null,

  fetchForSession: async (sessionId) => {
    try {
      const note = await window.electronAPI.notes.getForSession(sessionId)
      set((state) => {
        if (!note) return state
        const exists = state.notes.some((n) => n.id === note.id)
        if (exists) {
          return { notes: state.notes.map((n) => (n.id === note.id ? note : n)) }
        }
        return { notes: [...state.notes, note] }
      })
    } catch (error) {
      console.error('[NotesStore] Failed to fetch notes for session:', error)
    }
  },

  generate: async (sessionId, templateId) => {
    try {
      const note = await window.electronAPI.notes.generate(sessionId, templateId)
      if (note) {
        set((state) => {
          const exists = state.notes.some((n) => n.id === note.id)
          if (exists) {
            return { notes: state.notes.map((n) => (n.id === note.id ? note : n)) }
          }
          return { notes: [...state.notes, note] }
        })
      }
      return note
    } catch (error) {
      console.error('[NotesStore] Failed to generate notes:', error)
      return null
    }
  },

  update: async (noteId, content) => {
    try {
      await window.electronAPI.notes.update(noteId, content)
      set((state) => ({
        notes: state.notes.map((n) =>
          n.id === noteId ? { ...n, content, updated_at: Date.now() } : n
        ),
      }))
    } catch (error) {
      console.error('[NotesStore] Failed to update note:', error)
    }
  },

  fetchTemplates: async () => {
    try {
      const templates = await window.electronAPI.notes.listTemplates()
      set({ templates })
    } catch (error) {
      console.error('[NotesStore] Failed to fetch templates:', error)
    }
  },
}))

export function initNotesStore(): () => void {
  const unsub1 = window.electronAPI.notes.onGenerationProgress((data) => {
    useNotesStore.setState({ generationProgress: data.progress })
  })

  return () => {
    unsub1()
  }
}
