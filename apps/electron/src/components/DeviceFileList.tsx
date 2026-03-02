/**
 * DeviceFileList Component
 * Displays individual files from connected HiDock device with download/delete actions
 */

import { useState, useCallback } from 'react'
import { Download, Trash2, AlertCircle, CheckCircle } from 'lucide-react'
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

export function DeviceFileList({ recordings, syncedFilenames, onRefresh, onRecordingsRefresh }: DeviceFileListProps) {
  const deviceService = getHiDockDeviceService()
  const [downloadingFiles, setDownloadingFiles] = useState<Set<string>>(new Set())
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [fileToDelete, setFileToDelete] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Filter to only show device-accessible recordings
  const deviceRecordings = recordings.filter(rec => hasDeviceFile(rec))

  // Handle individual file download
  const handleDownloadFile = useCallback(async (filename: string, fileSize: number) => {
    setDownloadingFiles(prev => new Set(prev).add(filename))

    try {
      const success = await deviceService.downloadRecordingToFile(filename, fileSize)

      if (success) {
        toast.success(`Downloaded ${filename}`)
        onRefresh?.()
        // B-DEV-002: Refresh the full recordings list after download
        onRecordingsRefresh?.()
      } else {
        toast.error(`Failed to download ${filename}`)
      }
    } catch (error: any) {
      console.error('[DeviceFileList] Download error:', error)
      toast.error(error?.message || `Failed to download ${filename}`)
    } finally {
      setDownloadingFiles(prev => {
        const next = new Set(prev)
        next.delete(filename)
        return next
      })
    }
  }, [deviceService, onRefresh, onRecordingsRefresh])

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

  // C-004: formatBytes and formatDuration are now imported from @/utils/formatters

  if (deviceRecordings.length === 0) {
    return null
  }

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
            {deviceRecordings.map(recording => {
              const filename = recording.deviceFilename
              // C-004: Check normalized filenames (.hda->.mp3, .hda->.wav) for sync status
              const isSynced = isFilenameSynced(filename, syncedFilenames)
              const isDownloading = downloadingFiles.has(filename)

              return (
                <div
                  key={filename}
                  className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-sm truncate">{filename}</p>
                      {isSynced && (
                        <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                          <CheckCircle className="h-3 w-3" />
                          Synced
                        </span>
                      )}
                    </div>
                    {/* B-DEV-004: Use correct property names from RecordingBase: size, dateRecorded */}
                    <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                      <span>{formatBytes(recording.size)}</span>
                      <span>{formatDuration(recording.duration)}</span>
                      <span>{recording.dateRecorded?.toLocaleDateString()}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 ml-4">
                    {!isSynced && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleDownloadFile(filename, recording.size)}
                        disabled={isDownloading}
                      >
                        <Download className="h-4 w-4 mr-1" />
                        {isDownloading ? 'Downloading...' : 'Download'}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleDeleteClick(filename)}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )
            })}
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
              {fileToDelete && isFilenameSynced(fileToDelete, syncedFilenames) && (
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
