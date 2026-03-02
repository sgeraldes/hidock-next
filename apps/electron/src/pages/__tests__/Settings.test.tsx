
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Settings } from '../Settings'

const mockLoadConfig = vi.fn()
const mockUpdateConfig = vi.fn()
const mockSyncCalendar = vi.fn()

// Mock the stores
vi.mock('@/store/useAppStore', () => ({
  useAppStore: vi.fn((selector) => {
    const state = {
      syncCalendar: mockSyncCalendar,
      calendarSyncing: false
    }
    if (typeof selector === 'function') return selector(state)
    return state
  }),
  useCalendarSyncing: vi.fn(() => false)
}))

vi.mock('@/store/domain/useConfigStore', () => ({
  useConfigStore: vi.fn((selector?: any) => {
    const state = {
      config: {
        calendar: {
          icsUrl: 'https://example.com/cal.ics',
          syncEnabled: true,
          syncIntervalMinutes: 15,
          lastSyncAt: '2026-03-01T10:00:00Z'
        },
        transcription: { geminiApiKey: 'AIzaTestKey12345', geminiModel: 'gemini-3-pro-preview' },
        chat: { provider: 'gemini' as const },
        embeddings: { ollamaBaseUrl: 'http://localhost:11434' }
      },
      loadConfig: mockLoadConfig,
      updateConfig: mockUpdateConfig,
      configLoading: false
    }
    if (typeof selector === 'function') return selector(state)
    return state
  })
}))

// Mock HealthCheck component
vi.mock('@/components/HealthCheck', () => ({
  HealthCheck: () => <div data-testid="health-check">Health Check</div>
}))

// Mock Electron API
global.window.electronAPI = {
  config: {
    get: vi.fn().mockResolvedValue({
      success: true,
      data: {
        calendar: { icsUrl: '', syncEnabled: true, syncIntervalMinutes: 15 },
        transcription: { geminiApiKey: '', geminiModel: 'gemini-3-pro-preview' },
        chat: { provider: 'gemini' },
        embeddings: { ollamaBaseUrl: 'http://localhost:11434' }
      }
    }),
    updateSection: vi.fn().mockResolvedValue({ success: true })
  },
  storage: {
    getInfo: vi.fn().mockResolvedValue({
      success: true,
      data: {
        dataPath: '/data',
        recordingsPath: '/recordings',
        transcriptsPath: '/transcripts',
        cachePath: '/cache',
        databasePath: '/db',
        totalSizeBytes: 1024000,
        recordingsCount: 5
      }
    }),
    openFolder: vi.fn()
  }
} as any

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Settings Page', () => {
  it('should render settings sections', async () => {
    render(<Settings />)

    expect(screen.getByText('Calendar')).toBeInTheDocument()
    expect(screen.getByText('Transcription')).toBeInTheDocument()
    expect(screen.getByText('Chat / RAG')).toBeInTheDocument()
    expect(screen.getByText('Storage')).toBeInTheDocument()
  })

  it('should render calendar settings form', async () => {
    render(<Settings />)

    expect(screen.getByLabelText('ICS Calendar URL')).toBeInTheDocument()
    expect(screen.getByLabelText('Enable auto-sync')).toBeInTheDocument()
    expect(screen.getByLabelText('Sync interval in minutes')).toBeInTheDocument()
  })

  it('should render transcription settings form', async () => {
    render(<Settings />)

    expect(screen.getByLabelText('Gemini API Key')).toBeInTheDocument()
    expect(screen.getByLabelText('Transcription Model')).toBeInTheDocument()
  })

  it('should render chat provider toggle buttons', async () => {
    render(<Settings />)

    expect(screen.getByLabelText('Use Gemini chat provider')).toBeInTheDocument()
    expect(screen.getByLabelText('Use Ollama local chat provider')).toBeInTheDocument()
  })

  it('should render save buttons for each section', async () => {
    render(<Settings />)

    const saveButtons = screen.getAllByLabelText(/Save.*settings/)
    expect(saveButtons.length).toBe(3) // Calendar, Transcription, Chat
  })

  it('should render storage section', async () => {
    render(<Settings />)

    expect(screen.getByText('Storage')).toBeInTheDocument()
    expect(screen.getByText('Local data storage information')).toBeInTheDocument()
  })

  it('should render health check component', async () => {
    render(<Settings />)

    expect(screen.getByTestId('health-check')).toBeInTheDocument()
  })

  // C-006: API key visibility toggle
  it('should toggle API key visibility', async () => {
    render(<Settings />)

    const apiKeyInput = screen.getByLabelText('Gemini API Key') as HTMLInputElement

    // Default: password type
    expect(apiKeyInput.type).toBe('password')

    // Click show API key button
    const toggleButton = screen.getByLabelText('Show API key')
    fireEvent.click(toggleButton)

    // Should now be visible
    expect(apiKeyInput.type).toBe('text')

    // Click hide API key button
    const hideButton = screen.getByLabelText('Hide API key')
    fireEvent.click(hideButton)

    // Should be hidden again
    expect(apiKeyInput.type).toBe('password')
  })

  // C-006: Sync interval clamping
  it('should clamp sync interval to valid range', async () => {
    render(<Settings />)

    const intervalInput = screen.getByLabelText('Sync interval in minutes') as HTMLInputElement

    // Should initialize with the config value
    expect(intervalInput.value).toBe('15')

    // Try setting below minimum (5)
    fireEvent.change(intervalInput, { target: { value: '2' } })
    expect(intervalInput.value).toBe('5') // Clamped to 5

    // Try setting above maximum (120)
    fireEvent.change(intervalInput, { target: { value: '200' } })
    expect(intervalInput.value).toBe('120') // Clamped to 120
  })

  // C-006: No redundant onKeyDown on checkbox
  it('should toggle sync checkbox via native click', async () => {
    render(<Settings />)

    const checkbox = screen.getByLabelText('Enable auto-sync') as HTMLInputElement

    // Default from mock config
    expect(checkbox.checked).toBe(true)

    fireEvent.click(checkbox)
    expect(checkbox.checked).toBe(false)

    fireEvent.click(checkbox)
    expect(checkbox.checked).toBe(true)
  })

  // C-006: Last sync time display
  it('should display last sync time when available', async () => {
    render(<Settings />)

    // The mock config has lastSyncAt set to '2026-03-01T10:00:00Z'
    expect(screen.getByText(/Last synced:/)).toBeInTheDocument()
  })
})
