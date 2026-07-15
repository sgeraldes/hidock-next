/**
 * DeletePermanentDialog — spec-005/F17 T5 §D6.
 *
 * Dedicated dialog for the hard-purge ("Delete permanently") flow. `ConfirmDialog`
 * has no slot for impact copy + a checkbox, and its shared `confirmDialog` state
 * (Library.tsx) is reused across three other flows (soft delete, device delete,
 * bulk delete) — overloading it further would tangle those. This is its own
 * component instead.
 *
 * T5 owns this component in full: the shell, every string, and the device
 * checkbox control + its local state. T6 (spec-006) owns producing
 * `impact.graphEstimate` / `impact.onDevice` in the deletionImpact payload, and
 * the actual `alsoDeleteFromDevice` purge behavior in Library's
 * `executeDeletePermanent`. The two tasks meet ONLY at this prop interface.
 */

import { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
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
import { Checkbox } from '@/components/ui/checkbox'
import { GRAPH_CLEANUP_RETRY_SAFETY_LINE } from '@/features/library/utils/deletionCopy'

export interface DeletePermanentDialogImpact {
  transcripts: number
  actionItems: number
  embeddings: number
  captures: number
  artifacts: number
  hasAudioFile: boolean
  /**
   * AR2-5: rendered as "~N graph links" when a number. `null` = the graph
   * dry-run explicitly could not determine impact (AR3-8 — renders a dedicated
   * "Graph impact: unknown" warning row, never a silent omission). `undefined`
   * = the field isn't present at all (older main / before T6 lands) — omitted
   * entirely, no count and no warning.
   */
  graphEstimate?: number | null
  /** Informational only — see the gating note on DeletePermanentDialogProps.deviceConnected. */
  onDevice?: boolean
  /**
   * spec-006/F17 T6 F-INFO-6: the device's own filename for this recording,
   * sourced from the DB row (deletionImpact), NOT rendered here — Library.tsx
   * reads it to route the device-delete call for a Trash row, whose
   * UnifiedRecording has no deviceFilename field at all (always flattened to
   * 'local-only'). null when not on device; absent for pre-T6 payloads.
   */
  deviceFilename?: string | null
}

export interface DeletePermanentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  filename: string
  /** Extended impact (T6 fills graphEstimate + onDevice; T5 renders it). All optional-safe. */
  impact?: DeletePermanentDialogImpact
  /**
   * Live renderer signal (recording.location includes device AND the device is
   * currently connected) — the source of truth for whether the checkbox can be
   * checked. `impact.onDevice` (from the possibly-stale persisted `on_device`
   * DB column) only decides whether the checkbox renders at all; it is never
   * used to gate the destructive action itself.
   */
  deviceConnected: boolean
  /** Seam: T5 renders the checkbox + owns its local state; passes the value out here. */
  onConfirm: (opts: { alsoDeleteFromDevice: boolean }) => void
}

function pluralize(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`
}

/** Builds the "As of now, this removes …" clause. Exported for direct unit testing. */
export function buildRemovesText(impact?: DeletePermanentDialogImpact): string {
  const FALLBACK = 'the audio file and any transcript'
  if (!impact) return FALLBACK

  const parts: string[] = []
  if (impact.transcripts) parts.push(pluralize(impact.transcripts, 'transcript'))
  if (impact.actionItems) parts.push(pluralize(impact.actionItems, 'action item'))
  if (impact.embeddings) parts.push(pluralize(impact.embeddings, 'embedding'))
  if (impact.artifacts) parts.push(pluralize(impact.artifacts, 'artifact'))
  if (impact.hasAudioFile) parts.push('the audio file')
  // null/undefined are both non-number here — only a real count folds into the sentence.
  // A `null` (explicitly unknown) instead surfaces via the dedicated warning row below.
  if (typeof impact.graphEstimate === 'number') {
    parts.push(`~${impact.graphEstimate} graph link${impact.graphEstimate === 1 ? '' : 's'}`)
  }

  if (parts.length === 0) return FALLBACK
  if (parts.length === 1) return parts[0]
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`
}

export function DeletePermanentDialog({
  open,
  onOpenChange,
  filename,
  impact,
  deviceConnected,
  onConfirm
}: DeletePermanentDialogProps) {
  const [alsoDeleteFromDevice, setAlsoDeleteFromDevice] = useState(false)

  // Default unchecked every time the dialog (re)opens, including for a different recording.
  useEffect(() => {
    if (open) setAlsoDeleteFromDevice(false)
  }, [open, filename])

  const removesText = buildRemovesText(impact)
  const showDeviceCheckbox = impact?.onDevice === true
  const graphUnknown = impact?.graphEstimate === null

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete permanently</AlertDialogTitle>
          {/* asChild swaps the underlying element for a <div> so block content
              (multiple <p>, the warning row) nests validly — Radix's default
              Description element is a <p>, which can't contain another <p>. */}
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-left">
              <p>Delete &quot;{filename}&quot; permanently?</p>
              {/* AR3-8: every count is labelled point-in-time — never implied as a
                  live/future guarantee. */}
              <p>As of now, this removes {removesText}.</p>
              <p className="font-medium text-destructive">This CANNOT be undone.</p>
              {/* F-INFO-5 / D2 — the fail-closed retry-safety guarantee, shown
                  unconditionally (true regardless of whether the graph
                  estimate above is known or not). */}
              <p className="text-xs text-muted-foreground">{GRAPH_CLEANUP_RETRY_SAFETY_LINE}</p>
              {graphUnknown && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-amber-700 dark:text-amber-400"
                >
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
                  <div>
                    <p className="text-sm font-medium">Graph impact: unknown</p>
                    <p className="text-xs">
                      Graph cleanup may not be ready — deletion will refuse rather than leave
                      residue (you can skip it explicitly if it fails).
                    </p>
                  </div>
                </div>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        {showDeviceCheckbox && (
          <div className="flex items-start gap-2">
            <Checkbox
              id="delete-permanent-also-device"
              checked={alsoDeleteFromDevice}
              onCheckedChange={setAlsoDeleteFromDevice}
              disabled={!deviceConnected}
              className="mt-0.5"
            />
            <div className="flex flex-col">
              <label htmlFor="delete-permanent-also-device" className="text-sm font-medium cursor-pointer">
                Also delete from device
              </label>
              {!deviceConnected && (
                <span className="text-xs text-muted-foreground">
                  Connect the device to remove its copy too.
                </span>
              )}
            </div>
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => onConfirm({ alsoDeleteFromDevice })}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Delete permanently
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
