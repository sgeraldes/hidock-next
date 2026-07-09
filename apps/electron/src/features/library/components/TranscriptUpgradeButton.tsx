/**
 * TranscriptUpgradeButton
 *
 * Library toolbar maintenance action for old (pre-speaker-turns) transcripts.
 * Opens a dialog that scans the corpus and reports how many flat transcripts
 * would be text-reformatted (cheap, automatic) vs. flagged for a costly audio
 * re-transcription (the user's call). From here the user can kick the
 * lowest-priority reformat pass, or select the flagged recordings so the
 * existing bulk "Process All" action can re-transcribe them.
 *
 * Self-contained: manages its own state and IPC calls. The transcriptUpgrade
 * IPC namespace is accessed defensively so the button degrades gracefully until
 * the preload bridge exposes it (see preload wiring note in the PR).
 */

import { useCallback, useState } from 'react'
import { Sparkles, RefreshCw, Wand2, ListChecks } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '@/components/ui/dialog'
import { toast } from '@/components/ui/toaster'
import { useLibraryStore } from '@/store/useLibraryStore'

interface UpgradeScan {
  totalTranscripts: number
  legacyTotal: number
  toReformat: number
  recommendedRetranscription: number
  alreadyReformatted: number
  threshold: number
}

type IpcResult<T> = { success: true; data: T } | { success: false; error?: { message?: string } }

interface TranscriptUpgradeAPI {
  scan: (req?: { threshold?: number }) => Promise<IpcResult<UpgradeScan>>
  run: (req?: { threshold?: number }) => Promise<IpcResult<UpgradeScan>>
  getRecommended: () => Promise<IpcResult<string[]>>
}

/** Defensive accessor: null until the preload bridge exposes the namespace. */
function getUpgradeApi(): TranscriptUpgradeAPI | null {
  const api = (window as unknown as { electronAPI?: { transcriptUpgrade?: TranscriptUpgradeAPI } }).electronAPI
  return api?.transcriptUpgrade ?? null
}

export function TranscriptUpgradeButton() {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [running, setRunning] = useState(false)
  const [scan, setScan] = useState<UpgradeScan | null>(null)
  const [unavailable, setUnavailable] = useState(false)

  const refreshScan = useCallback(async () => {
    const api = getUpgradeApi()
    if (!api) {
      setUnavailable(true)
      return
    }
    setLoading(true)
    try {
      const res = await api.scan()
      if (res.success) {
        setScan(res.data)
        setUnavailable(false)
      } else {
        toast.error('Scan failed', res.error?.message)
      }
    } catch (e) {
      toast.error('Scan failed', e instanceof Error ? e.message : undefined)
    } finally {
      setLoading(false)
    }
  }, [])

  const onOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next)
      if (next) void refreshScan()
    },
    [refreshScan]
  )

  const onReformat = useCallback(async () => {
    const api = getUpgradeApi()
    if (!api) return
    setRunning(true)
    try {
      const res = await api.run()
      if (res.success) {
        setScan(res.data)
        toast.success(
          'Upgrade started',
          `${res.data.toReformat} transcript${res.data.toReformat === 1 ? '' : 's'} queued for reformatting (runs only while the device is not transcribing).`
        )
      } else {
        toast.error('Upgrade failed', res.error?.message)
      }
    } catch (e) {
      toast.error('Upgrade failed', e instanceof Error ? e.message : undefined)
    } finally {
      setRunning(false)
    }
  }, [])

  const onSelectFlagged = useCallback(async () => {
    const api = getUpgradeApi()
    if (!api) return
    try {
      const res = await api.getRecommended()
      if (!res.success) {
        toast.error('Could not load flagged recordings', res.error?.message)
        return
      }
      const ids = res.data
      if (ids.length === 0) {
        toast.info('Nothing to select', 'No transcripts are flagged for re-transcription yet. Run the upgrade first.')
        return
      }
      useLibraryStore.getState().selectAll(ids)
      setOpen(false)
      toast.success(
        'Selected flagged recordings',
        `${ids.length} selected. Use "Process All" to re-transcribe them from audio.`
      )
    } catch (e) {
      toast.error('Could not load flagged recordings', e instanceof Error ? e.message : undefined)
    }
  }, [])

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => onOpenChange(true)}
        title="Triage and reformat old (pre-speaker-turns) transcripts"
      >
        <Sparkles className="h-4 w-4 mr-2" />
        Upgrade Transcripts
      </Button>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upgrade old transcripts</DialogTitle>
            <DialogDescription>
              Old transcripts stored as flat text can be restructured into readable speaker turns cheaply, without
              re-transcribing the audio. The most important ones are flagged for a full audio re-transcription instead
              — that stays your call.
            </DialogDescription>
          </DialogHeader>

          {unavailable ? (
            <p className="text-sm text-muted-foreground py-2">
              This maintenance action is not available in the current build. Restart the app after updating to enable it.
            </p>
          ) : loading && !scan ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
              <RefreshCw className="h-4 w-4 animate-spin" />
              Scanning transcripts...
            </div>
          ) : scan ? (
            <div className="grid grid-cols-2 gap-3 py-2">
              <Stat label="Flat transcripts" value={scan.legacyTotal} />
              <Stat label="Already reformatted" value={scan.alreadyReformatted} />
              <Stat label="To reformat (cheap)" value={scan.toReformat} accent="primary" />
              <Stat label="Flagged for re-transcription" value={scan.recommendedRetranscription} accent="orange" />
            </div>
          ) : null}

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onSelectFlagged}
              disabled={unavailable || !scan || scan.recommendedRetranscription === 0}
              title="Select the flagged recordings so you can re-transcribe them with Process All"
            >
              <ListChecks className="h-4 w-4 mr-2" />
              Select flagged
            </Button>
            <Button
              size="sm"
              onClick={onReformat}
              disabled={unavailable || running || !scan || scan.toReformat === 0}
            >
              {running ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Starting...
                </>
              ) : (
                <>
                  <Wand2 className="h-4 w-4 mr-2" />
                  Reformat {scan?.toReformat ?? 0} now
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: 'primary' | 'orange' }) {
  const color =
    accent === 'primary'
      ? 'text-primary'
      : accent === 'orange'
        ? 'text-orange-600 dark:text-orange-400'
        : 'text-foreground'
  return (
    <div className="rounded-md border p-3">
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  )
}
