/**
 * DeviceFileList Component
 * Displays individual files from connected HiDock device with download/delete actions
 */

import { useState, useCallback } from 'react'
import { Download, Trash2, AlertCircle, CheckCircle, HardDrive, Volume2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { toast } from '@/components/ui/toaster'
import { getHiDockDeviceService } from '@/services/hidock-device'
import { hasDeviceFile, type DeviceOnlyRecording, type BothLocationsRecording } from '@/types/unified-recording'
import { formatBytes, formatDuration } from '@/utils/formatters'
import { useIsDownloading, useDownloadProgress } from '@/store/useAppStore'
import { useUIStore } from '@/store/ui/useUIStore'

interface DeviceFileListProps {
  recordings: Array<DeviceOnlyRecording | BothLocationsRecording>
  syncedFilenames: Set<string>
  onRefresh?: () => void
  // B-DEV-002: Callback to refresh the full recordings list after delete/download
  onRecordingsRefresh?: () => void
}

/**
 * C-004: Check if a filename is synced, accounting for .hda->.mp3 and .hda->.wav normalization
 * Exported for testing.
 */
export function isFilenameSynced(filename: string, syncedFilenames: Set<string>): boolean {
  if (syncedFilenames.has(filename)) return true
  // Check .mp3 normalized name
  const mp3Name = filename.replace(/\.hda$/i, '.mp3')
  if (mp3Name !== filename && syncedFilenames.has(mp3Name)) return true
  // Check .wav normalized name (legacy)
  const wavName = filename.replace(/\.hda$/i, '.wav')
  if (wavName !== filename && syncedFilenames.has(wavName)) return true
  return false
}

interface DeviceFileRowProps {
  recording: DeviceOnlyRecording | BothLocationsRecording
  downloadErrors: Map<string, string>
  currentlyPlayingId: string | null
  isPlaying: boolean
  onDownload: (filename: string, fileSize: number) => void
  onDeleteClick: (filename: string) => void
}

function DeviceFileRow({
  recording,
  downloadErrors,
  currentlyPlayingId,
  isPlaying,
  onDownload,
  onDeleteClick,
}: DeviceFileRowProps) {
  const filename = recording.deviceFilename
  const isDownloading = useIsDownloading(recording.id)
  const downloadProgress = useDownloadProgress(recording.id)

  // FL-002: Show "—" for unknown/zero duration instead of "0:00"
  const durationDisplay = (!recording.duration || recording.duration === 0)
    ? '—'
    : formatDuration(recording.duration)

  const hasError = downloadErrors.has(recording.id) && !isDownloading
  const isCurrentlyPlaying = currentlyPlayingId === recording.id && isPlaying

  // FL-004: Download button only shown for device-only files not currently downloading
  const showDownloadButton = recording.location === 'device-only' && !isDownloading

  return (
    <div
      className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 transition-colors"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="font-medium text-sm truncate">{filename}</p>

          {/* Status badges — spec-device-file-status-badges */}
          <div className="flex items-center gap-1.5">
            {/* Download Progress — supersedes location badge */}
            {isDownloading ? (
              <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                <Download className="h-3 w-3" />
                {downloadProgress ?? 0}%
              </span>
            ) : (
              /* Primary location badge */
              recording.location === 'device-only' ? (
                <span className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                  <HardDrive className="h-3 w-3" />
                  On Device
                </span>
              ) : recording.location === 'both' ? (
                <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                  <CheckCircle className="h-3 w-3" />
                  Downloaded
                </span>
              ) : (
                <span className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400">
                  <CheckCircle className="h-3 w-3" />
                  Synced
                </span>
              )
            )}

            {/* Error badge (alongside primary) */}
            {hasError && (
              <span className="flex items-center gap-1 text-xs text-destructive">
                <AlertCircle className="h-3 w-3" />
                Error
              </span>
            )}

            {/* Playing badge (alongside primary) */}
            {isCurrentlyPlaying && (
              <span className="flex items-center gap-1 text-xs text-purple-600 dark:text-purple-400">
                <Volume2 className="h-3 w-3" />
                Playing
              </span>
            )}
          </div>
        </div>

        {/* B-DEV-004: Use correct property names from RecordingBase: size, dateRecorded */}
        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
          <span>{formatBytes(recording.size)}</span>
          <span>{durationDisplay}</span>
          <span>{recording.dateRecorded?.toLocaleDateString()}</span>
        </div>
      </div>

      <div className="flex items-center gap-2 ml-4">
        {showDownloadButton && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onDownload(filename, recording.size)}
          >
            <Download className="h-4 w-4 mr-1" />
            Download
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={() => onDeleteClick(filename)}
          className="text-destructive hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

export function DeviceFileList({ recordings, syncedFilenames, onRefresh, onRecordingsRefresh }: DeviceFileListProps) {
  const deviceService = getHiDockDeviceService()
  const [downloadErrors, setDownloadErrors] = useState<Map<string, string>>(new Map())
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [fileToDelete, setFileToDelete] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const currentlyPlayingId = useUIStore((s) => s.currentlyPlayingId)
  const isPlaying = useUIStore((s) => s.isPlaying)

  // Filter to only show device-accessible recordings
  const deviceRecordings = recordings.filter(rec => hasDeviceFile(rec))

  // Handle individual file download
  const handleDownloadFile = useCallback(async (filename: string, fileSize: number) => {
    // Clear any prior error for this file before starting
    const recordingId = deviceRecordings.find(r => r.deviceFilename === filename)?.id
    if (recordingId) {
      setDownloadErrors(prev => { const m = new Map(prev); m.delete(recordingId); return m })
    }

    try {
      const success = await deviceService.downloadRecordingToFile(filename, fileSize)

      if (success) {
        toast.success(`Downloaded ${filename}`)
        onRefresh?.()
        // B-DEV-002: Refresh the full recordings list after download
        onRecordingsRefresh?.()
      } else {
        toast.error(`Failed to download ${filename}`)
        if (recordingId) {
          setDownloadErrors(prev => new Map(prev).set(recordingId, 'Download failed'))
        }
      }
    } catch (error: any) {
      console.error('[DeviceFileList] Download error:', error)
      toast.error(error?.message || `Failed to download ${filename}`)
      if (recordingId) {
        setDownloadErrors(prev => new Map(prev).set(recordingId, error?.message || 'Download failed'))
      }
    }
  }, [deviceService, deviceRecordings, onRefresh, onRecordingsRefresh])

  // Handle delete confirmation dialog
  const handleDeleteClick = useCallback((filename: string) => {
    setFileToDelete(filename)
    setDeleteDialogOpen(true)
  }, [])

  // Handle confirmed delete
  // B-DEV-002: Also call onRecordingsRefresh to refresh the full file list after delete
  const handleConfirmDelete = useCallback(async () => {
    if (!fileToDelete) return

    setDeleting(true)
    try {
      const success = await deviceService.deleteRecording(fileToDelete)

      if (success) {
        toast.success(`Deleted ${fileToDelete} from device`)
        onRefresh?.()
        onRecordingsRefresh?.()
      } else {
        toast.error(`Failed to delete ${fileToDelete}`)
      }
    } catch (error: any) {
      console.error('[DeviceFileList] Delete error:', error)
      toast.error(error?.message || `Failed to delete ${fileToDelete}`)
    } finally {
      setDeleting(false)
      setDeleteDialogOpen(false)
      setFileToDelete(null)
    }
  }, [fileToDelete, deviceService, onRefresh, onRecordingsRefresh])

  if (deviceRecordings.length === 0) {
    return null
  }

  // FL-004: Use recording.location for delete dialog note (not isFilenameSynced string-match)
  const recordingToDelete = deviceRecordings.find(r => r.deviceFilename === fileToDelete)
  const hasLocalCopy = recordingToDelete?.location === 'both' || recordingToDelete?.location === 'local-only'

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Device Files ({deviceRecordings.length})</CardTitle>
          <CardDescription>
            Manage individual recordings on your HiDock device
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            {deviceRecordings.map(recording => (
              <DeviceFileRow
                key={recording.deviceFilename}
                recording={recording}
                downloadErrors={downloadErrors}
                currentlyPlayingId={currentlyPlayingId}
                isPlaying={isPlaying}
                onDownload={handleDownloadFile}
                onDeleteClick={handleDeleteClick}
              />
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-destructive" />
              Delete File from Device?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{fileToDelete}</strong> from your HiDock device?
              <br />
              <br />
              <span className="text-destructive font-medium">
                This action cannot be undone. The file will be permanently removed from the device.
              </span>
              {hasLocalCopy && (
                <span className="block mt-2 text-green-600 dark:text-green-400">
                  Note: A local copy exists in your library.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                handleConfirmDelete()
              }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? 'Deleting...' : 'Delete File'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
