import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Terminal,
  FolderOpen,
  Loader2,
  Play,
  Package,
  Copy,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from '@/components/ui/toaster'
import { useAppStore } from '@/store'
import type { BrainListItem, HandoverCreateBundleResult } from '../../../electron/preload/index'

export interface HandoverOutput {
  content: string
  templateId: string
  savedPath?: string
  actionableId?: string
  sourceId?: string
}

interface HandoverDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  output: HandoverOutput | null
}

/** A brain is usable for a handover run only if it is agentic, enabled, AND signed in. */
function isUsable(b: BrainListItem): boolean {
  return b.capabilities.includes('agentic') && b.enabled && b.auth.configured
}

/** Short reason a brain can't be picked (for the greyed-out row tooltip). */
function unusableReason(b: BrainListItem): string {
  if (!b.enabled) return 'Disabled — enable it in Settings → AI Brains'
  if (!b.auth.configured) return b.auth.detail || 'Not authenticated'
  return ''
}

/**
 * The "proper" Claude Code handover dialog (H9). Turns a generated handoff prompt
 * into a real, reusable BUNDLE written into a target repo — and can run it in-app
 * through an agentic brain (Claude Code / Codex / Gemini CLI) resolved via the
 * BrainRouter. Clipboard-copy and open-in-terminal remain as explicit fallbacks.
 */
