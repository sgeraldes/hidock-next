/**
 * Store Exports
 *
 * Centralized exports for all Zustand stores organized by category:
 * - Domain: Core business entities (Config)
 * - Features: Feature-specific functionality (Transcription)
 * - UI: User interface state (Library, General UI)
 *
 * Architecture Philosophy:
 * - Domain stores manage CRUD operations on core entities
 * - Feature stores handle cross-cutting concerns and workflows
 * - UI stores manage ephemeral UI state and user preferences
 *
 * Dead Code Removal (W1-HS-04 through W1-HS-14):
 * - REMOVED: useMeetingsStore (never consumed)
 * - REMOVED: useKnowledgeStore (never consumed)
 * - REMOVED: useCalendarStore (never consumed)
 * - REMOVED: useDeviceSyncStore (never consumed)
 * - REMOVED: useQualityStore (never consumed)
 * - REMOVED: useLayoutStore (never consumed)
 * - REMOVED: useCalendarUIStore (never consumed)
 * - REMOVED: useFilterStore (never consumed)
 * - REMOVED: useContactsStore (never consumed by People page)
 * - REMOVED: useProjectsStore (never consumed by Projects page)
 * - REMOVED: FilterBar.tsx component (never rendered)
 */

// =============================================================================
// Domain Stores - Core Business Entities
// =============================================================================

export { useConfigStore } from './domain/useConfigStore'

// =============================================================================
// Feature Stores - Cross-Cutting Functionality
// =============================================================================

// NOTE: useDownloadQueueStore was removed (dead code - imported by zero components).
// Active download tracking uses useAppStore.downloadQueue instead.
// See STABILITY_FIXES.md Phase 1.5 for details.

export { useTranscriptionStore, usePendingTranscriptions, useProcessingTranscriptions, useFailedTranscriptions, useTranscriptionStats } from './features/useTranscriptionStore'
export type { TranscriptionQueueStore, TranscriptionItem, TranscriptionStatus } from './features/useTranscriptionStore'

// =============================================================================
// UI Stores - User Interface State
// =============================================================================

// NOTE: useLibraryUIStore was removed (dead code) - use useLibraryStore instead
// See: .claude/specs/spec-007-store-consolidation.md

export { useLibraryStore } from './useLibraryStore'

export { useUIStore } from './ui/useUIStore'
export type { UIStore, SidebarContent, PlaybackState, SentimentSegment } from '@/types/stores'

// =============================================================================
// Legacy Store - Backwards Compatibility
// =============================================================================

/**
 * @deprecated
 * This monolithic store is being phased out in favor of the granular domain/feature/UI stores.
 * Use specific stores instead:
 * - Config → useConfigStore
 * - Transcription → useTranscriptionStore
 * - UI State → useLibraryStore, useUIStore
 */
export { useAppStore } from './useAppStore'
