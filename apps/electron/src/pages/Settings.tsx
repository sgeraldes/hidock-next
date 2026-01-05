import { useEffect, useState } from 'react'
import { Save, FolderOpen, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { useAppStore } from '@/store/useAppStore'
import { formatBytes } from '@/lib/utils'
import { HealthCheck } from '@/components/HealthCheck'
import type { StorageInfo } from '@/types'

export function Settings() {
  const { config, loadConfig, updateConfig, syncCalendar, calendarSyncing } = useAppStore()
  const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null)
  const [saving, setSaving] = useState(false)

  // Local form state
  const [icsUrl, setIcsUrl] = useState('')
  const [syncEnabled, setSyncEnabled] = useState(true)
  const [syncInterval, setSyncInterval] = useState(15)
  const [geminiApiKey, setGeminiApiKey] = useState('')
  const [chatProvider, setChatProvider] = useState<'gemini' | 'ollama'>('gemini')
  const [ollamaUrl, setOllamaUrl] = useState('http://localhost:11434')

  useEffect(() => {
    loadConfig()
    loadStorageInfo()
  }, [])

  useEffect(() => {
    if (config) {
      setIcsUrl(config.calendar.icsUrl)
      setSyncEnabled(config.calendar.syncEnabled)
      setSyncInterval(config.calendar.syncIntervalMinutes)
      setGeminiApiKey(config.transcription.geminiApiKey)
      setChatProvider(config.chat.provider)
      setOllamaUrl(config.embeddings.ollamaBaseUrl)
    }
  }, [config])

  const loadStorageInfo = async () => {
    try {
      const result = await window.electronAPI.storage.getInfo()
      if (result.success && result.data) {
        setStorageInfo(result.data)
      } else {
        console.error('Failed to load storage info:', result.error)
      }
    } catch (error) {
      console.error('Failed to load storage info:', error)
    }
  }

  const handleSaveCalendar = async () => {
    setSaving(true)
    try {
      await updateConfig('calendar', {
        icsUrl,
        syncEnabled,
        syncIntervalMinutes: syncInterval
      })
    } finally {
      setSaving(false)
    }
  }

  const handleSaveTranscription = async () => {
    setSaving(true)
    try {
      await updateConfig('transcription', {
        geminiApiKey
      })
    } finally {
      setSaving(false)
    }
  }

  const handleSaveChat = async () => {
    setSaving(true)
    try {
      await updateConfig('chat', {
        provider: chatProvider
      })
      await updateConfig('embeddings', {
        ollamaBaseUrl: ollamaUrl
      })
    } finally {
      setSaving(false)
    }
  }

  const handleOpenFolder = async (folder: 'recordings' | 'transcripts' | 'data') => {
    await window.electronAPI.storage.openFolder(folder)
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
                <label className="text-sm font-medium">ICS Calendar URL</label>
                <Input
                  type="url"
                  placeholder="https://outlook.office365.com/owa/calendar/.../calendar.ics"
                  value={icsUrl}
                  onChange={(e) => setIcsUrl(e.target.value)}
                  className="mt-1"
                />
                <p className="text-xs text-muted-foreground mt-1">
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
                    className="rounded"
                  />
                  <label htmlFor="syncEnabled" className="text-sm">
                    Auto-sync enabled
                  </label>
                </div>

                <div className="flex items-center gap-2">
                  <label className="text-sm">Every</label>
                  <Input
                    type="number"
                    min={5}
                    max={120}
                    value={syncInterval}
                    onChange={(e) => setSyncInterval(parseInt(e.target.value) || 15)}
                    className="w-20"
                  />
                  <span className="text-sm">minutes</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button onClick={handleSaveCalendar} disabled={saving}>
                  <Save className="h-4 w-4 mr-2" />
                  Save
                </Button>
                <Button variant="outline" onClick={() => syncCalendar()} disabled={calendarSyncing}>
                  <RefreshCw className={`h-4 w-4 mr-2 ${calendarSyncing ? 'animate-spin' : ''}`} />
                  Sync Now
                </Button>
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
                <label className="text-sm font-medium">Gemini API Key</label>
                <Input
                  type="password"
                  placeholder="Enter your Gemini API key"
                  value={geminiApiKey}
                  onChange={(e) => setGeminiApiKey(e.target.value)}
                  className="mt-1"
                />
                <p className="text-xs text-muted-foreground mt-1">
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

              <Button onClick={handleSaveTranscription} disabled={saving}>
                <Save className="h-4 w-4 mr-2" />
                Save
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
                <label className="text-sm font-medium">Chat Provider</label>
                <div className="flex gap-2 mt-2">
                  <Button
                    variant={chatProvider === 'gemini' ? 'default' : 'outline'}
                    onClick={() => setChatProvider('gemini')}
                  >
                    Gemini
                  </Button>
                  <Button
                    variant={chatProvider === 'ollama' ? 'default' : 'outline'}
                    onClick={() => setChatProvider('ollama')}
                  >
                    Ollama (Local)
                  </Button>
                </div>
              </div>

              {chatProvider === 'ollama' && (
                <div>
                  <label className="text-sm font-medium">Ollama URL</label>
                  <Input
                    type="url"
                    placeholder="http://localhost:11434"
                    value={ollamaUrl}
                    onChange={(e) => setOllamaUrl(e.target.value)}
                    className="mt-1"
                  />
                </div>
              )}

              <Button onClick={handleSaveChat} disabled={saving}>
                <Save className="h-4 w-4 mr-2" />
                Save
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
