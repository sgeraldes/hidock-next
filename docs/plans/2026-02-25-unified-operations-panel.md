# Unified Operations Panel & DRY Operation Handling

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Centralize all download/transcription operations behind a single hook, surface them in a sidebar operations panel with progress + cancel, add queue resilience (stall detection, retry, timeout), add QA Monitor toggle.

**Architecture:** A `useOperations()` hook wraps all IPC calls for downloads and transcriptions — every trigger site calls the hook instead of raw IPC. The sidebar gets an `OperationsPanel` component that reads from `useTranscriptionStore` + `useAppStore.downloadQueue`. `OperationController` wires IPC event listeners to populate the transcription store and runs a heartbeat for stall detection. Main-process transcription service gets cancel support.

**Tech Stack:** React 18, Zustand, Electron IPC, Radix UI (tooltips), Lucide icons, Vitest.

---

## Task 1: Add transcription cancel support to main process

**Files:**
- Modify: `electron/main/services/transcription.ts:46-96`
- Modify: `electron/main/services/database.ts` (near line 1828)
- Modify: `electron/main/ipc/recording-handlers.ts` (add new handlers)

**Step 1: Add `removeFromQueue` to database.ts**

In `electron/main/services/database.ts`, after the `updateQueueItem` function (around line 1856), add:

```typescript
export function removeFromQueue(id: string): void {
  run('DELETE FROM transcription_queue WHERE id = ?', [id])
}

export function removeFromQueueByRecordingId(recordingId: string): void {
  run('DELETE FROM transcription_queue WHERE recording_id = ?', [recordingId])
}

export function cancelPendingTranscriptions(): number {
  const pending = getQueueItems('pending')
  run("DELETE FROM transcription_queue WHERE status = 'pending'")
  // Reset recording status for cancelled items
  for (const item of pending) {
    updateRecordingStatus(item.recording_id, 'none')
  }
  return pending.length
}
```

**Step 2: Add cancel functions to transcription.ts**

In `electron/main/services/transcription.ts`, after `stopTranscriptionProcessor` (line 53), add:

```typescript
import { removeFromQueue, removeFromQueueByRecordingId, cancelPendingTranscriptions } from './database'

let cancelRequested = false

export function cancelTranscription(recordingId: string): void {
  removeFromQueueByRecordingId(recordingId)
  updateRecordingStatus(recordingId, 'none')
  notifyRenderer('transcription:cancelled', { recordingId })
}

export function cancelAllTranscriptions(): number {
  cancelRequested = true
  const count = cancelPendingTranscriptions()
  notifyRenderer('transcription:all-cancelled', { count })
  // Reset flag after current item finishes
  setTimeout(() => { cancelRequested = false }, 1000)
  return count
}
```

Also modify `processQueue` (line 55) to check `cancelRequested` between items:

In the `for` loop body (line 68), add at the start:
```typescript
if (cancelRequested) {
  console.log('Transcription cancelled by user')
  break
}
```

**Step 3: Register IPC handlers for cancel**

In `electron/main/ipc/recording-handlers.ts`, after the `recordings:getTranscriptionStatus` handler (around line 227), add:

```typescript
  ipcMain.handle('transcription:cancel', async (_, recordingId: string): Promise<{ success: boolean }> => {
    try {
      cancelTranscription(recordingId)
      return { success: true }
    } catch (error) {
      console.error('transcription:cancel error:', error)
      return { success: false }
    }
  })

  ipcMain.handle('transcription:cancelAll', async (): Promise<{ success: boolean; count: number }> => {
    try {
      const count = cancelAllTranscriptions()
      return { success: true, count }
    } catch (error) {
      console.error('transcription:cancelAll error:', error)
      return { success: false, count: 0 }
    }
  })

  ipcMain.handle('transcription:getQueue', async (): Promise<any[]> => {
    try {
      return getQueueItems()
    } catch (error) {
      console.error('transcription:getQueue error:', error)
      return []
    }
  })
```

