/**
 * SourceReader Component
 *
 * Displays the selected recording in the center panel with:
 * - Audio playback controls
 * - Transcript viewer with timestamps
 * - Metadata display (editable when knowledgeCaptureId is present)
 *
 * Shows a placeholder message when no recording is selected.
 */

import { useState, useEffect, useCallback } from 'react'
import { TranscriptViewer } from './TranscriptViewer'
import { TranscriptionStatusBadge } from './TranscriptionStatusBadge'
import { getDisplayTitle } from '@/features/library/utils/getDisplayTitle'
import { AudioPlayer } from '@/components/AudioPlayer'
import { UnifiedRecording, hasLocalPath, isDeviceOnly } from '@/types/unified-recording'
import { Transcript, Meeting, parseJsonArray } from '@/types'
import { Calendar, Download, Trash2, Wand2, RefreshCw, Play, Square, Pencil, Check, Edit2, Link, X, ExternalLink, FolderOpen, AudioLines, MoreHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem
} from '@/components/ui/select'
import { toast } from '@/components/ui/toaster'
import { RecordingLinkDialog } from '@/components/RecordingLinkDialog'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { formatDateTime, formatDuration, formatBytes } from '@/lib/utils'

const CATEGORY_OPTIONS = [
  { value: 'meeting', label: 'Meeting' },
  { value: 'interview', label: 'Interview' },
  { value: '1:1', label: '1:1' },
  { value: 'brainstorm', label: 'Brainstorm' },
  { value: 'note', label: 'Note' },
  { value: 'other', label: 'Other' },
] as const

interface SourceReaderProps {
  recording: UnifiedRecording | null
  transcript?: Transcript
  meeting?: Meeting
  isPlaying?: boolean
  currentTimeMs?: number
  onPlay?: () => void
  onStop?: () => void
  onSeek?: (startMs: number, endMs?: number) => void
  // Action button callbacks
  onDownload?: () => void
  onTranscribe?: () => void
  onReprocessVibeVoice?: () => void
  onDelete?: () => void
  // State for button enabling/disabling
  deviceConnected?: boolean
  isDownloading?: boolean
  downloadProgress?: number
  isDeleting?: boolean
  // Navigation
  onNavigateToMeeting?: (meetingId: string) => void
  // Metadata editing callback
  onMetadataEdited?: () => void
}

