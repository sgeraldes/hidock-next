import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Mic, FileText, Calendar, Play, X, RefreshCw, FolderOpen, ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { AudioPlayer } from '@/components/AudioPlayer'
import { formatDateTime, formatDuration } from '@/lib/utils'
import { parseJsonArray } from '@/types'

interface Recording {
  id: string
  filename: string
  original_filename?: string
  file_path: string
  file_size?: number
  duration_seconds?: number
  date_recorded: string
  meeting_id?: string
  correlation_confidence?: number
  correlation_method?: string
  status: string
  created_at: string
}

interface Transcript {
  id: string
  recording_id: string
  full_text: string
  language: string
  summary?: string
  action_items?: string
  topics?: string
  key_points?: string
  sentiment?: string
  speakers?: string
  word_count?: number
  transcription_provider?: string
  transcription_model?: string
  created_at: string
}

interface RecordingWithTranscript extends Recording {
  transcript?: Transcript
  meeting?: {
    id: string
    subject: string
    start_time: string
  }
}

export function Recordings() {
  const navigate = useNavigate()
  const [recordings, setRecordings] = useState<RecordingWithTranscript[]>([])
  const [loading, setLoading] = useState(true)
  const [playingRecordingId, setPlayingRecordingId] = useState<string | null>(null)
  const [expandedTranscripts, setExpandedTranscripts] = useState<Set<string>>(new Set())

  useEffect(() => {
    loadRecordings()
  }, [])

  const loadRecordings = async () => {
    setLoading(true)
    try {
      // Get all recordings from database
      const recs = await window.electronAPI.recordings.getAll()

      // Enrich with transcripts and meeting info
      const enriched: RecordingWithTranscript[] = await Promise.all(
        recs.map(async (rec: Recording) => {
          const transcript = await window.electronAPI.transcripts.getByRecordingId(rec.id)
          let meeting = undefined
          if (rec.meeting_id) {
            meeting = await window.electronAPI.meetings.getById(rec.meeting_id)
          }
          return { ...rec, transcript, meeting }
        })
      )

      // Sort by date recorded (newest first)
      enriched.sort((a, b) => new Date(b.date_recorded).getTime() - new Date(a.date_recorded).getTime())

      setRecordings(enriched)
    } catch (error) {
      console.error('Failed to load recordings:', error)
    } finally {
      setLoading(false)
    }
  }

  const toggleTranscript = (id: string) => {
    setExpandedTranscripts((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
  }

  const openRecordingsFolder = async () => {
    await window.electronAPI.storage.openFolder('recordings')
  }

  if (loading) {
    return (
      <div className="flex flex-col h-full">
        <header className="border-b px-6 py-4">
          <h1 className="text-2xl font-bold">Recordings</h1>
          <p className="text-sm text-muted-foreground">Your downloaded recordings and transcripts</p>
        </header>
        <div className="flex-1 flex items-center justify-center">
          <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="border-b px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Recordings</h1>
            <p className="text-sm text-muted-foreground">
              {recordings.length} recording{recordings.length !== 1 ? 's' : ''} downloaded
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={openRecordingsFolder}>
              <FolderOpen className="h-4 w-4 mr-2" />
              Open Folder
            </Button>
            <Button variant="outline" size="sm" onClick={loadRecordings}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-4xl mx-auto space-y-4">
          {recordings.length === 0 ? (
            <Card>
              <CardContent className="py-16 text-center">
                <Mic className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                <h3 className="text-lg font-medium mb-2">No Recordings Yet</h3>
                <p className="text-muted-foreground mb-4">
                  Connect your HiDock device and sync recordings to see them here.
                </p>
                <Button onClick={() => navigate('/device')}>
                  Go to Device
                </Button>
              </CardContent>
            </Card>
          ) : (
            recordings.map((recording) => (
              <Card key={recording.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <Mic className="h-5 w-5 text-green-600" />
                      <div>
                        <CardTitle className="text-base">{recording.filename}</CardTitle>
                        <CardDescription>
                          {formatDateTime(recording.date_recorded)}
                          {recording.file_size && ` • ${formatBytes(recording.file_size)}`}
                          {recording.duration_seconds && ` • ${formatDuration(recording.duration_seconds)}`}
                        </CardDescription>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-2 py-1 rounded-full ${
                        recording.status === 'transcribed'
                          ? 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300'
                          : recording.status === 'pending'
                          ? 'bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-300'
                          : 'bg-secondary'
                      }`}>
                        {recording.status}
                      </span>
                      {playingRecordingId === recording.id ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setPlayingRecordingId(null)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setPlayingRecordingId(recording.id)}
                          disabled={!recording.file_path}
                          title="Play recording"
                        >
                          <Play className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Audio Player */}
                  {playingRecordingId === recording.id && recording.file_path && (
                    <AudioPlayer
                      filePath={recording.file_path}
                      onClose={() => setPlayingRecordingId(null)}
                    />
                  )}

                  {/* Linked Meeting */}
                  {recording.meeting && (
                    <div
                      className="flex items-center gap-2 p-3 bg-muted rounded-lg cursor-pointer hover:bg-muted/80"
                      onClick={() => navigate(`/meeting/${recording.meeting!.id}`)}
                    >
                      <Calendar className="h-4 w-4 text-primary" />
                      <div>
                        <p className="text-sm font-medium">{recording.meeting.subject}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatDateTime(recording.meeting.start_time)}
                          {recording.correlation_confidence && (
                            <span className="ml-2">
                              • {(recording.correlation_confidence * 100).toFixed(0)}% match
                            </span>
                          )}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Transcript */}
                  {recording.transcript && (
                    <div className="border rounded-lg">
                      <button
                        className="w-full flex items-center justify-between p-3 hover:bg-muted/50"
                        onClick={() => toggleTranscript(recording.id)}
                      >
                        <div className="flex items-center gap-2">
                          <FileText className="h-4 w-4" />
                          <span className="font-medium text-sm">Transcript</span>
                          {recording.transcript.word_count && (
                            <span className="text-xs text-muted-foreground">
                              ({recording.transcript.word_count} words)
                            </span>
                          )}
                        </div>
                        {expandedTranscripts.has(recording.id) ? (
                          <ChevronUp className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                      </button>

                      {expandedTranscripts.has(recording.id) && (
                        <div className="p-3 pt-0 space-y-3">
                          {/* Summary */}
                          {recording.transcript.summary && (
                            <div className="p-3 bg-muted rounded-lg">
                              <p className="text-xs font-medium text-muted-foreground mb-1">Summary</p>
                              <p className="text-sm">{recording.transcript.summary}</p>
                            </div>
                          )}

                          {/* Action Items */}
                          {recording.transcript.action_items && (
                            <div>
                              <p className="text-xs font-medium text-muted-foreground mb-1">Action Items</p>
                              <ul className="list-disc list-inside text-sm space-y-1">
                                {parseJsonArray<string>(recording.transcript.action_items).map((item, i) => (
                                  <li key={i}>{item}</li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {/* Key Points */}
                          {recording.transcript.key_points && (
                            <div>
                              <p className="text-xs font-medium text-muted-foreground mb-1">Key Points</p>
                              <ul className="list-disc list-inside text-sm space-y-1">
                                {parseJsonArray<string>(recording.transcript.key_points).map((item, i) => (
                                  <li key={i}>{item}</li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {/* Topics */}
                          {recording.transcript.topics && (
                            <div>
                              <p className="text-xs font-medium text-muted-foreground mb-1">Topics</p>
                              <div className="flex flex-wrap gap-1">
                                {parseJsonArray<string>(recording.transcript.topics).map((topic, i) => (
                                  <span key={i} className="px-2 py-0.5 bg-secondary text-xs rounded-full">
                                    {topic}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Full Text */}
                          <details className="mt-2">
                            <summary className="text-sm text-primary cursor-pointer hover:underline">
                              View full transcript
                            </summary>
                            <p className="mt-2 text-sm whitespace-pre-wrap bg-muted p-3 rounded-lg max-h-64 overflow-auto">
                              {recording.transcript.full_text}
                            </p>
                          </details>

                          {/* Metadata */}
                          <div className="flex gap-4 text-xs text-muted-foreground pt-2 border-t">
                            {recording.transcript.language && (
                              <span>Language: {recording.transcript.language}</span>
                            )}
                            {recording.transcript.transcription_provider && (
                              <span>Provider: {recording.transcript.transcription_provider}</span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
