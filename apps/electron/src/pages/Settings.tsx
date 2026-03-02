import { useEffect, useState, useCallback, useMemo } from 'react'
import { Save, FolderOpen, RefreshCw, AlertCircle, Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { useAppStore, useCalendarSyncing } from '@/store/useAppStore'
import { useConfigStore } from '@/store/domain/useConfigStore'
import { formatBytes } from '@/lib/utils'
import { HealthCheck } from '@/components/HealthCheck'
import { toast } from '@/components/ui/toaster'
import type { StorageInfo, AppConfig } from '@/types'

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
  const [geminiApiKey, setGeminiApiKey] = useState('')
  const [geminiModel, setGeminiModel] = useState('gemini-3-pro-preview')
  const [chatProvider, setChatProvider] = useState<'gemini' | 'ollama'>('gemini')
  const [ollamaUrl, setOllamaUrl] = useState('http://localhost:11434')
  const [showApiKey, setShowApiKey] = useState(false)
  const [storageLoading, setStorageLoading] = useState(false)

  // Available Gemini models for transcription (audio-capable)
  // From: https://ai.google.dev/gemini-api/docs/models
  const GEMINI_MODELS = [
    // Gemini 3 Series
    { value: 'gemini-3-pro-preview', label: 'Gemini 3 Pro Preview (Best quality)' },
    { value: 'gemini-3-pro-image-preview', label: 'Gemini 3 Pro Image Preview' },
    { value: 'gemini-3-flash-preview', label: 'Gemini 3 Flash Preview (Fast)' },
    // Gemini 2.5 Pro Series
    { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro (Stable)' },
    { value: 'gemini-2.5-pro-preview-tts', label: 'Gemini 2.5 Pro TTS Preview' },
    // Gemini 2.5 Flash Series
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (Stable)' },
    { value: 'gemini-2.5-flash-preview-09-2025', label: 'Gemini 2.5 Flash Preview' },
    { value: 'gemini-2.5-flash-image', label: 'Gemini 2.5 Flash Image' },
    { value: 'gemini-2.5-flash-native-audio-preview-12-2025', label: 'Gemini 2.5 Flash Native Audio (Dec 2025)' },
    { value: 'gemini-2.5-flash-native-audio-preview-09-2025', label: 'Gemini 2.5 Flash Native Audio (Sep 2025)' },
    { value: 'gemini-2.5-flash-preview-tts', label: 'Gemini 2.5 Flash TTS Preview' },
    // Gemini 2.5 Flash-Lite Series
    { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite (Stable)' },
    { value: 'gemini-2.5-flash-lite-preview-09-2025', label: 'Gemini 2.5 Flash Lite Preview' },
  ]

  // Validation function for config values
  const validateConfig = useCallback((updates: Partial<AppConfig>): string | null => {
    // Transcription settings validation
    if (updates.transcription) {
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
      geminiApiKey !== config.transcription.geminiApiKey ||
      geminiModel !== (config.transcription.geminiModel || 'gemini-3-pro-preview')
    )
  }, [config, geminiApiKey, geminiModel])

  const isChatDirty = useMemo(() => {
    if (!config) return false
    return (
      chatProvider !== config.chat.provider ||
      ollamaUrl !== config.embeddings.ollamaBaseUrl
    )
  }, [config, chatProvider, ollamaUrl])

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
      setGeminiApiKey(config.transcription.geminiApiKey)
      setGeminiModel(config.transcription.geminiModel || 'gemini-3-pro-preview')
      setChatProvider(config.chat.provider)
      setOllamaUrl(config.embeddings.ollamaBaseUrl)
    }
  }, [config])

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
      // TypeScript doesn't infer Partial correctly, use type assertion
      await updateConfig('calendar', updates as any)

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
    const previousModel = config?.transcription.geminiModel || 'gemini-3-pro-preview'

    const updates = {
      geminiApiKey,
      geminiModel
    }

    // Validate before save
    const validationError = validateConfig({ transcription: updates } as Partial<AppConfig>)
    if (validationError) {
      toast.error('Validation Error', validationError)
      return
    }

    setSaving(true)
    try {
      await updateConfig('transcription', updates as any)

      toast.success('Settings Saved', `Transcription provider set to ${geminiModel}`)
    } catch (error) {
      // Rollback on error
      setGeminiApiKey(previousApiKey)
      setGeminiModel(previousModel)

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

    const chatUpdates = {
      provider: chatProvider
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
        updateConfig('chat', chatUpdates as any),
        updateConfig('embeddings', embeddingsUpdates as any)
      ])

      toast.success('Settings Saved', `Chat provider set to ${chatProvider}`)
    } catch (error) {
      // Rollback on error - both sections revert
      setChatProvider(previousChatProvider)
      setOllamaUrl(previousOllamaUrl)
      // Reload config from backend to ensure consistency after partial failure
      try { await loadConfig() } catch { /* best effort reload */ }

      const message = error instanceof Error ? error.message : 'Failed to save chat settings'
      toast.error('Save Failed', message)
      console.error('Failed to save chat settings:', error)
    } finally {
      setSaving(false)
    }
  }

  const handleOpenFolder = async (folder: 'recordings' | 'transcripts' | 'data') => {
    await window.electronAPI.storage.openFolder(folder)
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

          {/* Transcription Settings */}
          <Card>
            <CardHeader>
              <CardTitle>Transcription</CardTitle>
              <CardDescription>Configure Gemini API for transcription</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
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
                  {GEMINI_MODELS.map((model) => (
                    <option key={model.value} value={model.value}>
                      {model.label}
                    </option>
                  ))}
                </select>
                <p id="geminiModel-description" className="text-xs text-muted-foreground mt-1">
                  Gemini 3 Pro provides the best transcription accuracy
                </p>
              </div>

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
                    <div className="flex items-center justify-between p-2 bg-muted/50 rounded">
                      <div className="flex-1 min-w-0">
                        <p className="text-muted-foreground text-xs">Recordings</p>
                        <p className="font-mono text-xs truncate" title={storageInfo.recordingsPath}>
                          {storageInfo.recordingsPath}
                        </p>
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => handleOpenFolder('recordings')}>
                        <FolderOpen className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="flex items-center justify-between p-2 bg-muted/50 rounded">
                      <div className="flex-1 min-w-0">
                        <p className="text-muted-foreground text-xs">Transcripts</p>
                        <p className="font-mono text-xs truncate" title={storageInfo.transcriptsPath}>
                          {storageInfo.transcriptsPath}
                        </p>
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => handleOpenFolder('transcripts')}>
                        <FolderOpen className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="flex items-center justify-between p-2 bg-muted/50 rounded">
                      <div className="flex-1 min-w-0">
                        <p className="text-muted-foreground text-xs">Data</p>
                        <p className="font-mono text-xs truncate" title={storageInfo.dataPath}>
                          {storageInfo.dataPath}
                        </p>
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => handleOpenFolder('data')}>
                        <FolderOpen className="h-4 w-4" />
                      </Button>
                    </div>
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
