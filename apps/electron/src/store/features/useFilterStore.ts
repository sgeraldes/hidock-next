/**
 * Filter Store
 *
 * Manages global filter state for meeting list filtering.
 * Filters can be combined - date range + contact + project + status.
 */

import { create } from 'zustand'
import type { FilterStore, DateRange, RecordingStatusFilter } from '@/types/stores'

export const useFilterStore = create<FilterStore>((set, get) => ({
  // State
  dateRange: null,
  contactId: null,
  projectId: null,
  status: null,
  searchQuery: '',

  // Computed (implemented as getter pattern)
  get hasActiveFilters(): boolean {
    const state = get()
    return !!(
      state.dateRange ||
      state.contactId ||
      state.projectId ||
      state.status ||
      state.searchQuery
    )
  },

  // Actions
  setDateRange: (range: DateRange | null) => {
    set({ dateRange: range })
  },

  setContactFilter: (contactId: string | null) => {
    set({ contactId })
  },

  setProjectFilter: (projectId: string | null) => {
    set({ projectId })
  },

  setStatusFilter: (status: RecordingStatusFilter) => {
    set({ status })
  },

  setSearchQuery: (query: string) => {
    set({ searchQuery: query })
  },

  clearFilters: () => {
    set({
      dateRange: null,
      contactId: null,
      projectId: null,
      status: null,
      searchQuery: ''
    })
  },

  clearAllExcept: (keep: 'date' | 'contact' | 'project' | 'status') => {
    const state = get()
    set({
      dateRange: keep === 'date' ? state.dateRange : null,
      contactId: keep === 'contact' ? state.contactId : null,
      projectId: keep === 'project' ? state.projectId : null,
      status: keep === 'status' ? state.status : null,
      searchQuery: ''
    })
  }
}))

// Selector hooks for common filter combinations
export const useActiveFilters = () => {
  return useFilterStore((state) => ({
    dateRange: state.dateRange,
    contactId: state.contactId,
    projectId: state.projectId,
    status: state.status,
    searchQuery: state.searchQuery,
    hasActiveFilters: !!(
      state.dateRange ||
      state.contactId ||
      state.projectId ||
      state.status ||
      state.searchQuery
    )
  }))
}

// Convert filter state to API request format
export const useFilterAsRequest = () => {
  return useFilterStore((state) => ({
    startDate: state.dateRange?.start.toISOString(),
    endDate: state.dateRange?.end.toISOString(),
    contactId: state.contactId ?? undefined,
    projectId: state.projectId ?? undefined,
    status: state.status === null ? 'all' : state.status,
    search: state.searchQuery || undefined
  }))
}
