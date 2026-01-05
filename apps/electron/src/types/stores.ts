/**
 * Store Types
 *
 * TypeScript interfaces for Zustand feature stores.
 * These types define the state shape and actions for each store.
 */

import type { Meeting, Recording, Transcript, Contact, Project } from './index'

// =============================================================================
// Calendar Store
// =============================================================================

export interface CalendarStore {
  // State
  meetings: Meeting[]
  loading: boolean
  syncing: boolean
  currentDate: Date
  view: 'week' | 'month'
  lastSyncAt: string | null

  // Actions
  loadMeetings: (startDate?: string, endDate?: string) => Promise<void>
  syncCalendar: () => Promise<{ success: boolean; meetingsCount: number; error?: string }>
  navigateWeek: (direction: 'prev' | 'next') => void
  navigateMonth: (direction: 'prev' | 'next') => void
  setView: (view: 'week' | 'month') => void
  goToToday: () => void
  setCurrentDate: (date: Date) => void
}

// =============================================================================
// Contacts Store
// =============================================================================

export interface ContactsStore {
  // State
  contacts: Contact[]
  selectedContact: Contact | null
  selectedContactMeetings: Meeting[]
  loading: boolean
  searchQuery: string
  total: number

  // Actions
  loadContacts: (search?: string) => Promise<void>
  selectContact: (id: string | null) => Promise<void>
  updateContact: (id: string, notes: string) => Promise<void>
  setSearchQuery: (query: string) => void
  clearSelection: () => void
}

// =============================================================================
// Projects Store
// =============================================================================

export interface ProjectsStore {
  // State
  projects: Project[]
  selectedProject: Project | null
  selectedProjectMeetings: Meeting[]
  selectedProjectTopics: string[]
  loading: boolean
  searchQuery: string
  total: number

  // Actions
  loadProjects: (search?: string) => Promise<void>
  selectProject: (id: string | null) => Promise<void>
  createProject: (name: string, description?: string) => Promise<Project>
  updateProject: (id: string, name?: string, description?: string) => Promise<void>
  deleteProject: (id: string) => Promise<void>
  tagMeeting: (meetingId: string, projectId: string) => Promise<void>
  untagMeeting: (meetingId: string, projectId: string) => Promise<void>
  setSearchQuery: (query: string) => void
  clearSelection: () => void
}

// =============================================================================
// Filter Store
// =============================================================================

export interface DateRange {
  start: Date
  end: Date
}

export type RecordingStatusFilter = 'all' | 'recorded' | 'transcribed' | null

export interface FilterStore {
  // State
  dateRange: DateRange | null
  contactId: string | null
  projectId: string | null
  status: RecordingStatusFilter
  searchQuery: string

  // Computed
  hasActiveFilters: boolean

  // Actions
  setDateRange: (range: DateRange | null) => void
  setContactFilter: (contactId: string | null) => void
  setProjectFilter: (projectId: string | null) => void
  setStatusFilter: (status: RecordingStatusFilter) => void
  setSearchQuery: (query: string) => void
  clearFilters: () => void
  clearAllExcept: (keep: 'date' | 'contact' | 'project' | 'status') => void
}

// =============================================================================
// UI Store
// =============================================================================

export type SidebarContent = 'calendar' | 'contact' | 'project' | 'chat' | 'none'

export interface PlaybackState {
  recordingId: string | null
  filePath: string | null
  isPlaying: boolean
  currentTime: number
  duration: number
}

export interface UIStore {
  // State
  sidebarOpen: boolean
  sidebarContent: SidebarContent
  selectedMeetingId: string | null
  isGeneratingOutput: boolean
  outputContent: string | null

  // Recordings page view preference (persists across navigation)
  recordingsCompactView: boolean

  // Playback state (managed by OperationController)
  currentlyPlayingId: string | null
  currentlyPlayingPath: string | null
  playbackCurrentTime: number
  playbackDuration: number
  isPlaying: boolean

  // Actions
  toggleSidebar: () => void
  setSidebarOpen: (open: boolean) => void
  setSidebarContent: (content: SidebarContent) => void
  selectMeeting: (id: string | null) => void
  setGeneratingOutput: (generating: boolean) => void
  setOutputContent: (content: string | null) => void
  clearOutput: () => void

