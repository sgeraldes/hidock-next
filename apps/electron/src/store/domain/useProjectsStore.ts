// TODO: W1-HS-14: This store is not consumed by any component. Wire it to the corresponding page or remove it.
/**
 * Projects Store
 *
 * Manages project state including list, selection, creation, and meeting tagging.
 */

import { create } from 'zustand'
import type { Project } from '@/types'
import type { ProjectsStore } from '@/types/stores'

export const useProjectsStore = create<ProjectsStore>((set, get) => ({
  // State
  projects: [],
  selectedProject: null,
  selectedProjectMeetings: [],
  selectedProjectTopics: [],
  loading: false,
  searchQuery: '',
  total: 0,

  // Actions
  loadProjects: async (search?: string) => {
    set({ loading: true })
    try {
      const result = await window.electronAPI.projects.getAll({ search })

      if (result.success) {
        // IPC handler maps DB rows to knowledge.ts Project shape (with status, createdAt)
        set({
          projects: result.data.projects as unknown as Project[],
          total: result.data.total,
          loading: false
        })
      } else {
        console.error('Failed to load projects:', result.error)
        set({ loading: false })
      }
    } catch (error) {
      console.error('Failed to load projects:', error)
      set({ loading: false })
    }
  },

  selectProject: async (id: string | null) => {
    if (!id) {
      set({
        selectedProject: null,
        selectedProjectMeetings: [],
        selectedProjectTopics: []
      })
      return
    }

    set({ loading: true })
    try {
      const result = await window.electronAPI.projects.getById(id)

      if (result.success) {
        // IPC handler maps DB rows to knowledge.ts Project shape (with status, createdAt)
        set({
          selectedProject: result.data.project as unknown as Project,
          selectedProjectMeetings: result.data.meetings,
          selectedProjectTopics: result.data.topics,
          loading: false
        })
      } else {
        console.error('Failed to load project:', result.error)
        set({ loading: false })
      }
    } catch (error) {
      console.error('Failed to load project:', error)
      set({ loading: false })
    }
  },

  createProject: async (name: string, description?: string): Promise<Project> => {
    const result = await window.electronAPI.projects.create({ name, description })

    if (result.success) {
      // IPC handler maps DB rows to knowledge.ts Project shape (with status, createdAt)
      const project = result.data as unknown as Project
      // Add to local state
      set((state) => ({
        projects: [project, ...state.projects],
        total: state.total + 1
      }))
      return project
    } else {
      throw new Error(result.error.message)
    }
  },

  updateProject: async (id: string, name?: string, description?: string) => {
    const result = await window.electronAPI.projects.update({ id, name, description })

    if (result.success) {
      // IPC handler maps DB rows to knowledge.ts Project shape (with status, createdAt)
      const updated = result.data as unknown as Project
      // Update local state
      set((state) => ({
        projects: state.projects.map((p) =>
          p.id === id ? updated : p
        ),
        selectedProject: state.selectedProject?.id === id
          ? updated
          : state.selectedProject
      }))
    } else {
      throw new Error(result.error.message)
    }
  },

  deleteProject: async (id: string) => {
    const result = await window.electronAPI.projects.delete(id)

    if (result.success) {
      // Remove from local state
      set((state) => ({
        projects: state.projects.filter((p) => p.id !== id),
        total: state.total - 1,
        selectedProject: state.selectedProject?.id === id ? null : state.selectedProject,
        selectedProjectMeetings: state.selectedProject?.id === id ? [] : state.selectedProjectMeetings,
        selectedProjectTopics: state.selectedProject?.id === id ? [] : state.selectedProjectTopics
      }))
    } else {
      throw new Error(result.error.message)
    }
  },

  tagMeeting: async (meetingId: string, projectId: string) => {
    const result = await window.electronAPI.projects.tagMeeting({ meetingId, projectId })

    if (result.success) {
      // Reload project details if this is the selected project
      if (get().selectedProject?.id === projectId) {
        await get().selectProject(projectId)
      }
    } else {
      throw new Error(result.error.message)
    }
  },

  untagMeeting: async (meetingId: string, projectId: string) => {
    const result = await window.electronAPI.projects.untagMeeting({ meetingId, projectId })

    if (result.success) {
      // Reload project details if this is the selected project
      if (get().selectedProject?.id === projectId) {
        await get().selectProject(projectId)
      }
    } else {
      throw new Error(result.error.message)
    }
  },

  setSearchQuery: (query: string) => {
    set({ searchQuery: query })
    get().loadProjects(query || undefined)
  },

  clearSelection: () => {
    set({
      selectedProject: null,
      selectedProjectMeetings: [],
      selectedProjectTopics: []
    })
  }
}))