Import the new functions at the top:
```typescript
import {
  transcribeManually,
  getTranscriptionStatus,
  startTranscriptionProcessor,
  stopTranscriptionProcessor,
  cancelTranscription,
  cancelAllTranscriptions
} from '../services/transcription'
import { getQueueItems } from '../services/database'
```

**Step 4: Expose in preload**

In `electron/preload/index.ts`, find the `recordings` section (around line 438) and add after `getTranscriptionStatus`:

```typescript
    getTranscriptionQueue: () => callIPC('transcription:getQueue'),
    cancelTranscription: (recordingId: string) => callIPC('transcription:cancel', recordingId),
    cancelAllTranscriptions: () => callIPC('transcription:cancelAll'),
```

**Step 5: Commit**

```
feat: add transcription cancel support to main process
```

---

## Task 2: Add `qaLogsEnabled` to UI store and wire QA Monitor toggle

**Files:**
- Modify: `src/store/ui/useUIStore.ts`
- Modify: `src/types/stores.ts` (UIStore interface)
- Modify: `src/services/qa-monitor.ts`

**Step 1: Add `qaLogsEnabled` state to UIStore type**

In `src/types/stores.ts`, find the `UIStore` interface and add:

```typescript
  qaLogsEnabled: boolean
  setQaLogsEnabled: (enabled: boolean) => void
```

**Step 2: Add to useUIStore**

In `src/store/ui/useUIStore.ts`, add to the store initialization (around line 10):

```typescript
  qaLogsEnabled: false,
  setQaLogsEnabled: (enabled: boolean) => {
    set({ qaLogsEnabled: enabled })
  },
```

**Step 3: Guard QA Monitor with store check and production check**

Rewrite `src/services/qa-monitor.ts`:

```typescript
import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useUIStore } from '@/store/ui/useUIStore'

const IS_PROD = typeof import.meta !== 'undefined' && import.meta.env?.PROD

function isQaEnabled(): boolean {
  if (IS_PROD) return false
  try {
    return useUIStore.getState().qaLogsEnabled
  } catch {
    return false
  }
}

export function NavigationLogger() {
  const location = useLocation()
  const qaEnabled = useUIStore((s) => s.qaLogsEnabled)

  useEffect(() => {
    if (IS_PROD || !qaEnabled) return
    console.log(`[QA-MONITOR] Navigation: -> ${location.pathname}${location.search}`)
    const pageName = location.pathname.replace('/', '') || 'home'
    performance.mark(`page-load-${pageName}-start`)
  }, [location, qaEnabled])

  return null
}

export function initInteractionLogger() {
  if (IS_PROD) return
  if (window.hasInitializedInteractionLogger) return
  window.hasInitializedInteractionLogger = true

  const getElementLabel = (el: HTMLElement): string => {
    const id = el.id ? `#${el.id}` : ''
    const text = el.innerText ? ` ("${el.innerText.slice(0, 20)}")` : ''
    const role = el.getAttribute('role') ? `[role="${el.getAttribute('role')}"]` : ''
    const ariaLabel = el.getAttribute('aria-label') ? `[aria-label="${el.getAttribute('aria-label')}"]` : ''
    return `${el.tagName.toLowerCase()}${id}${role}${ariaLabel}${text}`
  }

  window.addEventListener('click', (event) => {
    if (!isQaEnabled()) return
    const target = event.target as HTMLElement
    const interactive = target.closest('button, a, input, select, [role="button"]') || target
    console.log(`[QA-MONITOR] Interaction: Clicked ${getElementLabel(interactive as HTMLElement)}`)
  }, true)
}

export function initErrorLogger() {
  if (IS_PROD) return
  window.addEventListener('error', (event) => {
    if (!isQaEnabled()) return
    console.error(`[QA-MONITOR] Uncaught Error: ${event.message}`, event.error)
  })
  window.addEventListener('unhandledrejection', (event) => {
    if (!isQaEnabled()) return
    console.error(`[QA-MONITOR] Unhandled Promise Rejection:`, event.reason)
  })
}

