/**
 * Projects Store (Domain)
 *
 * Manages CRUD operations on project entities.
 * Provides loading, creating, updating, deleting, and selecting projects.
 */

import { create } from 'zustand'
import type { Project } from '@/types/knowledge'

interface ProjectsState {
  // State
  projects: Project[]
  selectedProject: Project | null
  loading: boolean
  error: string | null
  searchQuery: string
  total: number

  // Actions
  loadProjects: (search?: string, status?: string, limit?: number, offset?: number) => Promise<void>
  selectProject: (id: string) => Promise<void>
  createProject: (name: string, description?: string) => Promise<Project | null>
  updateProject: (id: string, updates: {
    name?: string
    description?: string | null
    status?: 'active' | 'archived'
  }) => Promise<void>
  deleteProject: (id: string) => Promise<void>
  setSearchQuery: (query: string) => void
  clearSelection: () => void
  clearError: () => void
}

export const useProjectsStore = create<ProjectsState>((set, get) => ({
  projects: [],
  selectedProject: null,
  loading: false,
  error: null,
  searchQuery: '',
  total: 0,

  loadProjects: async (search, status, limit = 100, offset = 0) => {
    set({ loading: true, error: null })
    try {
      const result = await window.electronAPI.projects.getAll({
        search,
        status: status as any,
        limit,
        offset
      })
      if (result.success) {
        const mapped = result.data.projects.map((p: any): Project => ({
          id: p.id,
          name: p.name,
          description: p.description,
          status: p.status || 'active',
          createdAt: p.created_at || p.createdAt || new Date().toISOString(),
          knowledgeIds: p.knowledgeIds,
          personIds: p.personIds
        }))
        set({ projects: mapped, total: result.data.total, loading: false })
      } else {
        const msg = (result as any).error?.message || 'Failed to load projects'
        set({ error: msg, loading: false })
      }
    } catch (err) {
      console.error('ProjectsStore: Failed to load projects:', err)
      set({ error: err instanceof Error ? err.message : 'Failed to load projects', loading: false })
    }
  },

  selectProject: async (id: string) => {
    set({ loading: true, error: null })
    try {
      const result = await window.electronAPI.projects.getById(id)
      if (result.success && result.data.project) {
        const p = result.data.project as any
        const project: Project = {
          id: p.id,
          name: p.name,
          description: p.description,
          status: p.status || 'active',
          createdAt: p.created_at || p.createdAt || new Date().toISOString(),
          knowledgeIds: p.knowledgeIds,
          personIds: p.personIds
        }
        set({ selectedProject: project, loading: false })
      } else {
        set({ error: 'Project not found', loading: false })
      }
    } catch (err) {
      console.error('ProjectsStore: Failed to select project:', err)
      set({ error: err instanceof Error ? err.message : 'Failed to load project', loading: false })
    }
  },

  createProject: async (name, description) => {
    try {
      const result = await window.electronAPI.projects.create({ name, description })
      if (result.success) {
        const p = result.data as any
        const project: Project = {
          id: p.id,
          name: p.name,
          description: p.description,
          status: p.status || 'active',
          createdAt: p.created_at || p.createdAt || new Date().toISOString()
        }
        set(state => ({
          projects: [project, ...state.projects],
          total: state.total + 1
        }))
        return project
      } else {
        const msg = (result as any).error?.message || 'Failed to create project'
        set({ error: msg })
        return null
      }
    } catch (err) {
      console.error('ProjectsStore: Failed to create project:', err)
      set({ error: err instanceof Error ? err.message : 'Failed to create project' })
      return null
    }
  },

  updateProject: async (id, updates) => {
    try {
      const result = await window.electronAPI.projects.update({ id, ...updates })
      if (result.success) {
        const p = result.data as any
        const updated: Project = {
          id: p.id,
          name: p.name,
          description: p.description,
          status: p.status || 'active',
          createdAt: p.created_at || p.createdAt || new Date().toISOString()
        }
        set(state => ({
          projects: state.projects.map(proj => proj.id === id ? updated : proj),
          selectedProject: state.selectedProject?.id === id ? updated : state.selectedProject
        }))
      } else {
        const msg = (result as any).error?.message || 'Failed to update project'
        set({ error: msg })
      }
    } catch (err) {
      console.error('ProjectsStore: Failed to update project:', err)
      set({ error: err instanceof Error ? err.message : 'Failed to update project' })
    }
  },

  deleteProject: async (id) => {
    try {
      const result = await window.electronAPI.projects.delete(id)
      if (result.success) {
        set(state => ({
          projects: state.projects.filter(p => p.id !== id),
          selectedProject: state.selectedProject?.id === id ? null : state.selectedProject,
          total: state.total - 1
        }))
      } else {
        const msg = (result as any).error?.message || 'Failed to delete project'
        set({ error: msg })
      }
    } catch (err) {
      console.error('ProjectsStore: Failed to delete project:', err)
      set({ error: err instanceof Error ? err.message : 'Failed to delete project' })
    }
  },

  setSearchQuery: (query) => set({ searchQuery: query }),
  clearSelection: () => set({ selectedProject: null }),
  clearError: () => set({ error: null })
}))
