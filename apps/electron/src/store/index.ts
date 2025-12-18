/**
 * Store Exports
 *
 * Re-exports all Zustand stores for convenient imports.
 */

// Feature stores
export { useCalendarStore } from './useCalendarStore'
export { useContactsStore } from './useContactsStore'
export { useProjectsStore } from './useProjectsStore'
export { useFilterStore, useActiveFilters, useFilterAsRequest } from './useFilterStore'
export { useUIStore } from './useUIStore'

// Legacy store (for backwards compatibility during migration)
export { useAppStore } from './useAppStore'