export function logStateChange(storeName: string, partialState: any) {
  if (!isQaEnabled()) return
  const keys = Object.keys(partialState)
  const filteredKeys = keys.filter(k => !['meetings', 'recordings', 'unifiedRecordings', 'activityLog'].includes(k))
  if (filteredKeys.length > 0) {
    const updates = filteredKeys.reduce((acc, k) => ({ ...acc, [k]: partialState[k] }), {})
    console.log(`[QA-MONITOR] State [${storeName}]:`, updates)
  }
}

declare global {
  interface Window {
    hasInitializedInteractionLogger: boolean
  }
}
```

**Step 4: Commit**

```
feat: add QA monitor toggle with production guard
```

---

## Task 3: Create `useOperations()` hook

**Files:**
- Create: `src/hooks/useOperations.ts`

**Step 1: Write the hook**

```typescript
import { useCallback } from 'react'
import { toast } from '@/components/ui/toaster'
import { useTranscriptionStore } from '@/store/features/useTranscriptionStore'
import type { UnifiedRecording } from '@/types/unified-recording'
import { hasLocalPath, isDeviceOnly } from '@/types/unified-recording'

/**
 * Centralized hook for all download and transcription operations.
 *
 * Every component that triggers downloads or transcriptions MUST use this hook
 * instead of calling IPC directly. This ensures:
 * - Consistent toast notifications
 * - Store updates for sidebar panel
 * - Error handling with user-visible messages
 * - DRY: single place to change operation behavior
 */
