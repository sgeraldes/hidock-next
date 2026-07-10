import { useEffect, useState, useCallback, useMemo, type KeyboardEvent } from 'react'
import { Save, FolderOpen, RefreshCw, AlertCircle, Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { useAppStore, useCalendarSyncing } from '@/store/useAppStore'
import { useConfigStore } from '@/store/domain/useConfigStore'
import { formatBytes } from '@/lib/utils'
import { HealthCheck } from '@/components/HealthCheck'
import { ConnectorsSettings } from '@/components/settings/ConnectorsSettings'
import { toast } from '@/components/ui/toaster'
import type { StorageInfo, AppConfig } from '@/types'

// RAG configuration constants — MAX_CONTEXT_CHUNKS must match config.ts default (10)
const RAG_DEFAULTS = {
  MAX_CONTEXT_CHUNKS: 10,
  MIN_CONTEXT_CHUNKS: 1,
  MAX_CONTEXT_CHUNKS_LIMIT: 20
} as const

type StorageFolder = 'recordings' | 'transcripts' | 'data'

const STORAGE_CONFIG_KEYS: Record<StorageFolder, 'recordingsPath' | 'transcriptsPath' | 'dataPath'> = {
  recordings: 'recordingsPath',
  transcripts: 'transcriptsPath',
  data: 'dataPath'
}

const STORAGE_LABELS: Record<StorageFolder, string> = {
  recordings: 'Recordings',
  transcripts: 'Transcripts',
  data: 'Data'
}

export function Settings() {
  // SM-09 fix: Use granular selectors
  const syncCalendar = useAppStore((s) => s.syncCalendar)
  const calendarSyncing = useCalendarSyncing()
  const { config, loadConfig, updateConfig, configLoading } = useConfigStore()
  const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null)
  const [storageError, setStorageError] = useState<string | null>(null) // B-SET-002: Storage error state
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Local form state
  const [icsUrl, setIcsUrl] = useState('')
  const [syncEnabled, setSyncEnabled] = useState(true)
  const [syncInterval, setSyncInterval] = useState(15)
  const [transcriptionProvider, setTranscriptionProvider] = useState<'gemini' | 'local-asr' | 'vibevoice'>('gemini')
  const [geminiApiKey, setGeminiApiKey] = useState('')
  const [geminiModel, setGeminiModel] = useState('gemini-3.5-flash')
  const [localAsrPath, setLocalAsrPath] = useState('G:\\Code\\claude-plugins\\plugins\\mcp-asr')
  const [localAsrHfToken, setLocalAsrHfToken] = useState('')
  const [localAsrVocabularyFile, setLocalAsrVocabularyFile] = useState('vocabulary.json')
  const [localAsrDiarize, setLocalAsrDiarize] = useState(true)
  const [localAsrNumBeams, setLocalAsrNumBeams] = useState(5)
  const [chatProvider, setChatProvider] = useState<'gemini' | 'ollama'>('gemini')
  const [ollamaUrl, setOllamaUrl] = useState('http://localhost:11434')
  const [showApiKey, setShowApiKey] = useState(false)
  const [storageLoading, setStorageLoading] = useState(false)
  const [storagePaths, setStoragePaths] = useState<Record<StorageFolder, string>>({
    recordings: '',
    transcripts: '',
    data: ''
  })
  const [savingStorageFolder, setSavingStorageFolder] = useState<StorageFolder | null>(null)
  // C-CHAT: RAG context window — default matches config.ts (10)
  const [ragContextSize, setRagContextSize] = useState<number>(RAG_DEFAULTS.MAX_CONTEXT_CHUNKS)

  // Transcription models are loaded LIVE from the Gemini API (config:listGeminiModels)
  // and filtered to audio-capable models, so the picker never drifts out of sync
  // with the API (the old hand-maintained list wrongly offered TTS/Image/retired
  // models). This concrete fallback — preferring the rolling `-latest` aliases —
  // shows before the live list resolves or when offline / no key.
  const [geminiModels, setGeminiModels] = useState<{ value: string; label: string }[]>([
    { value: 'gemini-flash-latest', label: 'Gemini Flash (latest)' },
    { value: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
    { value: 'gemini-flash-lite-latest', label: 'Gemini Flash-Lite (latest)' },
    { value: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite' },
    { value: 'gemini-pro-latest', label: 'Gemini Pro (latest)' },
  ])
  const [modelsLive, setModelsLive] = useState(false)
  const [modelsLoading, setModelsLoading] = useState(false)

  const loadGeminiModels = useCallback(async () => {
    setModelsLoading(true)
    try {
      const res = await window.electronAPI.config.listGeminiModels()
      const data = res?.success ? res.data : res // tolerate either envelope
      if (data?.models?.length) {
        setGeminiModels(data.models)
        setModelsLive(!!data.ok)
      }
    } catch {
      // keep the fallback list (e.g. IPC not yet available before a restart)
    } finally {
      setModelsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadGeminiModels()
  }, [loadGeminiModels])

  // Always include the currently-saved model in the options so the <select> can
  // render it even if the live list filtered it out (e.g. a custom/older id).
  const geminiModelOptions = useMemo(() => {
    if (!geminiModel || geminiModels.some((m) => m.value === geminiModel)) return geminiModels
    return [{ value: geminiModel, label: `${geminiModel} (saved)` }, ...geminiModels]
  }, [geminiModels, geminiModel])

  // Validation function for config values
  const validateConfig = useCallback((updates: Partial<AppConfig>): string | null => {
    // Transcription settings validation
    if (updates.transcription) {
      if (
        (updates.transcription.provider === 'local-asr' || updates.transcription.provider === 'vibevoice') &&
        !updates.transcription.localAsrPath?.trim()
      ) {
        return 'ASR MCP path is required'
      }
      if (
        updates.transcription.provider === 'local-asr' &&
        updates.transcription.localAsrDiarize !== false &&
        !updates.transcription.localAsrHfToken?.trim()
      ) {
        return 'Hugging Face token is required for Local ASR speaker diarization'
      }
      if (
        updates.transcription.localAsrNumBeams !== undefined &&
        (updates.transcription.localAsrNumBeams < 1 || updates.transcription.localAsrNumBeams > 10)
      ) {
        return 'Local ASR beam search must be between 1 and 10'
      }
      if (updates.transcription.geminiApiKey !== undefined) {
        const apiKey = updates.transcription.geminiApiKey.trim()
        if (apiKey && apiKey.length < 10) {
          return 'API key must be at least 10 characters'
        }
        if (apiKey && !apiKey.startsWith('AIza')) {
          return 'Gemini API keys should start with "AIza". Please verify your key.'
        }
      }
    }

    // Calendar settings validation
    if (updates.calendar) {
      if (updates.calendar.icsUrl !== undefined) {
        const url = updates.calendar.icsUrl.trim()
        if (url && !url.startsWith('http')) {
          return 'Calendar URL must start with http:// or https://'
        }
      }
      if (updates.calendar.syncIntervalMinutes !== undefined) {
        const interval = updates.calendar.syncIntervalMinutes
        if (interval < 5 || interval > 120) {
          return 'Sync interval must be between 5 and 120 minutes'
        }
      }
    }

    // Embeddings settings validation
    if (updates.embeddings) {
      if (updates.embeddings.ollamaBaseUrl !== undefined) {
        const url = updates.embeddings.ollamaBaseUrl.trim()
        if (url && !url.startsWith('http')) {
          return 'Ollama URL must start with http:// or https://'
        }
      }
    }

    return null // Valid
  }, [])

  // C-SET: Track form dirty state per section
  const isCalendarDirty = useMemo(() => {
    if (!config) return false
    return (
      icsUrl !== config.calendar.icsUrl ||
      syncEnabled !== config.calendar.syncEnabled ||
      syncInterval !== config.calendar.syncIntervalMinutes
    )
  }, [config, icsUrl, syncEnabled, syncInterval])

  const isTranscriptionDirty = useMemo(() => {
    if (!config) return false
    return (
      transcriptionProvider !== (config.transcription.provider || 'gemini') ||
      geminiApiKey !== config.transcription.geminiApiKey ||
      geminiModel !== (config.transcription.geminiModel || 'gemini-2.5-flash') ||
      localAsrPath !== (config.transcription.localAsrPath || 'G:\\Code\\claude-plugins\\plugins\\mcp-asr') ||
      localAsrHfToken !== (config.transcription.localAsrHfToken || '') ||
      localAsrVocabularyFile !== (config.transcription.localAsrVocabularyFile || 'vocabulary.json') ||
      localAsrDiarize !== (config.transcription.localAsrDiarize ?? true) ||
      localAsrNumBeams !== (config.transcription.localAsrNumBeams || 5)
    )
  }, [config, transcriptionProvider, geminiApiKey, geminiModel, localAsrPath, localAsrHfToken, localAsrVocabularyFile, localAsrDiarize, localAsrNumBeams])

  const isChatDirty = useMemo(() => {
    if (!config) return false
    return (
      chatProvider !== config.chat.provider ||
      ollamaUrl !== config.embeddings.ollamaBaseUrl ||
      ragContextSize !== config.chat.maxContextChunks
    )
  }, [config, chatProvider, ollamaUrl, ragContextSize])

  // Stable loadConfig with useCallback for dependency array
  const loadConfigStable = useCallback(async () => {
    try {
      setLoadError(null)
      await loadConfig()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load settings'
      setLoadError(message)
      toast.error('Failed to Load Settings', message)
    }
  }, [loadConfig])

  useEffect(() => {
    loadConfigStable()
    loadStorageInfo()
  }, [loadConfigStable])

  useEffect(() => {
    if (config) {
      setIcsUrl(config.calendar.icsUrl)
      setSyncEnabled(config.calendar.syncEnabled)
      setSyncInterval(config.calendar.syncIntervalMinutes)
      setTranscriptionProvider(config.transcription.provider || 'gemini')
      setGeminiApiKey(config.transcription.geminiApiKey)
      setGeminiModel(config.transcription.geminiModel || 'gemini-2.5-flash')
      setLocalAsrPath(config.transcription.localAsrPath || 'G:\\Code\\claude-plugins\\plugins\\mcp-asr')
      setLocalAsrHfToken(config.transcription.localAsrHfToken || '')
      setLocalAsrVocabularyFile(config.transcription.localAsrVocabularyFile || 'vocabulary.json')
      setLocalAsrDiarize(config.transcription.localAsrDiarize ?? true)
      setLocalAsrNumBeams(config.transcription.localAsrNumBeams || 5)
      setChatProvider(config.chat.provider)
      setOllamaUrl(config.embeddings.ollamaBaseUrl)
      // C-CHAT: Load RAG context window size
      setRagContextSize(config.chat.maxContextChunks)
    }
  }, [config])

  useEffect(() => {
    if (storageInfo) {
      setStoragePaths({
        recordings: config?.storage?.recordingsPath || storageInfo.recordingsPath || '',
        transcripts: config?.storage?.transcriptsPath || storageInfo.transcriptsPath || '',
        data: config?.storage?.dataPath || storageInfo.dataPath || ''
      })
    }
  }, [config?.storage?.dataPath, config?.storage?.recordingsPath, config?.storage?.transcriptsPath, storageInfo])

  const loadStorageInfo = async () => {
    try {
      setStorageError(null) // B-SET-002: Clear previous error
      setStorageLoading(true)
      const result = await window.electronAPI.storage.getInfo()
      if (result.success && result.data) {
        setStorageInfo(result.data)
      } else {
        // B-SET-002: Surface storage errors to user
        const errorMsg = result.error || 'Failed to load storage info'
        setStorageError(typeof errorMsg === 'string' ? errorMsg : String(errorMsg))
        console.error('Failed to load storage info:', result.error)
      }
    } catch (error) {
      // B-SET-002: Surface storage errors to user
      const errorMsg = error instanceof Error ? error.message : 'Failed to load storage info'
      setStorageError(errorMsg)
      console.error('Failed to load storage info:', error)
    } finally {
      setStorageLoading(false)
    }
  }

  const handleSaveCalendar = async () => {
    if (saving) {
      toast.warning('Please wait', 'Previous save in progress')
      return
    }

    // Store previous values for rollback
    const previousIcsUrl = config?.calendar.icsUrl || ''
    const previousSyncEnabled = config?.calendar.syncEnabled ?? true
    const previousSyncInterval = config?.calendar.syncIntervalMinutes || 15

    const updates = {
      icsUrl,
      syncEnabled,
      syncIntervalMinutes: syncInterval
    }

    // Validate before save - validateConfig accepts any shape
    const validationError = validateConfig({ calendar: updates } as Partial<AppConfig>)
    if (validationError) {
      toast.error('Validation Error', validationError)
      return
    }

    setSaving(true)
    try {
      await updateConfig('calendar', updates)

      toast.success('Settings Saved', 'Calendar settings have been updated')
    } catch (error) {
      // Rollback on error
      setIcsUrl(previousIcsUrl)
      setSyncEnabled(previousSyncEnabled)
      setSyncInterval(previousSyncInterval)

      const message = error instanceof Error ? error.message : 'Failed to save calendar settings'
      toast.error('Save Failed', message)
      console.error('Failed to save calendar settings:', error)
    } finally {
      setSaving(false)
    }
  }

  const handleSaveTranscription = async () => {
    if (saving) {
      toast.warning('Please wait', 'Previous save in progress')
      return
    }

    // Store previous values for rollback
    const previousApiKey = config?.transcription.geminiApiKey || ''
    const previousModel = config?.transcription.geminiModel || 'gemini-2.5-flash'
    const previousProvider = config?.transcription.provider || 'gemini'
    const previousLocalAsrPath = config?.transcription.localAsrPath || 'G:\\Code\\claude-plugins\\plugins\\mcp-asr'
    const previousLocalAsrHfToken = config?.transcription.localAsrHfToken || ''
    const previousLocalAsrVocabularyFile = config?.transcription.localAsrVocabularyFile || 'vocabulary.json'
    const previousLocalAsrDiarize = config?.transcription.localAsrDiarize ?? true
    const previousLocalAsrNumBeams = config?.transcription.localAsrNumBeams || 5

    const updates = {
      provider: transcriptionProvider,
      geminiApiKey,
      geminiModel,
      localAsrPath,
      localAsrHfToken,
      localAsrVocabularyFile,
      localAsrDiarize,
      localAsrNumBeams
    }

    // Validate before save
    const validationError = validateConfig({ transcription: updates } as Partial<AppConfig>)
    if (validationError) {
      toast.error('Validation Error', validationError)
      return
    }

    setSaving(true)
    try {
      await updateConfig('transcription', updates)

      toast.success(
        'Settings Saved',
        transcriptionProvider === 'local-asr'
          ? 'Transcription provider set to Local ASR'
          : `Transcription provider set to ${geminiModel}`
      )
    } catch (error) {
      // Rollback on error
      setTranscriptionProvider(previousProvider)
      setGeminiApiKey(previousApiKey)
      setGeminiModel(previousModel)
      setLocalAsrPath(previousLocalAsrPath)
      setLocalAsrHfToken(previousLocalAsrHfToken)
      setLocalAsrVocabularyFile(previousLocalAsrVocabularyFile)
      setLocalAsrDiarize(previousLocalAsrDiarize)
      setLocalAsrNumBeams(previousLocalAsrNumBeams)

      const message = error instanceof Error ? error.message : 'Failed to save transcription settings'
      toast.error('Save Failed', message)
      console.error('Failed to save transcription settings:', error)
    } finally {
      setSaving(false)
    }
  }

  const handleSaveChat = async () => {
    if (saving) {
      toast.warning('Please wait', 'Previous save in progress')
      return
    }

    // Store previous values for rollback
    const previousChatProvider = config?.chat.provider || 'gemini'
    const previousOllamaUrl = config?.embeddings.ollamaBaseUrl || 'http://localhost:11434'
    const previousContextSize = config?.chat.maxContextChunks || RAG_DEFAULTS.MAX_CONTEXT_CHUNKS

    const chatUpdates = {
      provider: chatProvider,
      maxContextChunks: ragContextSize
    }

    const embeddingsUpdates = {
      ollamaBaseUrl: ollamaUrl
    }

    // Validate before save
    const validationError = validateConfig({
      chat: chatUpdates,
      embeddings: embeddingsUpdates
    } as Partial<AppConfig>)
    if (validationError) {
      toast.error('Validation Error', validationError)
      return
    }

    setSaving(true)
    try {
      // Save both sections atomically using Promise.all to prevent partial state
      await Promise.all([
        updateConfig('chat', chatUpdates),
        updateConfig('embeddings', embeddingsUpdates)
      ])

      toast.success('Settings Saved', `Chat provider set to ${chatProvider}`)
    } catch (error) {
      // Rollback on error - both sections revert
      setChatProvider(previousChatProvider)
      setOllamaUrl(previousOllamaUrl)
      setRagContextSize(previousContextSize)
      // Reload config from backend to ensure consistency after partial failure
      try { await loadConfig() } catch { /* best effort reload */ }

      const message = error instanceof Error ? error.message : 'Failed to save chat settings'
      toast.error('Save Failed', message)
      console.error('Failed to save chat settings:', error)
    } finally {
      setSaving(false)
    }
  }

  const handleStoragePathChange = (folder: StorageFolder, value: string) => {
    setStoragePaths((prev) => ({ ...prev, [folder]: value }))
  }

  const getCurrentStoragePath = (folder: StorageFolder): string => {
    if (folder === 'recordings') {
      return config?.storage?.recordingsPath || storageInfo?.recordingsPath || ''
    }
    if (folder === 'transcripts') {
      return config?.storage?.transcriptsPath || storageInfo?.transcriptsPath || ''
    }
    return config?.storage?.dataPath || storageInfo?.dataPath || ''
  }

  const saveStoragePath = async (folder: StorageFolder, rawPath: string) => {
    if (!config) return

    const nextPath = rawPath.trim()
    if (!nextPath) {
      toast.error('Invalid Folder', 'Folder path cannot be empty')
      setStoragePaths((prev) => ({ ...prev, [folder]: getCurrentStoragePath(folder) }))
      return
    }

    if (nextPath === getCurrentStoragePath(folder)) return

    setSavingStorageFolder(folder)
    try {
      await updateConfig('storage', {
        [STORAGE_CONFIG_KEYS[folder]]: nextPath
      } as Partial<AppConfig['storage']>)
      setStoragePaths((prev) => ({ ...prev, [folder]: nextPath }))
      await loadStorageInfo()
      toast.success('Storage Folder Saved', `${STORAGE_LABELS[folder]} folder updated`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save storage folder'
      toast.error('Save Failed', message)
      setStoragePaths((prev) => ({ ...prev, [folder]: getCurrentStoragePath(folder) }))
    } finally {
      setSavingStorageFolder(null)
    }
  }

  const handleSelectStorageFolder = async (folder: StorageFolder) => {
    if (!window.electronAPI.storage.selectFolder) {
      toast.error(
        'Restart Required',
        'The folder picker was added to the Electron preload API. Restart the app once to use Browse.'
      )
      return
    }

    try {
      const result = await window.electronAPI.storage.selectFolder(storagePaths[folder] || getCurrentStoragePath(folder))
      if (!result.success) {
        toast.error('Folder Selection Failed', result.error || 'Could not open folder picker')
        return
      }
      if (!result.data) return

      setStoragePaths((prev) => ({ ...prev, [folder]: result.data! }))
      await saveStoragePath(folder, result.data)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not open folder picker'
      toast.error('Folder Selection Failed', message)
    }
  }

  const handleStoragePathKeyDown = (_folder: StorageFolder, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.currentTarget.blur()
    }
  }

  // Loading state
  if (configLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-full">
        <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground mb-4" />
        <p className="text-muted-foreground">Loading settings...</p>
      </div>
    )
  }

  // Error state with retry
  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6">
        <AlertCircle className="h-12 w-12 text-destructive mb-4" />
        <h2 className="text-xl font-semibold mb-2">Failed to Load Settings</h2>
        <p className="text-muted-foreground mb-4 text-center max-w-md">{loadError}</p>
        <Button onClick={loadConfigStable}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Retry
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <header className="border-b px-6 py-4">
        <h1 className="text-2xl font-bold">Settings</h1>
      </header>

      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-2xl mx-auto space-y-6">
          {/* Calendar Settings */}
          <Card>
            <CardHeader>
              <CardTitle>Calendar</CardTitle>
              <CardDescription>Configure calendar sync from Outlook</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label htmlFor="icsUrl" className="text-sm font-medium">ICS Calendar URL</label>
                <Input
                  id="icsUrl"
                  type="url"
                  placeholder="https://outlook.office365.com/owa/calendar/.../calendar.ics"
                  value={icsUrl}
                  onChange={(e) => setIcsUrl(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveCalendar()}
                  disabled={saving}
                  aria-label="ICS Calendar URL"
                  aria-describedby="icsUrl-description"
                  className="mt-1"
                />
                <p id="icsUrl-description" className="text-xs text-muted-foreground mt-1">
                  Publish your Outlook calendar and paste the ICS link here
                </p>
              </div>

              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="syncEnabled"
                    checked={syncEnabled}
                    onChange={(e) => setSyncEnabled(e.target.checked)}
                    disabled={saving}
                    aria-label="Enable auto-sync"
                    className="rounded"
                  />
                  <label htmlFor="syncEnabled" className="text-sm">
                    Auto-sync enabled
                  </label>
                </div>

                <div className="flex items-center gap-2">
                  <label htmlFor="syncInterval" className="text-sm">Every</label>
                  <Input
                    id="syncInterval"
                    type="number"
                    min={5}
                    max={120}
                    value={syncInterval}
                    onChange={(e) => {
                      const val = parseInt(e.target.value)
                      if (isNaN(val)) return
                      // Clamp to valid range
                      setSyncInterval(Math.min(120, Math.max(5, val)))
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && handleSaveCalendar()}
                    disabled={saving}
                    aria-label="Sync interval in minutes"
                    className="w-20"
                  />
                  <span className="text-sm">minutes</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  onClick={handleSaveCalendar}
                  disabled={saving || !isCalendarDirty}
                  aria-label="Save calendar settings"
                >
                  <Save className="h-4 w-4 mr-2" aria-hidden="true" />
                  {isCalendarDirty ? 'Save' : 'Saved'}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => syncCalendar()}
                  disabled={calendarSyncing || saving}
                  aria-label="Sync calendar now"
                >
                  <RefreshCw className={`h-4 w-4 mr-2 ${calendarSyncing ? 'animate-spin' : ''}`} aria-hidden="true" />
                  Sync Now
                </Button>
                {config?.calendar.lastSyncAt && (
                  <span className="text-xs text-muted-foreground ml-2">
                    Last synced: {new Date(config.calendar.lastSyncAt).toLocaleString()}
                  </span>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Connectors (Layer 2): external-system integrations */}
          <ConnectorsSettings />

          {/* Transcription Settings */}
          <Card>
            <CardHeader>
              <CardTitle>Transcription</CardTitle>
              <CardDescription>Choose cloud Gemini or local ASR for meeting transcripts</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label id="transcriptionProvider-label" className="text-sm font-medium">Provider</label>
                <div className="flex gap-2 mt-2" role="group" aria-labelledby="transcriptionProvider-label">
                  <Button
                    variant={transcriptionProvider === 'gemini' ? 'default' : 'outline'}
                    onClick={() => setTranscriptionProvider('gemini')}
                    disabled={saving}
                    aria-label="Use Gemini transcription provider"
                    aria-pressed={transcriptionProvider === 'gemini'}
                  >
                    Gemini
                  </Button>
                  <Button
                    variant={transcriptionProvider === 'local-asr' ? 'default' : 'outline'}
                    onClick={() => setTranscriptionProvider('local-asr')}
                    disabled={saving}
                    aria-label="Use local ASR transcription provider"
                    aria-pressed={transcriptionProvider === 'local-asr'}
                  >
                    Local ASR
                  </Button>
                  <Button
                    variant={transcriptionProvider === 'vibevoice' ? 'default' : 'outline'}
                    onClick={() => setTranscriptionProvider('vibevoice')}
                    disabled={saving}
                    aria-label="Use VibeVoice transcription provider"
                    aria-pressed={transcriptionProvider === 'vibevoice'}
                  >
                    VibeVoice
                  </Button>
                </div>
                {transcriptionProvider === 'vibevoice' && (
                  <p className="text-xs text-muted-foreground mt-2">
                    VibeVoice (microsoft/VibeVoice-ASR) runs locally for full-file / re-processing:
                    joint transcription, speaker diarization and timestamps in one pass. Auto-detects
                    language. Requires the optional <code>vibevoice</code> install in the ASR MCP project.
                  </p>
                )}
              </div>

              {transcriptionProvider === 'gemini' ? (
                <>
                  <div>
                    <label htmlFor="geminiApiKey" className="text-sm font-medium">Gemini API Key</label>
                    <div className="relative mt-1">
                      <Input
                        id="geminiApiKey"
                        type={showApiKey ? 'text' : 'password'}
                        placeholder="Enter your Gemini API key"
                        value={geminiApiKey}
                        onChange={(e) => setGeminiApiKey(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSaveTranscription()}
                        disabled={saving}
                        aria-label="Gemini API Key"
                        aria-describedby="geminiApiKey-description"
                        className="pr-10"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
                        onClick={() => setShowApiKey(!showApiKey)}
                        aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
                        tabIndex={-1}
                      >
                        {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                    </div>
                    <p id="geminiApiKey-description" className="text-xs text-muted-foreground mt-1">
                      Get your API key from{' '}
                      <a
                        href="https://aistudio.google.com/app/apikey"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        Google AI Studio
                      </a>
                    </p>
                  </div>

                  <div>
                    <label htmlFor="geminiModel" className="text-sm font-medium">Transcription Model</label>
                    <select
                      id="geminiModel"
                      value={geminiModel}
                      onChange={(e) => setGeminiModel(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSaveTranscription()}
                      disabled={saving}
                      aria-label="Transcription Model"
                      aria-describedby="geminiModel-description"
                      className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                    >
                      {geminiModelOptions.map((model) => (
                        <option key={model.value} value={model.value}>
                          {model.label}
                        </option>
                      ))}
                    </select>
                    <p id="geminiModel-description" className="text-xs text-muted-foreground mt-1">
                      {modelsLoading
                        ? 'Loading available models…'
                        : modelsLive
                          ? 'Live list from your Gemini API key (audio-capable models only).'
                          : 'Showing built-in defaults — add/verify your API key to load the live model list.'}
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label htmlFor="localAsrHfToken" className="text-sm font-medium">Hugging Face Token</label>
                    <div className="relative mt-1">
                      <Input
                        id="localAsrHfToken"
                        type={showApiKey ? 'text' : 'password'}
                        placeholder="hf_xxxxxxxxxxxxxxxxxxxx"
                        value={localAsrHfToken}
                        onChange={(e) => setLocalAsrHfToken(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSaveTranscription()}
                        disabled={saving}
                        aria-label="Hugging Face token for Local ASR"
                        aria-describedby="localAsrHfToken-description"
                        className="pr-10"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
                        onClick={() => setShowApiKey(!showApiKey)}
                        aria-label={showApiKey ? 'Hide token' : 'Show token'}
                        tabIndex={-1}
                      >
                        {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                    </div>
                    <p id="localAsrHfToken-description" className="text-xs text-muted-foreground mt-1">
                      Required by the local ASR diarization models. You must accept the model terms in Hugging Face first.
                    </p>
                  </div>

                  <div>
                    <label htmlFor="localAsrPath" className="text-sm font-medium">ASR MCP Path</label>
                    <Input
                      id="localAsrPath"
                      value={localAsrPath}
                      onChange={(e) => setLocalAsrPath(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSaveTranscription()}
                      disabled={saving}
                      aria-label="ASR MCP project path"
                      aria-describedby="localAsrPath-description"
                      className="mt-1 font-mono text-xs"
                    />
                    <p id="localAsrPath-description" className="text-xs text-muted-foreground mt-1">
                      Folder containing mcp_runner.py from the ASR MCP project
                    </p>
                  </div>

                  <div>
                    <label htmlFor="localAsrVocabularyFile" className="text-sm font-medium">Vocabulary File</label>
                    <Input
                      id="localAsrVocabularyFile"
                      value={localAsrVocabularyFile}
                      onChange={(e) => setLocalAsrVocabularyFile(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSaveTranscription()}
                      disabled={saving}
                      aria-label="Local ASR vocabulary file"
                      aria-describedby="localAsrVocabularyFile-description"
                      className="mt-1 font-mono text-xs"
                    />
                    <p id="localAsrVocabularyFile-description" className="text-xs text-muted-foreground mt-1">
                      Relative or absolute JSON correction file. Leave empty to disable corrections.
                    </p>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="localAsrDiarize"
                        checked={localAsrDiarize}
                        onChange={(e) => setLocalAsrDiarize(e.target.checked)}
                        disabled={saving}
                        aria-label="Enable speaker diarization"
                        className="rounded"
                      />
                      <label htmlFor="localAsrDiarize" className="text-sm">
                        Speaker diarization
                      </label>
                    </div>

                    <div className="flex items-center gap-2">
                      <label htmlFor="localAsrNumBeams" className="text-sm">Beams</label>
                      <Input
                        id="localAsrNumBeams"
                        type="number"
                        min={1}
                        max={10}
                        value={localAsrNumBeams}
                        onChange={(e) => {
                          const val = parseInt(e.target.value, 10)
                          if (!isNaN(val)) setLocalAsrNumBeams(Math.min(10, Math.max(1, val)))
                        }}
                        onKeyDown={(e) => e.key === 'Enter' && handleSaveTranscription()}
                        disabled={saving}
                        aria-label="Local ASR beam search width"
                        className="w-20"
                      />
                    </div>
                  </div>
                </>
              )}

              <Button
                onClick={handleSaveTranscription}
                disabled={saving || !isTranscriptionDirty}
                aria-label="Save transcription settings"
              >
                <Save className="h-4 w-4 mr-2" aria-hidden="true" />
                {isTranscriptionDirty ? 'Save' : 'Saved'}
              </Button>
            </CardContent>
          </Card>

          {/* Chat Settings */}
          <Card>
            <CardHeader>
              <CardTitle>Chat / RAG</CardTitle>
              <CardDescription>Configure chat provider for querying meetings</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label id="chatProvider-label" className="text-sm font-medium">Chat Provider</label>
                <div className="flex gap-2 mt-2" role="group" aria-labelledby="chatProvider-label">
                  <Button
                    variant={chatProvider === 'gemini' ? 'default' : 'outline'}
                    onClick={() => setChatProvider('gemini')}
                    onKeyDown={(e) => e.key === 'Enter' && setChatProvider('gemini')}
                    disabled={saving}
                    aria-label="Use Gemini chat provider"
                    aria-pressed={chatProvider === 'gemini'}
                  >
                    Gemini
                  </Button>
                  <Button
                    variant={chatProvider === 'ollama' ? 'default' : 'outline'}
                    onClick={() => setChatProvider('ollama')}
                    onKeyDown={(e) => e.key === 'Enter' && setChatProvider('ollama')}
                    disabled={saving}
                    aria-label="Use Ollama local chat provider"
                    aria-pressed={chatProvider === 'ollama'}
                  >
                    Ollama (Local)
                  </Button>
                </div>
              </div>

              {chatProvider === 'ollama' && (
                <div>
                  <label htmlFor="ollamaUrl" className="text-sm font-medium">Ollama URL</label>
                  <Input
                    id="ollamaUrl"
                    type="url"
                    placeholder="http://localhost:11434"
                    value={ollamaUrl}
                    onChange={(e) => setOllamaUrl(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSaveChat()}
                    disabled={saving}
                    aria-label="Ollama base URL"
                    aria-describedby="ollamaUrl-description"
                    className="mt-1"
                  />
                  <p id="ollamaUrl-description" className="text-xs text-muted-foreground mt-1">
                    URL of your local Ollama server
                  </p>
                </div>
              )}

              {/* C-CHAT: RAG Context Window Size */}
              <div>
                <label htmlFor="ragContextSize" className="text-sm font-medium">
                  RAG Context Window
                </label>
                <Input
                  id="ragContextSize"
                  type="number"
                  min={1}
                  max={20}
                  value={ragContextSize}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10)
                    if (!isNaN(val)) {
                      setRagContextSize(Math.min(20, Math.max(1, val)))
                    }
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveChat()}
                  disabled={saving}
                  aria-label="RAG context window size"
                  aria-describedby="ragContextSize-description"
                  className="mt-1"
                />
                <p id="ragContextSize-description" className="text-xs text-muted-foreground mt-1">
                  Number of knowledge chunks to retrieve for context (1-20). Default: 10
                </p>
              </div>

              <Button
                onClick={handleSaveChat}
                disabled={saving || !isChatDirty}
                aria-label="Save chat settings"
              >
                <Save className="h-4 w-4 mr-2" aria-hidden="true" />
                {isChatDirty ? 'Save' : 'Saved'}
              </Button>
            </CardContent>
          </Card>

          {/* Storage */}
          <Card>
            <CardHeader>
              <CardTitle>Storage</CardTitle>
              <CardDescription>Local data storage information</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Storage loading indicator */}
              {storageLoading && !storageInfo && (
                <div className="flex items-center gap-2 py-4 justify-center">
                  <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">Loading storage info...</span>
                </div>
              )}
              {/* B-SET-002: Storage error with retry button */}
              {storageError && (
                <div className="flex items-center gap-3 p-3 rounded-md bg-destructive/10 text-destructive border border-destructive/20">
                  <AlertCircle className="h-5 w-5 flex-shrink-0" />
                  <div className="flex-1 text-sm">{storageError}</div>
                  <Button variant="outline" size="sm" onClick={loadStorageInfo}>
                    <RefreshCw className="h-3 w-3 mr-1" />
                    Retry
                  </Button>
                </div>
              )}
              {storageInfo && (
                <>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-muted-foreground">Total Size</p>
                      <p className="font-medium">{formatBytes(storageInfo.totalSizeBytes)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Recordings</p>
                      <p className="font-medium">{storageInfo.recordingsCount} files</p>
                    </div>
                  </div>

                  <div className="space-y-3 text-sm">
                    {([
                      ['recordings', 'Recordings'],
                      ['transcripts', 'Transcripts'],
                      ['data', 'Data']
                    ] as const).map(([folder, label]) => (
                      <div key={folder} className="flex items-center gap-2 p-2 bg-muted/50 rounded">
                        <div className="flex-1 min-w-0">
                          <label htmlFor={`${folder}Path`} className="text-muted-foreground text-xs">
                            {label}
                          </label>
                          <Input
                            id={`${folder}Path`}
                            value={storagePaths[folder]}
                            onChange={(e) => handleStoragePathChange(folder, e.target.value)}
                            onBlur={(e) => saveStoragePath(folder, e.target.value)}
                            onKeyDown={(e) => handleStoragePathKeyDown(folder, e)}
                            disabled={savingStorageFolder === folder}
                            className="mt-1 h-8 font-mono text-xs"
                            title={storagePaths[folder]}
                            aria-label={`${label} folder path`}
                          />
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => handleSelectStorageFolder(folder)}
                          disabled={savingStorageFolder === folder}
                          aria-label={`Select ${label.toLowerCase()} folder`}
                        >
                          {savingStorageFolder === folder ? (
                            <RefreshCw className="h-4 w-4 animate-spin" />
                          ) : (
                            <FolderOpen className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Health Check & Advanced Operations */}
          <HealthCheck />
        </div>
      </div>
    </div>
  )
}

export default Settings
