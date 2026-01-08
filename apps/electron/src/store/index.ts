/**
 * Store Exports
 *
 * Centralized exports for all Zustand stores organized by category:
 * - Domain: Core business entities (Knowledge, Meetings, Contacts, Projects)
 * - Features: Feature-specific functionality (Downloads, Transcription, Device Sync, Quality)
 * - UI: User interface state (Layout, Library UI, Calendar UI, General UI)
 *
 * Architecture Philosophy:
 * - Domain stores manage CRUD operations on core entities
 * - Feature stores handle cross-cutting concerns and workflows
 * - UI stores manage ephemeral UI state and user preferences
 */

// =============================================================================
// Domain Stores - Core Business Entities
// =============================================================================

export { useKnowledgeStore, useKnowledgeById, useKnowledgeByMeeting, useKnowledgeByLocation, useKnowledgeByStatus, useTranscribedKnowledge } from './domain/useKnowledgeStore'
export type { KnowledgeStore, KnowledgeCapture } from './domain/useKnowledgeStore'

export { useMeetingsStore, useMeetingById, useMeetingsByDate, useMeetingsByDateRange, useRecurringMeetings, useMeetingsByOrganizer } from './domain/useMeetingsStore'
export type { MeetingsStore } from './domain/useMeetingsStore'

export { useContactsStore } from './domain/useContactsStore'
export type { ContactsStore } from '@/types/stores'

export { useProjectsStore } from './domain/useProjectsStore'
export type { ProjectsStore } from '@/types/stores'

// =============================================================================
// Feature Stores - Cross-Cutting Functionality
// =============================================================================

export { useDownloadQueueStore, useDownloadProgress, useFailedDownloads, useActiveDownloads, usePendingDownloads, useQueueStats } from './features/useDownloadQueueStore'
export type { DownloadQueueStore, DownloadItem, DownloadStatus } from './features/useDownloadQueueStore'

export { useTranscriptionStore, usePendingTranscriptions, useProcessingTranscriptions, useFailedTranscriptions, useTranscriptionStats } from './features/useTranscriptionStore'
export type { TranscriptionQueueStore, TranscriptionItem, TranscriptionStatus } from './features/useTranscriptionStore'

export { useDeviceSyncStore, useUnsyncedFilesCount, useStoragePercentage, useIsDeviceConnected, useIsSyncing } from './features/useDeviceSyncStore'
export type { DeviceSyncStore, DeviceFile, DeviceSyncState, DeviceConnectionStatus } from './features/useDeviceSyncStore'

export { useQualityStore, useRecordingQuality, useRecordingsByQuality, useQualityStats, useIsRecordingRated } from './features/useQualityStore'
export type { QualityStore, QualityAssessment, QualityRating } from './features/useQualityStore'

export { useCalendarStore } from './features/useCalendarStore'
export type { CalendarStore } from '@/types/stores'

export { useFilterStore, useActiveFilters, useFilterAsRequest } from './features/useFilterStore'
export type { FilterStore, DateRange, RecordingStatusFilter } from '@/types/stores'

// =============================================================================
// UI Stores - User Interface State
// =============================================================================

export { useLayoutStore, useIsModalActive, useModalProps } from './ui/useLayoutStore'
export type { LayoutStore, Theme, ModalType } from './ui/useLayoutStore'

export { useLibraryUIStore, useHasActiveFilters, useSelectedCount, useIsSelected, useSelectedIds } from './ui/useLibraryUIStore'
export type { LibraryUIStore, LibrarySource, LibraryViewMode, LibrarySortBy, LibrarySortOrder, LibraryDateRange } from './ui/useLibraryUIStore'

export { useCalendarUIStore, useViewDateRange, useIsDateInView, useIsMeetingSelected, getViewStartDate, getViewEndDate } from './ui/useCalendarUIStore'
export type { CalendarUIStore, CalendarViewMode } from './ui/useCalendarUIStore'

export { useUIStore } from './ui/useUIStore'
export type { UIStore, SidebarContent, PlaybackState, SentimentSegment } from '@/types/stores'

// =============================================================================
// Legacy Store - Backwards Compatibility
// =============================================================================

/**
 * @deprecated
 * This monolithic store is being phased out in favor of the granular domain/feature/UI stores.
 * Use specific stores instead:
 * - Config → Domain stores + Feature stores
 * - Calendar → useMeetingsStore + useCalendarStore + useCalendarUIStore
 * - Recordings → useKnowledgeStore + useTranscriptionStore
 * - UI State → useLayoutStore, useLibraryUIStore, useCalendarUIStore, useUIStore
 * - Device Sync → useDeviceSyncStore + useDownloadQueueStore
 */
export { useAppStore } from './useAppStore'