export function useOperations() {
  const addToQueue = useTranscriptionStore((s) => s.addToQueue)

  // ── Transcription ──────────────────────────────────────

  const queueTranscription = useCallback(async (recording: UnifiedRecording) => {
    if (!hasLocalPath(recording)) {
      toast({ title: 'Cannot transcribe', description: 'File not available locally. Download first.', variant: 'error' })
      return false
    }
    if (recording.transcriptionStatus === 'processing' || recording.transcriptionStatus === 'complete') {
      return false
    }

    try {
      await window.electronAPI.recordings.updateStatus(recording.id, 'pending')
      addToQueue(recording.id, recording.id, recording.filename)
      toast({ title: 'Transcription queued', description: recording.filename })
      return true
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error'
      toast({ title: 'Failed to queue transcription', description: msg, variant: 'error' })
      return false
    }
  }, [addToQueue])

  const queueBulkTranscriptions = useCallback(async (recordings: UnifiedRecording[]) => {
    const eligible = recordings.filter(
      (r) => hasLocalPath(r) && r.transcriptionStatus !== 'processing' && r.transcriptionStatus !== 'complete'
    )
    if (eligible.length === 0) {
      toast({ title: 'No recordings to transcribe', description: 'All selected recordings are already transcribed or in progress.' })
      return 0
    }

    let queued = 0
    for (const recording of eligible) {
      try {
        await window.electronAPI.recordings.updateStatus(recording.id, 'pending')
        addToQueue(recording.id, recording.id, recording.filename)
        queued++
      } catch (e) {
        console.error('Failed to queue:', recording.filename, e)
      }
    }

    toast({ title: `${queued} transcription${queued > 1 ? 's' : ''} queued`, description: `Processing will begin shortly.` })
    return queued
  }, [addToQueue])

  const cancelTranscription = useCallback(async (recordingId: string) => {
    try {
      await window.electronAPI.recordings.cancelTranscription(recordingId)
      useTranscriptionStore.getState().remove(recordingId)
      toast({ title: 'Transcription cancelled' })
    } catch (e) {
      console.error('Failed to cancel transcription:', e)
    }
  }, [])

  const cancelAllTranscriptions = useCallback(async () => {
    try {
      const result = await window.electronAPI.recordings.cancelAllTranscriptions()
      useTranscriptionStore.getState().clear()
      toast({ title: 'All transcriptions cancelled', description: `${result.count} items removed from queue.` })
    } catch (e) {
      console.error('Failed to cancel transcriptions:', e)
    }
  }, [])

  // ── Downloads ──────────────────────────────────────────

  const queueDownload = useCallback(async (recording: UnifiedRecording) => {
    if (!isDeviceOnly(recording)) return false

    try {
      await window.electronAPI.downloadService.queueDownloads([{
        filename: 'deviceFilename' in recording ? recording.deviceFilename : recording.filename,
        size: recording.size,
        dateCreated: recording.dateRecorded.toISOString()
      }])
      toast({ title: 'Download started', description: recording.filename })
      return true
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error'
      toast({ title: 'Download failed', description: msg, variant: 'error' })
      return false
    }
  }, [])

  const queueBulkDownloads = useCallback(async (recordings: UnifiedRecording[]) => {
    const eligible = recordings.filter(isDeviceOnly)
    if (eligible.length === 0) return 0

    try {
      await window.electronAPI.downloadService.queueDownloads(
        eligible.map((r) => ({
          filename: 'deviceFilename' in r ? r.deviceFilename : r.filename,
          size: r.size,
          dateCreated: r.dateRecorded.toISOString()
        }))
      )
      toast({ title: `${eligible.length} download${eligible.length > 1 ? 's' : ''} queued` })
      return eligible.length
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error'
      toast({ title: 'Downloads failed', description: msg, variant: 'error' })
      return 0
    }
  }, [])

  const cancelAllDownloads = useCallback(async () => {
    try {
      await window.electronAPI.downloadService.cancelAll()
      toast({ title: 'All downloads cancelled' })
    } catch (e) {
      console.error('Failed to cancel downloads:', e)
    }
  }, [])

  return {
    // Transcription
    queueTranscription,
    queueBulkTranscriptions,
    cancelTranscription,
    cancelAllTranscriptions,
    // Downloads
    queueDownload,
    queueBulkDownloads,
    cancelAllDownloads
  }
}
```

**Step 2: Commit**

```
feat: create useOperations() hook for centralized operation handling
```

---

## Task 4: Wire transcription IPC events + stall detection in OperationController

**Files:**
- Modify: `src/components/OperationController.tsx:746-758`

**Step 1: Replace empty transcription polling with real event handling + stall detection**

Find the transcription polling block (lines 746-758). Replace it with:

```typescript
    // --- Transcription event listeners + queue hydration ---
    const transcriptionStore = useTranscriptionStore.getState()

    // Hydrate transcription queue from database on mount
    if (isElectron) {
      window.electronAPI.recordings.getTranscriptionQueue?.().then((items: any[]) => {
        const store = useTranscriptionStore.getState()
        store.clear()
        for (const item of items) {
          if (item.status === 'pending' || item.status === 'processing') {
            store.addToQueue(item.id, item.recording_id, item.filename || 'Unknown')
            if (item.status === 'processing') {
              store.updateProgress(item.id, 50)
            }
          }
        }
      }).catch(e => console.error('Failed to hydrate transcription queue:', e))
    }

    // Poll transcription status and update store (main process doesn't push events reliably)
    const transcriptionInterval = isElectron
      ? setInterval(async () => {
          try {
            const items = await window.electronAPI.recordings.getTranscriptionQueue?.()
            if (!items) return

            const store = useTranscriptionStore.getState()
            const currentIds = new Set<string>()

            for (const item of items) {
              currentIds.add(item.id)

              if (item.status === 'completed') {
                if (store.queue.has(item.id)) {
                  store.markCompleted(item.id, item.provider || 'gemini')
                }
              } else if (item.status === 'failed') {
                if (store.queue.has(item.id)) {
                  store.markFailed(item.id, item.error_message || 'Unknown error')
                }
              } else if (item.status === 'processing') {
                if (!store.queue.has(item.id)) {
                  store.addToQueue(item.id, item.recording_id, item.filename || 'Unknown')
                }
                store.updateProgress(item.id, 50) // Estimated since Gemini doesn't report progress
              } else if (item.status === 'pending') {
                if (!store.queue.has(item.id)) {
                  store.addToQueue(item.id, item.recording_id, item.filename || 'Unknown')
                }
              }
            }

            // Remove items from store that are no longer in the queue
            store.queue.forEach((_, id) => {
              if (!currentIds.has(id)) {
                store.remove(id)
              }
            })
          } catch (e) {
            // Ignore polling errors
          }
        }, 5000)
      : null