export function HandoverDialog({ open, onOpenChange, output }: HandoverDialogProps) {
  const [brains, setBrains] = useState<BrainListItem[]>([])
  const [brainId, setBrainId] = useState<string>('')
  const [targetDir, setTargetDir] = useState<string>('')
  const [busy, setBusy] = useState<null | 'bundle' | 'run' | 'terminal' | 'copy'>(null)
  const [runLog, setRunLog] = useState<string>('')
  const [runOk, setRunOk] = useState<boolean | null>(null)

  // Only agentic brains are relevant to a handover; keep them all (usable + greyed).
  const agenticBrains = useMemo(() => brains.filter((b) => b.capabilities.includes('agentic')), [brains])
  const usableBrains = useMemo(() => agenticBrains.filter(isUsable), [agenticBrains])
  const canRun = usableBrains.length > 0 && !!brainId

  // Load the brain list whenever the dialog opens; pick a sensible default brain.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    ;(async () => {
      try {
        const list = (await window.electronAPI?.brains?.list()) ?? []
        if (cancelled) return
        setBrains(list)
        const usable = list.filter(isUsable)
        // Prefer the routing/global default when it's usable, else the first usable.
        const preferred = usable.find((b) => b.isDefault) ?? usable[0]
        setBrainId((prev) => (prev && usable.some((b) => b.id === prev) ? prev : preferred?.id ?? ''))
      } catch {
        if (!cancelled) setBrains([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open])

  // Reset transient run state each time the dialog opens.
  useEffect(() => {
    if (open) {
      setRunLog('')
      setRunOk(null)
    }
  }, [open])

  const logActivity = useCallback((type: 'success' | 'error' | 'info', message: string, details?: string) => {
    try {
      useAppStore.getState().addActivityLogEntry({ timestamp: new Date(), type, message, details })
    } catch {
      /* activity log is best-effort */
    }
  }, [])

  const browseFolder = useCallback(async () => {
    const pick = await window.electronAPI.storage.selectFolder?.(targetDir || undefined)
    if (pick?.success && pick.data) setTargetDir(pick.data)
  }, [targetDir])

  /**
   * Create the bundle. Resolves the target directory (explicit → source project →
   * configured default); if none is known the user is prompted to pick one and the
   * write is retried. Returns the created bundle or null on cancel/failure.
   */
  const createBundle = useCallback(async (): Promise<HandoverCreateBundleResult | null> => {
    if (!output?.content) return null
    const brain = agenticBrains.find((b) => b.id === brainId)
    const attempt = (dir?: string) =>
      window.electronAPI.handover.createBundle({
        content: output.content,
        actionableId: output.actionableId,
        knowledgeCaptureId: output.sourceId,
        targetDir: dir,
        brain: brain ? { id: brain.id, label: brain.label } : null,
      })

    let res = await attempt(targetDir || undefined)
    if (res.success && res.data?.needsFolder) {
      const pick = await window.electronAPI.storage.selectFolder?.()
      if (!pick?.success || !pick.data) {
        toast.info('Cancelled', 'Pick a folder to write the handover bundle into.')
        return null
      }
      setTargetDir(pick.data)
      res = await attempt(pick.data)
    }

    if (!res.success) {
      toast.error('Could not write bundle', res.error?.message || 'Unknown error')
      return null
    }
    if (!res.data?.created || !res.data.bundleDir) {
      return null
    }
    if (res.data.targetDir) setTargetDir(res.data.targetDir)
    return res.data
  }, [output, agenticBrains, brainId, targetDir])

  const onWriteBundle = useCallback(async () => {
    setBusy('bundle')
    try {
      const bundle = await createBundle()
      if (bundle?.bundleDir) {
        logActivity('success', 'Handover bundle written', bundle.bundleDir)
        toast.success('Bundle written', bundle.bundleDir, {
          action: {
            label: 'Show',
            onClick: () => window.electronAPI.outputs.openInFolder(bundle.handoverPath || bundle.bundleDir!),
          },
        })
      }
    } finally {
      setBusy(null)
    }
  }, [createBundle, logActivity])

  const onWriteAndRun = useCallback(async () => {
    setBusy('run')
    setRunLog('')
    setRunOk(null)
    try {
      const bundle = await createBundle()
      // Only the opaque bundleId is passed back — the main process refuses paths.
      if (!bundle?.bundleId) return
      logActivity('info', 'Handover agent started', `${brainId} · ${bundle.bundleDir ?? bundle.bundleId}`)
      setRunLog('Running the agent… this can take a while.')
      const res = await window.electronAPI.handover.runAgent({
        bundleId: bundle.bundleId,
        brainId: brainId || undefined,
      })
      if (!res.success) {
        setRunOk(false)
        setRunLog(res.error?.message || 'The run failed.')
        logActivity('error', 'Handover agent failed', res.error?.message)
        toast.error('Handover run failed', res.error?.message || 'Unknown error')
        return
      }
      const data = res.data
      setRunOk(data.ok)
      setRunLog(data.ok ? data.finalResponse || 'Completed with no textual output.' : data.error || 'The agent returned no output.')
      if (data.ok) {
        logActivity('success', `Handover completed via ${data.brainLabel ?? brainId}`, data.runLogPath)
        toast.success('Handover complete', data.brainLabel ? `Ran via ${data.brainLabel}` : undefined)
      } else {
        logActivity('error', 'Handover agent returned no output', data.error)
        toast.error('Handover run failed', data.error || 'The agent returned no output.')
      }
    } finally {
      setBusy(null)
    }
  }, [createBundle, brainId, logActivity])

  const onCopy = useCallback(async () => {
    if (!output?.content) return
    setBusy('copy')
    try {
      const res = await window.electronAPI.outputs.copyToClipboard(output.content)
      if (res.success) toast.success('Copied', 'Handoff prompt copied to clipboard')
      else toast.error('Copy failed', res.error?.message)
    } finally {
      setBusy(null)
    }
  }, [output])

  // Fallback: open an external terminal at the bundle (writes it first if needed).
  const onOpenTerminal = useCallback(async () => {
    if (!output?.content) return
    setBusy('terminal')
    try {
      const bundle = await createBundle()
      const res = await window.electronAPI.outputs.launchClaudeCode({
        filePath: bundle?.handoverPath ?? output.savedPath,
        content: output.content,
        templateId: output.templateId,
        actionableId: output.actionableId,
        cwd: bundle?.targetDir ?? targetDir ?? undefined,
      })
      if (res.success && res.data?.launched) {
        toast.success('Opening terminal', res.data.cwd ? `Launched in ${res.data.cwd}` : 'Terminal opened.')
      } else if (res.success && res.data?.needsFolder) {
        toast.info('Pick a folder', 'Choose a working directory above, then retry.')
      } else if (!res.success) {
        toast.error('Could not open terminal', res.error?.message || 'Unknown error')
      }
    } finally {
      setBusy(null)
    }
  }, [output, createBundle, targetDir])

  const anyBusy = busy !== null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Hand off to a coding agent</DialogTitle>
          <DialogDescription>
            Write a handover bundle into a repo and optionally run it in-app through an agentic AI brain.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Target directory */}
          <div className="space-y-1.5">
            <Label htmlFor="handover-target">Target directory</Label>
            <div className="flex gap-2">
              <Input
                id="handover-target"
                value={targetDir}
                onChange={(e) => setTargetDir(e.target.value)}
                placeholder="Auto-resolved from the source project or your default handoff folder"
                spellCheck={false}
              />
              <Button type="button" variant="outline" onClick={browseFolder} disabled={anyBusy} className="flex-shrink-0">
                <FolderOpen className="h-4 w-4" />
                <span className="ml-2 hidden sm:inline">Browse</span>
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              The bundle is written to <code>handover/&lt;timestamp-slug&gt;/</code> inside this folder.
            </p>
          </div>

          {/* Brain picker */}
          <div className="space-y-1.5">
            <Label htmlFor="handover-brain">Agent brain</Label>
            <Select value={brainId} onValueChange={setBrainId} disabled={anyBusy || agenticBrains.length === 0}>
              <SelectTrigger id="handover-brain" aria-label="Agent brain">
                <SelectValue placeholder={agenticBrains.length ? 'Select an agent brain' : 'No agentic brains registered'} />
              </SelectTrigger>
              <SelectContent>
                {agenticBrains.map((b) => {
                  const usable = isUsable(b)
                  return (
                    <SelectItem key={b.id} value={b.id} disabled={!usable} title={usable ? undefined : unusableReason(b)}>
                      {b.label}
                      {!usable && <span className="ml-2 text-xs text-muted-foreground">· {unusableReason(b)}</span>}
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
            {usableBrains.length === 0 && (
              <p className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-500">
                <AlertCircle className="h-3.5 w-3.5" />
                No agentic brain is enabled and signed in. You can still write the bundle or copy the prompt.
              </p>
            )}
          </div>

          {/* Run log */}
          {runLog && (
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5">
                {runOk === true && <CheckCircle2 className="h-4 w-4 text-green-500" />}
                {runOk === false && <AlertCircle className="h-4 w-4 text-destructive" />}
                Run log
              </Label>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-xs">
                {runLog}
              </pre>
            </div>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          &ldquo;Write + run agent&rdquo; lets an autonomous AI agent read and modify files in the chosen folder.
        </p>

        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onCopy} disabled={anyBusy}>
              <Copy className="mr-2 h-4 w-4" />
              Copy prompt
            </Button>
            <Button variant="ghost" onClick={onOpenTerminal} disabled={anyBusy}>
              {busy === 'terminal' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Terminal className="mr-2 h-4 w-4" />}
              Open in terminal
            </Button>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onWriteBundle} disabled={anyBusy}>
              {busy === 'bundle' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Package className="mr-2 h-4 w-4" />}
              Write bundle
            </Button>
            <Button onClick={onWriteAndRun} disabled={anyBusy || !canRun} title={canRun ? undefined : 'Enable and sign in to an agentic brain first'}>
              {busy === 'run' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
              Write + run agent
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default HandoverDialog
