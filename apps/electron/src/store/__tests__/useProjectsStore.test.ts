/**
 * Tests for useProjectsStore
 *
 * Tests cover synchronous store functionality:
 * - Initial state verification
 * - setSearchQuery
 * - clearSelection
 * - clearError
 *
 * NOTE: Async actions (loadProjects, selectProject, createProject, updateProject, deleteProject)
 * call window.electronAPI and would require full IPC mocking.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { useProjectsStore } from '@/store/domain/useProjectsStore'

beforeEach(() => {
  // Reset store to initial state
  useProjectsStore.setState({
    projects: [],
    selectedProject: null,
    loading: false,
    error: null,
    searchQuery: '',
    total: 0
  })
})

describe('useProjectsStore', () => {
  it('should have correct initial state', () => {
    const state = useProjectsStore.getState()
    expect(state.projects).toEqual([])
    expect(state.selectedProject).toBeNull()
    expect(state.loading).toBe(false)
    expect(state.error).toBeNull()
    expect(state.searchQuery).toBe('')
    expect(state.total).toBe(0)
  })

  it('should set search query', () => {
    useProjectsStore.getState().setSearchQuery('test project')
    expect(useProjectsStore.getState().searchQuery).toBe('test project')
  })

  it('should clear selection', () => {
    useProjectsStore.setState({
      selectedProject: {
        id: '1',
        name: 'Test Project',
        description: null,
        status: 'active',
        createdAt: '2025-01-01'
      }
    })
    expect(useProjectsStore.getState().selectedProject).not.toBeNull()

    useProjectsStore.getState().clearSelection()
    expect(useProjectsStore.getState().selectedProject).toBeNull()
  })

  it('should clear error', () => {
    useProjectsStore.setState({ error: 'Some error' })
    expect(useProjectsStore.getState().error).toBe('Some error')

    useProjectsStore.getState().clearError()
    expect(useProjectsStore.getState().error).toBeNull()
  })

  it('should expose all CRUD actions', () => {
    const state = useProjectsStore.getState()
    expect(typeof state.loadProjects).toBe('function')
    expect(typeof state.selectProject).toBe('function')
    expect(typeof state.createProject).toBe('function')
    expect(typeof state.updateProject).toBe('function')
    expect(typeof state.deleteProject).toBe('function')
  })
})