```

Add import at top of OperationController.tsx:
```typescript
import { useTranscriptionStore } from '@/store/features/useTranscriptionStore'
```

**Step 2: Add download stall detection**

After the transcription interval setup, add a stall-detection heartbeat:

```typescript
    // --- Stall detection heartbeat (every 15 seconds) ---
    const downloadProgressTimestamps = new Map<string, { progress: number; timestamp: number }>()
    const DOWNLOAD_STALL_TIMEOUT = 60_000 // 60 seconds with no progress = stalled

    const stallDetectionInterval = setInterval(() => {
      const { downloadQueue } = useAppStore.getState()
      const now = Date.now()

      downloadQueue.forEach((item, id) => {
        const prev = downloadProgressTimestamps.get(id)
        if (!prev) {
          downloadProgressTimestamps.set(id, { progress: item.progress, timestamp: now })
          return
        }

        if (item.progress !== prev.progress) {
          // Progress changed, update timestamp
          downloadProgressTimestamps.set(id, { progress: item.progress, timestamp: now })
        } else if (now - prev.timestamp > DOWNLOAD_STALL_TIMEOUT && item.progress > 0 && item.progress < 100) {
          // Stalled
          console.warn(`[OperationController] Download stalled: ${item.filename} at ${item.progress}%`)
          toast({
            title: 'Download stalled',
            description: `${item.filename} stopped at ${item.progress}%. Try cancelling and restarting.`,
            variant: 'error'
          })
          // Remove from tracking to avoid repeated toasts
          downloadProgressTimestamps.delete(id)
        }
      })

      // Clean up tracking for completed downloads
      for (const [id] of downloadProgressTimestamps) {
        if (!downloadQueue.has(id)) {
          downloadProgressTimestamps.delete(id)
        }
      }
    }, 15_000)
```

Add to the cleanup return:
```typescript
    return () => {
      // ... existing cleanup ...
      if (transcriptionInterval) clearInterval(transcriptionInterval)
      clearInterval(stallDetectionInterval)
      // ...
    }
```

**Step 3: Commit**

```
feat: wire transcription store hydration, polling, and download stall detection
```

---

## Task 5: Create OperationsPanel sidebar component

**Files:**
- Create: `src/components/layout/OperationsPanel.tsx`

**Step 1: Write the component**

```typescript
import { X, Download, Sparkles, RefreshCw, AlertCircle, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useAppStore } from '@/store/useAppStore'
import { useTranscriptionStore, useTranscriptionStats } from '@/store/features/useTranscriptionStore'
import { useOperations } from '@/hooks/useOperations'

interface OperationsPanelProps {
  sidebarOpen: boolean
}