  // Recordings view actions
  setRecordingsCompactView: (compact: boolean) => void

  // Playback actions
  setCurrentlyPlaying: (recordingId: string | null, filePath: string | null) => void
  setPlaybackProgress: (currentTime: number, duration: number) => void
  setIsPlaying: (playing: boolean) => void
}

// =============================================================================
// Recordings Store (existing, but typed)
// =============================================================================

export interface RecordingsStore {
  // State
  recordings: Recording[]
  selectedRecording: Recording | null
  transcript: Transcript | null
  loading: boolean

  // Actions
  loadRecordings: () => Promise<void>
  selectRecording: (id: string | null) => Promise<void>
  loadTranscript: (recordingId: string) => Promise<Transcript | null>
  clearSelection: () => void
}

// =============================================================================
// RAG Chat Store
// =============================================================================

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  sources?: Array<{
    content: string
    meetingId?: string
    subject?: string
    score: number
  }>
  createdAt: string
}

export interface RAGFilter {
  type: 'none' | 'meeting' | 'contact' | 'project' | 'dateRange'
  value?: string // meetingId, contactId, projectId, or serialized date range
}

export interface ChatStore {
  // State
  messages: ChatMessage[]
  loading: boolean
  sessionId: string
  filter: RAGFilter
  ollamaAvailable: boolean

  // Actions
  loadHistory: () => Promise<void>
  sendMessage: (message: string) => Promise<void>
  clearHistory: () => Promise<void>
  setFilter: (filter: RAGFilter) => void
  clearFilter: () => void
  checkOllamaStatus: () => Promise<boolean>
  newSession: () => void
}

// =============================================================================
// Output Store
// =============================================================================

export type OutputTemplateId = 'meeting_minutes' | 'interview_feedback' | 'project_status' | 'action_items'

export interface OutputTemplate {
  id: OutputTemplateId
  name: string
  description: string
}

export interface OutputStore {
  // State
  templates: OutputTemplate[]
  selectedTemplateId: OutputTemplateId | null
  generatedContent: string | null
  generating: boolean
  error: string | null

  // Actions
  loadTemplates: () => Promise<void>
  selectTemplate: (id: OutputTemplateId | null) => void
  generate: (params: {
    templateId: OutputTemplateId
    meetingId?: string
    projectId?: string
    contactId?: string
  }) => Promise<string | null>
  copyToClipboard: () => Promise<boolean>
  saveToFile: () => Promise<boolean>
  clearOutput: () => void
}

// =============================================================================
// Config Store (existing, but typed)
// =============================================================================

export interface ConfigStore {
  // State
  config: AppConfig | null
  loading: boolean

  // Actions
  loadConfig: () => Promise<void>
  updateSection: <K extends keyof AppConfig>(section: K, values: Partial<AppConfig[K]>) => Promise<void>
  getValue: (key: string) => Promise<unknown>
}

export interface AppConfig {
  version: string
  storage: {
    dataPath: string
    maxRecordingsGB: number
  }
  calendar: {
    icsUrl: string
    syncEnabled: boolean
    syncIntervalMinutes: number
    lastSyncAt: string | null
  }
  transcription: {
    provider: 'gemini'
    geminiApiKey: string
    geminiModel: string
    autoTranscribe: boolean
    language: string
  }
  embeddings: {
    provider: 'ollama'
    ollamaBaseUrl: string
    ollamaModel: string
    chunkSize: number
    chunkOverlap: number
  }
  chat: {
    provider: 'gemini' | 'ollama'
    geminiModel: string
    ollamaModel: string
    maxContextChunks: number
  }
  device: {
    autoConnect: boolean
    autoDownload: boolean
  }
  ui: {
    theme: 'light' | 'dark' | 'system'
    defaultView: 'week' | 'month'
    startOfWeek: number
    calendarView: 'day' | 'workweek' | 'week' | 'month'
    hideEmptyMeetings: boolean
    showListView: boolean
    officeHoursStart: number
    officeHoursEnd: number
    workDays: number[]
  }
}