export function SourceReader({
  recording,
  transcript,
  meeting,
  isPlaying = false,
  currentTimeMs = 0,
  onPlay,
  onStop,
  onSeek,
  onDownload,
  onTranscribe,
  onReprocessVibeVoice,
  onDelete,
  deviceConnected = false,
  isDownloading = false,
  downloadProgress,
  isDeleting = false,
  onNavigateToMeeting,
  onMetadataEdited
}: SourceReaderProps) {

  // Title editing state
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [editedTitle, setEditedTitle] = useState('')
  const [isSavingTitle, setIsSavingTitle] = useState(false)

  // Category saving state
  const [isSavingCategory, setIsSavingCategory] = useState(false)

  // Meeting link dialog state
  const [linkDialogOpen, setLinkDialogOpen] = useState(false)

  // Transcription warning state
  const [metadataEdited, setMetadataEdited] = useState(false)
  const [showTranscribeWarning, setShowTranscribeWarning] = useState(false)

  // Reset all state when recording changes
  useEffect(() => {
    setIsEditingTitle(false)
    setEditedTitle('')
    setLinkDialogOpen(false)
    setMetadataEdited(false)
    setShowTranscribeWarning(false)
  }, [recording?.id])

  const handleSaveTitle = useCallback(async () => {
    if (!recording?.knowledgeCaptureId) return
    const trimmed = editedTitle.trim()
    if (!trimmed) {
      setEditedTitle(recording.title || recording.filename)
      toast.error('Title cannot be empty')
      return
    }
    if (trimmed === (recording.title || recording.filename)) {
      setIsEditingTitle(false)
      return
    }
    setIsSavingTitle(true)
    try {
      const result = await window.electronAPI.knowledge.update(
        recording.knowledgeCaptureId,
        { title: trimmed }
      )
      if (result.success) {
        setIsEditingTitle(false)
        setMetadataEdited(true)
        toast.success('Title updated')
        onMetadataEdited?.()
      } else {
        toast.error('Failed to save title')
      }
    } catch (err) {
      console.error('Failed to save title:', err)
      toast.error('Failed to save title')
    } finally {
      setIsSavingTitle(false)
    }
  }, [editedTitle, recording, onMetadataEdited])

  const handleCancelTitle = useCallback(() => {
    setIsEditingTitle(false)
    setEditedTitle('')
  }, [])

  const handleCategoryChange = useCallback(async (newCategory: string) => {
    if (!recording?.knowledgeCaptureId) return
    if (newCategory === recording.category) return
    setIsSavingCategory(true)
    try {
      const result = await window.electronAPI.knowledge.update(
        recording.knowledgeCaptureId,
        { category: newCategory }
      )
      if (result.success) {
        setMetadataEdited(true)
        toast.success('Category updated')
        onMetadataEdited?.()
      } else {
        toast.error('Failed to save category')
      }
    } catch (err) {
      console.error('Failed to save category:', err)
      toast.error('Failed to save category')
    } finally {
      setIsSavingCategory(false)
    }
  }, [recording, onMetadataEdited])

  const handleRemoveMeetingLink = useCallback(async () => {
    if (!recording) return
    try {
      await window.electronAPI.recordings.selectMeeting(recording.id, null)
      setMetadataEdited(true)
      onMetadataEdited?.()
    } catch (err) {
      console.error('Failed to remove meeting link:', err)
      toast.error('Failed to remove meeting link')
    }
  }, [recording, onMetadataEdited])

  const handleTranscribeClick = useCallback(() => {
    if (metadataEdited) {
      setShowTranscribeWarning(true)
    } else {
      onTranscribe?.()
    }
  }, [metadataEdited, onTranscribe])

  if (!recording) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <div className="text-center space-y-2">
          <p className="text-lg font-medium">No recording selected</p>
          <p className="text-sm">Select a recording from the list to view details</p>
        </div>
      </div>
    )
  }

  const canPlay = hasLocalPath(recording)

  // Same title resolver the list row uses, so clicking a row and the detail
  // header always agree (no raw filename leaking through here).
  const { primaryText: displayTitle } = getDisplayTitle(recording, meeting, transcript)

  const linkDialogRecording = {
    id: recording.id,
    filename: recording.filename,
    date_recorded: recording.dateRecorded instanceof Date
      ? recording.dateRecorded.toISOString()
      : String(recording.dateRecorded),
    duration_seconds: recording.duration ?? null
  }

  return (
    <div className="@container flex flex-col h-full overflow-hidden">
      {/* Single scroll container so the transcript is always reachable even when
          the pane is short; the audio player sticks to the top while scrolling. */}
      <div className="flex-1 min-h-0 overflow-y-auto">
      {/* Header with comprehensive metadata */}
      <div className="p-6 border-b space-y-4">
        <div>
          <div className="mb-4">
            {isEditingTitle ? (
              <div className="flex items-center gap-2">
                <Input
                  value={editedTitle}
                  onChange={(e) => setEditedTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveTitle()
                    if (e.key === 'Escape') handleCancelTitle()
                  }}
                  className="text-xl font-semibold h-auto py-1"
                  autoFocus
                  disabled={isSavingTitle}
                  aria-label="Recording title"
                />
                <Button variant="ghost" size="sm" onClick={handleSaveTitle} disabled={isSavingTitle} aria-label="Save title" title="Save (Enter)">
                  <Check className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="sm" onClick={handleCancelTitle} disabled={isSavingTitle} aria-label="Cancel editing" title="Cancel (Escape)">
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <div className="group flex items-center gap-2">
                <h2 className="text-xl font-semibold line-clamp-2 leading-tight" title={displayTitle}>
                  {displayTitle}
                </h2>
                {recording.knowledgeCaptureId && (
                  <button
                    onClick={() => {
                      setIsEditingTitle(true)
                      setEditedTitle(recording.title || displayTitle)
                    }}
                    className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 transition-opacity p-1 rounded hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                    aria-label="Edit title"
                    title="Edit title"
                  >
                    <Pencil className="h-4 w-4 text-muted-foreground" />
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Comprehensive Metadata Grid - same as SourceRowExpanded */}
          <div className="grid grid-cols-2 @md:grid-cols-3 @xl:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Date Recorded</p>
              <p>{(() => {
                const date = new Date(recording.dateRecorded)
                return !isNaN(date.getTime()) ? formatDateTime(date.toISOString()) : 'Unknown'
              })()}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Duration</p>
              <p>{recording.duration ? formatDuration(recording.duration) : 'Unknown'}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Size</p>
              <p>{recording.size ? formatBytes(recording.size) : 'Unknown'}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Quality</p>
              <p className="capitalize">{recording.quality || 'Standard'}</p>
            </div>
            {recording.knowledgeCaptureId ? (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Category</p>
                <Select
                  value={recording.category || ''}
                  onValueChange={handleCategoryChange}
                  disabled={isSavingCategory}
                >
                  <SelectTrigger className="h-7 text-sm w-[140px]">
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORY_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : recording.category ? (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Category</p>
                <p className="capitalize">{recording.category}</p>
              </div>
            ) : null}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Location</p>
              <p className="capitalize">{recording.location.replace('-', ' ')}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Transcription</p>
              <TranscriptionStatusBadge status={recording.transcriptionStatus} />
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Filename</p>
              <p className="truncate" title={recording.filename}>{recording.filename}</p>
            </div>
          </div>

          {/* Linked Meeting */}
          {meeting && (
            <div className="mt-4 flex items-center gap-2 p-3 bg-muted/30 border rounded-lg">
              <div
                className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer hover:opacity-80 transition-opacity"
                onClick={() => onNavigateToMeeting?.(meeting.id)}
              >
                <Calendar className="h-4 w-4 text-primary shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{meeting.subject}</p>
                  <p className="text-xs text-muted-foreground">{formatDateTime(meeting.start_time)}</p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={(e) => { e.stopPropagation(); setLinkDialogOpen(true) }}
                title="Change linked meeting"
              >
                <Edit2 className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                onClick={(e) => { e.stopPropagation(); handleRemoveMeetingLink() }}
                title="Remove meeting link"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}

          {/* Device-only notice */}
          {isDeviceOnly(recording) && (
            <p className="mt-3 text-xs text-muted-foreground italic">
              Download this capture to play it and generate a transcript.
            </p>
          )}
        </div>
      </div>

      {/* Action Buttons Section — one primary action, the rest demoted to
          secondary or an overflow menu so the row has a clear hierarchy and
          doesn't duplicate the bulk-actions bar. */}
      <div className="flex flex-wrap items-center gap-2 px-6 py-3 border-b bg-muted/30">
        {/* Primary action: Play/Stop for local files, Download for device-only */}
        {canPlay && onPlay ? (
          isPlaying ? (
            <Button size="sm" onClick={onStop} className="gap-2" title="Stop playback">
              <Square className="h-4 w-4" />
              Stop
            </Button>
          ) : (
            <Button size="sm" onClick={onPlay} className="gap-2" title="Play recording">
              <Play className="h-4 w-4" />
              Play
            </Button>
          )
        ) : isDeviceOnly(recording) && onDownload ? (
          <Button
            size="sm"
            onClick={onDownload}
            disabled={!deviceConnected || isDownloading}
            className="gap-2"
            title={!deviceConnected ? 'Device not connected' : 'Download recording from device'}
          >
            {isDownloading ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" />
                {downloadProgress !== undefined ? `${downloadProgress}%` : 'Downloading...'}
              </>
            ) : (
              <>
                <Download className="h-4 w-4" />
                Download
              </>
            )}
          </Button>
        ) : null}

        {/* Secondary: transcription actions stay visible for local files */}
        {hasLocalPath(recording) && recording.transcriptionStatus !== 'complete' && onTranscribe && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleTranscribeClick}
            disabled={recording.transcriptionStatus === 'pending' || recording.transcriptionStatus === 'processing'}
            className="gap-2"
            title={
              recording.transcriptionStatus === 'pending' ? 'Transcription queued' :
              recording.transcriptionStatus === 'processing' ? 'Transcription in progress' :
              'Start AI transcription'
            }
          >
            {recording.transcriptionStatus === 'processing' ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" />
                In Progress
              </>
            ) : recording.transcriptionStatus === 'pending' ? (
              <>
                <RefreshCw className="h-4 w-4" />
                Queued
              </>
            ) : (
              <>
                <Wand2 className="h-4 w-4" />
                Transcribe
              </>
            )}
          </Button>
        )}

        {hasLocalPath(recording) && onReprocessVibeVoice && (
          <Button
            variant="outline"
            size="sm"
            onClick={onReprocessVibeVoice}
            disabled={recording.transcriptionStatus === 'pending' || recording.transcriptionStatus === 'processing'}
            className="gap-2"
            title="Re-transcribe with VibeVoice (local, speaker-diarized)"
          >
            <AudioLines className="h-4 w-4" />
            VibeVoice
          </Button>
        )}

        {/* Overflow: file operations + destructive delete (behind a separator) */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" aria-label="More actions" title="More actions">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            {hasLocalPath(recording) && (
              <>
                <DropdownMenuItem onClick={() => window.electronAPI?.storage.openFile(recording.localPath)}>
                  <ExternalLink className="h-4 w-4" aria-hidden="true" />
                  Open in default app
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => window.electronAPI?.storage.revealInFolder(recording.localPath)}>
                  <FolderOpen className="h-4 w-4" aria-hidden="true" />
                  Reveal in folder
                </DropdownMenuItem>
              </>
            )}
            {!meeting && !isDeviceOnly(recording) && (
              <DropdownMenuItem onClick={() => setLinkDialogOpen(true)}>
                <Link className="h-4 w-4" aria-hidden="true" />
                Link meeting
              </DropdownMenuItem>
            )}
            {onDelete && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={onDelete}
                  disabled={(isDeviceOnly(recording) && !deviceConnected) || isDeleting}
                  className="text-destructive focus:text-destructive"
                >
                  {isDeleting ? (
                    <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  )}
                  {isDeviceOnly(recording) ? 'Delete from device'
                    : recording.location === 'local-only' ? 'Delete from computer'
                      : 'Delete everywhere'}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Audio Player — shown whenever recording has local file */}
      {canPlay && (
        <div className="sticky top-0 bg-background z-10 border-b">
          {/* No onClose here: the reader's player is always docked, so a
              "Close" button would mislead (it only stops). The transport's
              Square control already stops playback. */}
          <AudioPlayer key={recording.id} filename={recording.filename} />
        </div>
      )}

      {/* Transcript Content */}
      <div className="p-4">
        {transcript ? (
          <TranscriptViewer
            transcript={transcript.full_text}
            currentTimeMs={currentTimeMs}
            onSeek={onSeek || (() => {})}
            showSummary={true}
            showActionItems={true}
            summary={transcript.summary ?? undefined}
            actionItems={parseJsonArray<string>(transcript.action_items)}
          />
        ) : recording.transcriptionStatus === 'complete' ? (
          <div className="text-center text-muted-foreground py-8">
            <p>Transcript not available</p>
          </div>
        ) : recording.transcriptionStatus === 'pending' || recording.transcriptionStatus === 'processing' ? (
          <div className="text-center text-muted-foreground py-8">
            <p>Transcription in progress...</p>
          </div>
        ) : (
          <div className="text-center text-muted-foreground py-8">
            <p>No transcript available</p>
            {canPlay && (
              <p className="text-sm mt-2">
                Click &quot;Transcribe&quot; to generate a transcript
              </p>
            )}
          </div>
        )}
      </div>
      </div>

      {/* Meeting link dialog */}
      <RecordingLinkDialog
        recording={linkDialogOpen ? linkDialogRecording : null}
        meeting={meeting}
        open={linkDialogOpen}
        onClose={() => setLinkDialogOpen(false)}
        onResolved={() => {
          // Note: RecordingLinkDialog calls both onResolved and onClose internally
          // Do NOT call setLinkDialogOpen(false) here to avoid double-close
          setMetadataEdited(true)
          onMetadataEdited?.()
        }}
      />

      {/* Transcription overwrite warning */}
      <ConfirmDialog
        open={showTranscribeWarning}
        onOpenChange={(open) => setShowTranscribeWarning(open)}
        title="Transcription may overwrite your edits"
        description="You've manually edited this recording's metadata. The AI transcription process may overwrite your title, category, and summary changes. Do you want to continue?"
        actionLabel="Continue"
        cancelLabel="Cancel"
        variant="default"
        onConfirm={() => {
          onTranscribe?.()
          setMetadataEdited(false)
          setShowTranscribeWarning(false)
        }}
      />
    </div>
  )
}