export function OperationsPanel({ sidebarOpen }: OperationsPanelProps) {
  const downloadQueue = useAppStore((s) => s.downloadQueue)
  const deviceSyncProgress = useAppStore((s) => s.deviceSyncProgress)
  const deviceSyncEta = useAppStore((s) => s.deviceSyncEta)
  const transcriptionStats = useTranscriptionStats()
  const transcriptionQueue = useTranscriptionStore((s) => s.queue)
  const { cancelAllDownloads, cancelAllTranscriptions, cancelTranscription } = useOperations()

  const hasDownloads = downloadQueue.size > 0
  const hasTranscriptions = transcriptionStats.pending > 0 || transcriptionStats.processing > 0 || transcriptionStats.failed > 0
  const hasAnyOperations = hasDownloads || hasTranscriptions

  if (!hasAnyOperations) return null

  return (
    <div className="border-t border-slate-700 px-2 py-2 space-y-2">
      {/* Downloads Section */}
      {hasDownloads && (
        <div className="space-y-1">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-1.5 text-xs text-slate-300">
              <Download className="h-3 w-3 text-emerald-400 animate-pulse" />
              {sidebarOpen ? (
                <span>
                  Downloads{' '}
                  {deviceSyncProgress
                    ? `(${deviceSyncProgress.current}/${deviceSyncProgress.total})`
                    : `(${downloadQueue.size})`}
                </span>
              ) : (
                <span className="text-[10px] text-emerald-400">{downloadQueue.size}</span>
              )}
            </div>
            {sidebarOpen && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 text-slate-400 hover:text-red-400"
                      onClick={cancelAllDownloads}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Cancel all downloads</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>

          {sidebarOpen && (
            <div className="space-y-1.5 px-1">
              {/* Overall sync progress */}
              {deviceSyncProgress && deviceSyncProgress.total > 0 && (
                <div>
                  <div className="flex justify-between text-[10px] text-slate-400 mb-0.5">
                    <span>Overall</span>
                    <span>{Math.round((deviceSyncProgress.current / deviceSyncProgress.total) * 100)}%</span>
                  </div>
                  <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 transition-all duration-200"
                      style={{ width: `${(deviceSyncProgress.current / deviceSyncProgress.total) * 100}%` }}
                    />
                  </div>
                  {deviceSyncEta && deviceSyncEta > 0 && (
                    <div className="text-[10px] text-slate-500 mt-0.5">~{formatEta(deviceSyncEta)}</div>
                  )}
                </div>
              )}
              {/* Individual file progress (top 2) */}
              {Array.from(downloadQueue.entries()).slice(0, 2).map(([id, item]) => (
                <div key={id} className="space-y-0.5">
                  <div className="flex justify-between text-[10px]">
                    <span className="text-slate-400 truncate max-w-[120px]" title={item.filename}>
                      {item.filename.length > 20 ? `...${item.filename.slice(-17)}` : item.filename}
                    </span>
                    <span className="text-slate-500">{item.progress}%</span>
                  </div>
                  <div className="h-1 bg-slate-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 transition-all duration-200"
                      style={{ width: `${item.progress}%` }}
                    />
                  </div>
                </div>
              ))}
              {downloadQueue.size > 2 && (
                <div className="text-[10px] text-slate-500">+{downloadQueue.size - 2} more in queue</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Transcriptions Section */}
      {hasTranscriptions && (
        <div className="space-y-1">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-1.5 text-xs text-slate-300">
              <Sparkles className="h-3 w-3 text-purple-400 animate-pulse" />
              {sidebarOpen ? (
                <span>
                  Transcriptions ({transcriptionStats.processing + transcriptionStats.pending}
                  {transcriptionStats.failed > 0 && `, ${transcriptionStats.failed} failed`})
                </span>
              ) : (
                <span className="text-[10px] text-purple-400">
                  {transcriptionStats.processing + transcriptionStats.pending}
                </span>
              )}
            </div>
            {sidebarOpen && (transcriptionStats.pending + transcriptionStats.processing > 0) && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 text-slate-400 hover:text-red-400"
                      onClick={cancelAllTranscriptions}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Cancel all transcriptions</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>

          {sidebarOpen && (
            <div className="space-y-1 px-1">
              {Array.from(transcriptionQueue.values())
                .filter((item) => item.status !== 'completed')
                .slice(0, 4)
                .map((item) => (
                  <div key={item.id} className="flex items-center gap-1.5 text-[10px]">
                    {item.status === 'processing' && (
                      <RefreshCw className="h-2.5 w-2.5 text-purple-400 animate-spin shrink-0" />
                    )}
                    {item.status === 'pending' && (
                      <div className="h-2.5 w-2.5 rounded-full bg-yellow-500/60 shrink-0" />
                    )}
                    {item.status === 'failed' && (
                      <AlertCircle className="h-2.5 w-2.5 text-red-400 shrink-0" />
                    )}
                    <span className="text-slate-400 truncate flex-1" title={item.filename}>
                      {item.filename.length > 18 ? `${item.filename.slice(0, 15)}...` : item.filename}
                    </span>
                    {item.status === 'failed' && (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              className="text-slate-500 hover:text-slate-300"
                              onClick={() => useTranscriptionStore.getState().retry(item.id)}
                            >
                              <RotateCcw className="h-2.5 w-2.5" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Retry</p>
                            {item.error && <p className="text-xs text-muted-foreground">{item.error}</p>}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                    {(item.status === 'pending' || item.status === 'processing') && (
                      <button
                        className="text-slate-500 hover:text-red-400"
                        onClick={() => cancelTranscription(item.recordingId)}
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    )}
                  </div>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function formatEta(seconds: number): string {
  if (seconds <= 0) return ''
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) {
    const mins = Math.floor(seconds / 60)
    return `${mins}m`
  }
  const hours = Math.floor(seconds / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
}
```

**Step 2: Commit**

```
feat: create OperationsPanel sidebar component with download + transcription progress
```

---

## Task 6: Integrate OperationsPanel + QA toggle into Layout

**Files:**
- Modify: `src/components/layout/Layout.tsx`

**Step 1: Replace existing download queue indicator with OperationsPanel**

Add import at top:
```typescript
import { OperationsPanel } from '@/components/layout/OperationsPanel'
import { useUIStore } from '@/store/ui/useUIStore'
import { Switch } from '@/components/ui/switch'
```

Remove the entire `{/* Download Queue Indicator */}` block (lines 325-381) and the `{/* Sync Status Indicator */}` block (lines 383-409).

Replace with:
```tsx
        {/* Operations Panel - Downloads + Transcriptions */}
        <OperationsPanel sidebarOpen={sidebarOpen} />
```

**Step 2: Add QA toggle to dev tools section**

Replace the dev tools section (lines 411-429) with:

```tsx
        {/* Dev Tools */}
        {isDevMode && (
          <div className="border-t border-slate-700 p-3 space-y-2">
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                'w-full gap-2 bg-slate-800 text-slate-200 hover:bg-slate-700 hover:text-white',
                !sidebarOpen && 'px-0 justify-center'
              )}
              onClick={() => window.electronAPI?.app?.restart()}
              title="Restart App"
            >
              <RotateCcw className="h-4 w-4" />
              {sidebarOpen && <span>Restart</span>}
            </Button>
            {sidebarOpen && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">QA Logs</span>
                <Switch
                  checked={useUIStore.getState().qaLogsEnabled}
                  onCheckedChange={(checked) => useUIStore.getState().setQaLogsEnabled(checked)}
                  className="scale-75"
                />
              </div>
            )}
          </div>
        )}
```

Remove the unused imports: `Download`, `RefreshCw`, `formatEta` from Layout (now in OperationsPanel). Remove `deviceSyncing`, `deviceFileDownloading`, `deviceFileProgress`, `deviceSyncEta`, `downloadQueue`, `deviceSyncProgress` from the `useAppStore` destructure (OperationsPanel reads these directly).

**Step 3: Commit**

```
feat: integrate OperationsPanel and QA toggle into sidebar
```

---

## Task 7: Replace raw IPC calls with useOperations() in Library.tsx

**Files:**
- Modify: `src/pages/Library.tsx`

**Step 1: Add import and instantiate hook**

Add near top imports:
```typescript
import { useOperations } from '@/hooks/useOperations'
```

Inside the component, add:
```typescript
const { queueTranscription, queueBulkTranscriptions, queueDownload, queueBulkDownloads } = useOperations()
```

**Step 2: Replace `handleBulkProcess` (line 381-406)**

Replace the body with:
```typescript
  const handleBulkProcess = async () => {
    const needsProcessing = filteredRecordings.filter(
      (r) => hasLocalPath(r) && (r.transcriptionStatus === 'none' || r.transcriptionStatus === 'error')
    )
    if (needsProcessing.length === 0) return

    setBulkProcessing(true)
    await queueBulkTranscriptions(needsProcessing)
    await refresh(false)
    setBulkProcessing(false)
    setBulkProgress({ current: 0, total: 0 })
  }
```

**Step 3: Replace `handleSelectedDownload` (line 409-426)**

```typescript
  const handleSelectedDownload = useCallback(async () => {
    const selectedRecordings = filteredRecordings.filter((r) => selectedIds.has(r.id) && isDeviceOnly(r))
    if (selectedRecordings.length === 0 || !deviceConnected) return
    await queueBulkDownloads(selectedRecordings)
    clearSelection()
  }, [filteredRecordings, selectedIds, deviceConnected, clearSelection, queueBulkDownloads])
```

**Step 4: Replace `handleSelectedProcess` (line 428-452)**

```typescript
  const handleSelectedProcess = useCallback(async () => {
    const selectedRecordings = filteredRecordings.filter(
      (r) => selectedIds.has(r.id) && hasLocalPath(r) && (r.transcriptionStatus === 'none' || r.transcriptionStatus === 'error')
    )
    if (selectedRecordings.length === 0) return
    setBulkProcessing(true)
    await queueBulkTranscriptions(selectedRecordings)
    await refresh(false)
    clearSelection()
    setBulkProcessing(false)
    setBulkProgress({ current: 0, total: 0 })
  }, [filteredRecordings, selectedIds, clearSelection, queueBulkTranscriptions, refresh])
```

**Step 5: Replace `handleDownloadCallback` (line ~322)**

Find `handleDownloadCallback` and replace the IPC call body with:
```typescript
    await queueDownload(recording)
```

**Step 6: Replace individual transcription triggers**

Replace line 887 (`onTranscribe` in SourceRow):
```typescript
onTranscribe={() => queueTranscription(recording)}
```

Replace line 986 (middle panel transcribe button):
```typescript
queueTranscription(selectedRecording)
```

Replace line 1071 (SourceDetailDrawer transcribe):
```typescript
queueTranscription(selectedSourceForDrawer)
```

**Step 7: Commit**

```
refactor: replace all raw IPC calls with useOperations() in Library.tsx
```

---

## Task 8: Replace raw IPC in Calendar.tsx

**Files:**
- Modify: `src/pages/Calendar.tsx:498-522`

**Step 1: Add import and hook**

```typescript
import { useOperations } from '@/hooks/useOperations'
```

Inside component:
```typescript
const { queueTranscription } = useOperations()
```

**Step 2: Replace `handleTranscribe` (line 499-522)**

```typescript
  const handleTranscribe = useCallback(async (recording: UnifiedRecording) => {
    await queueTranscription(recording)
    await refreshRecordings(false)
  }, [queueTranscription, refreshRecordings])
```

Remove the `setTranscribing` state and related code that was managing loading state manually.

**Step 3: Commit**

```
refactor: replace raw IPC with useOperations() in Calendar.tsx
```

---

## Task 9: Verification

**Step 1: TypeScript check**

```bash
cd apps/electron && npx tsc --noEmit -p tsconfig.web.json
```

Expected: no new errors (pre-existing `electronAPI` type warnings are expected).

**Step 2: Run tests**

```bash
cd apps/electron && npx vitest run
```

Expected: same pass/fail counts as baseline. Updated SourceRowExpanded test should pass.

**Step 3: Manual verification checklist**

- [ ] Start app with `npm run dev`
- [ ] Sidebar shows NO operations panel when idle
- [ ] Connect device → trigger download → sidebar shows download progress with cancel button
- [ ] Click cancel → downloads stop → toast confirms
- [ ] Select recordings → hit Transcribe → sidebar shows transcription queue
- [ ] Transcription completes → item disappears from panel → toast confirms
- [ ] QA Logs toggle visible in sidebar dev tools
- [ ] Toggle ON → console shows `[QA-MONITOR]` logs on clicks/navigation
- [ ] Toggle OFF → no `[QA-MONITOR]` logs
- [ ] Build production → QA monitor functions skip entirely

**Step 4: Commit final**

```
docs: add unified operations panel plan
```
