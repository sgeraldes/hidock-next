import { create } from 'zustand'
import type { Note, NoteTemplate } from '../types/models'
import { getElectronAPI } from '../lib/electron-api'

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
      const api = getElectronAPI()
      if (!api) return
      const note = await api.notes.getForSession(sessionId)
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
      const api = getElectronAPI()
      if (!api) return null
      const note = await api.notes.generate(sessionId, templateId)
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
      const api = getElectronAPI()
      if (!api) return
      await api.notes.update(noteId, content)
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
      const api = getElectronAPI()
      if (!api) return
      const templates = await api.notes.listTemplates()
      set({ templates })
    } catch (error) {
      console.error('[NotesStore] Failed to fetch templates:', error)
    }
  },
}))

export function initNotesStore(): () => void {
  const api = getElectronAPI()
  if (!api) return () => {}

  const unsub1 = api.notes.onGenerationProgress((data) => {
    useNotesStore.setState({ generationProgress: data.progress })
  })

  return () => {
    unsub1()
  }
}
