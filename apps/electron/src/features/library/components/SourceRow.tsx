import { memo } from 'react'
import { AlertCircle, Download, Trash2, Wand2, Sparkles, FileText, RefreshCw, AudioLines, MoreHorizontal, Calendar, EyeOff, Eye, TrendingDown, Ban, RotateCcw, ArchiveRestore } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { formatDateTime } from '@/lib/utils'
import { Meeting, Transcript } from '@/types'
import type { QualityRating } from '@/types/knowledge'
import { UnifiedRecording, hasLocalPath, isRecordingBacked } from '@/types/unified-recording'
import { StatusIcon } from './StatusIcon'
import { TranscriptionStatusBadge } from './TranscriptionStatusBadge'
import { useLibraryStore } from '@/store/useLibraryStore'
import { getDisplayTitle } from '@/features/library/utils/getDisplayTitle'
import { highlightText } from '@/features/library/utils/highlightText'
import { getRowMeta } from '@/features/library/utils/rowMeta'
import { sourceTypeLabel } from '@/features/library/utils/sourceType'
import { formatValueReasons } from '@/features/library/utils/valueReasons'
import {
  LABEL_DELETE_FROM_DEVICE,
  LABEL_MOVE_TO_TRASH,
  LABEL_DELETE_PERMANENTLY,
  LABEL_RESTORE,
  SCOPE_DEVICE_DELETE,
  SCOPE_DEVICE_DELETE_SYNCED,
  SCOPE_DEVICE_NOT_CONNECTED,
  SCOPE_TRASH,
  SCOPE_PERMANENT,
  SCOPE_RESTORE,
  ariaLabelWithScope
} from '@/features/library/utils/deletionCopy'

/**
 * F16/spec-003 — icon-only value badge, rendered only for low-value/garbage
 * (never valuable/archived/unrated). Lives in the row's `shrink-0` right
 * cluster so the H17 no-scroll invariant holds: no text label, so the
 * `flex-1 min-w-0` title always truncates before this cluster can grow.
 *
 * Relies on the single `<TooltipProvider>` SourceRow mounts around its whole
 * return value (/simplify S-6 — one provider per row, not one per tooltip
 * consumer) rather than mounting its own.
 */
function ValueBadge({ recording }: { recording: UnifiedRecording }) {
  if (recording.quality !== 'low-value' && recording.quality !== 'garbage') return null

  const isGarbage = recording.quality === 'garbage'
  const Icon = isGarbage ? Ban : TrendingDown
  const label = isGarbage ? 'Garbage' : 'Low value'
  const reasonsText = formatValueReasons(recording.qualityReasons)
  const secondLine = reasonsText || (recording.qualitySource === 'user' ? 'Set by you' : 'AI-assessed')

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={`inline-flex shrink-0 ${isGarbage ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'}`}
          role="img"
          aria-label={label}
        >
          <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <p>{label}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{secondLine}</p>
      </TooltipContent>
    </Tooltip>
  )
}

interface SourceRowProps {
  recording: UnifiedRecording
  meeting?: Meeting
  transcript?: Transcript
  isSelected?: boolean
  isActiveSource?: boolean
  /** Bulk-selection checkbox was removed from the row (owner request). Retained so
      existing callers keep type-checking; no longer drives any UI. */
  anySelected?: boolean
  searchQuery?: string
  /** Row-level checkbox selection was removed; kept for caller compatibility. */
  onSelectionChange?: (id: string, shiftKey: boolean) => void
  onClick?: () => void
  // Action handlers
  onDownload?: () => void
  onDelete?: () => void
  onDeletePermanent?: () => void
  /** Trash-mode only (spec-005/F17 §D1) — Library passes this ONLY for trashed rows. */
  onRestore?: () => void
  /** Synced ("both") rows only (spec-005/F17 §D3) — erases the device copy via the
   *  existing renderer device path, keeps the local copy. */
  onDeleteFromDevice?: () => void
  onMarkPersonal?: () => void
  /** F16/spec-003 — manual per-row value-rating override (overflow menu). */
  onSetValueRating?: (rating: QualityRating) => void
  onTranscribe?: () => void
  onReprocessVibeVoice?: () => void
  onAskAssistant?: () => void
  onGenerateOutput?: () => void
  // Download state for device-only recordings
  isDownloading?: boolean
  downloadProgress?: number
  deviceConnected?: boolean
}

export const SourceRow = memo(function SourceRow({
  recording,
  meeting,
  transcript,
  isSelected = false,
  isActiveSource = false,
  searchQuery = '',
  onClick,
  onDownload,
  onDelete,
  onDeletePermanent,
  onRestore,
  onDeleteFromDevice,
  onMarkPersonal,
  onSetValueRating,
  onTranscribe,
  onReprocessVibeVoice,
  onAskAssistant,
  onGenerateOutput,
  isDownloading = false,
  downloadProgress,
  deviceConnected = false
}: SourceRowProps) {
  const error = useLibraryStore((state) => state.recordingErrors.get(recording.id))

  // Smart title
  const { primaryText, source: titleSource } = getDisplayTitle(recording, meeting, transcript)
  // The machine filename is noise in the prime space — it lives in the row's
  // hover tooltip and the expanded row, never on the always-visible second line.
  const titleIsFilename = titleSource === 'filename'

  const handleRowClick = (e: React.MouseEvent) => {
    // Don't trigger onClick when the click lands on an action button.
    const target = e.target as HTMLElement
    if (target.closest('button')) {
      return
    }
    onClick?.()
  }

  // Build the secondary line from the type-aware row metadata. Audio keeps
  // "date \u00B7 time \u00B7 duration"; non-audio artifacts (image/pdf/note) show their
  // kind + date and never a bogus duration. The leading glyph (TypeIcon) makes
  // the list scannable by kind.
  const { Icon: TypeIcon, parts: secondaryParts, type: sourceType } = getRowMeta(recording)
  const secondaryText = secondaryParts.join(' \u00B7 ')
  // Tooltip on the second line surfaces the raw filename when it isn't already
  // the title, so the machine name stays discoverable without cluttering the row.
  const secondaryTitle = titleIsFilename ? undefined : recording.filename

  return (
    <TooltipProvider>
      <div
        className={[
          '@container flex items-start justify-between gap-2 py-2.5 px-3 cursor-pointer',
          'transition-[background-color,box-shadow] duration-150',
          // Hover reads as a gentle elevation (bg + inner ring — the row list is
          // overflow-clipped, so an inset ring conveys lift where a drop shadow can't).
          'hover:bg-muted/60 hover:ring-1 hover:ring-inset hover:ring-border',
          // Selection/active state shown via background tint + inset accent ring
          // (no side-stripe border, per the design rules).
          isActiveSource
            ? 'bg-primary/15 ring-1 ring-inset ring-primary/30'
            : isSelected
              ? 'bg-primary/10 ring-1 ring-inset ring-primary/20'
              : ''
        ].filter(Boolean).join(' ')}
        role="option"
        onClick={handleRowClick}
        aria-selected={isSelected}
        tabIndex={0}
      >
        <div className="flex items-start gap-2 min-w-0 flex-1">
          {/* Content area — flex-1 to fill remaining space. Status icons moved to the
              right cluster so the title starts flush-left with no wasted gutter. */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start gap-1.5 min-w-0">
              <p className="font-medium text-sm line-clamp-2 text-foreground leading-tight min-w-0" title={primaryText}>
                {searchQuery ? highlightText(primaryText, searchQuery) : primaryText}
              </p>
              {/* Personal ("ignored") badge — this recording is kept but pulled out of
                  all AI processing and default surfaces (v38). */}
              {recording.personal && (
                <span
                  className="mt-[2px] inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                  role="img"
                  aria-label="Personal — excluded from AI processing"
                  title="Personal — kept on disk but excluded from AI processing and default surfaces"
                >
                  <EyeOff className="h-2.5 w-2.5" aria-hidden="true" />
                  Personal
                </span>
              )}
            </div>
            <p className="flex items-center gap-1 text-xs text-muted-foreground truncate leading-tight mt-0.5">
              <TypeIcon
                className="h-3 w-3 shrink-0 text-muted-foreground/70"
                aria-label={`${sourceTypeLabel(sourceType)} source`}
              />
              <span className="truncate" title={secondaryTitle}>
                {searchQuery ? highlightText(secondaryText, searchQuery) : secondaryText}
              </span>
            </p>
          </div>
        </div>

        {/* Right cluster — status + meeting link + error + overflow menu, aligned at
            the row's top line. The two status icons live here (not a left column) so
            the title starts flush-left. Playback lives in the mid-panel player. */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Value badge (F16/spec-003) — icon-only, low-value/garbage only. Sits
              before the meeting chip so the two provenance/quality glyphs read
              left-to-right in the same tight cluster. */}
          <ValueBadge recording={recording} />
          {/* Meeting-link (calendar) provenance — the system knows this row maps to a
              calendar event; the status icons align with it. */}
          {meeting && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className="inline-flex shrink-0 text-primary/70"
                  role="img"
                  aria-label={`Linked to calendar meeting: ${meeting.subject}`}
                >
                  <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <p>Linked to calendar meeting</p>
                <p className="text-xs text-muted-foreground mt-0.5">{formatDateTime(meeting.start_time)}</p>
              </TooltipContent>
            </Tooltip>
          )}
          <StatusIcon recording={recording} />
          <TranscriptionStatusBadge status={recording.transcriptionStatus} compact />
          {/* Error indicator */}
          {error && (
            <Tooltip>
              <TooltipTrigger asChild>
                <AlertCircle className="h-3.5 w-3.5 text-destructive shrink-0" aria-label="Processing error" />
              </TooltipTrigger>
              <TooltipContent>
                <p>{error.message}</p>
                {error.details && <p className="text-xs text-muted-foreground mt-1">{error.details}</p>}
              </TooltipContent>
            </Tooltip>
          )}

          {/* Download progress (device-only, in flight) */}
          {recording.location === 'device-only' && isDownloading && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground px-2" aria-live="polite">
              <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              <span>{downloadProgress ?? 0}%</span>
            </div>
          )}

          {/* Secondary actions: overflow menu (labeled, keeps the row uncluttered) */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={(e) => e.stopPropagation()}
                aria-label="More actions"
              >
                <MoreHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {onAskAssistant && (
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onAskAssistant(); }}>
                  <Sparkles className="h-4 w-4" aria-hidden="true" />
                  Ask Assistant
                </DropdownMenuItem>
              )}
              {onGenerateOutput && (
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onGenerateOutput(); }}>
                  <FileText className="h-4 w-4" aria-hidden="true" />
                  Generate output
                </DropdownMenuItem>
              )}
              {hasLocalPath(recording) && recording.transcriptionStatus !== 'complete' && onTranscribe && (
                <DropdownMenuItem
                  onClick={(e) => { e.stopPropagation(); onTranscribe(); }}
                  disabled={recording.transcriptionStatus === 'pending' || recording.transcriptionStatus === 'processing'}
                >
                  {recording.transcriptionStatus === 'processing'
                    ? <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
                    : <Wand2 className="h-4 w-4" aria-hidden="true" />}
                  {recording.transcriptionStatus === 'pending' ? 'Transcription queued'
                    : recording.transcriptionStatus === 'processing' ? 'Transcribing…'
                      : 'Transcribe'}
                </DropdownMenuItem>
              )}
              {hasLocalPath(recording) && onReprocessVibeVoice && (
                <DropdownMenuItem
                  onClick={(e) => { e.stopPropagation(); onReprocessVibeVoice(); }}
                  disabled={recording.transcriptionStatus === 'pending' || recording.transcriptionStatus === 'processing'}
                >
                  <AudioLines className="h-4 w-4" aria-hidden="true" />
                  Re-transcribe (VibeVoice)
                </DropdownMenuItem>
              )}
              {recording.location === 'device-only' && onDownload && !isDownloading && (
                <DropdownMenuItem
                  onClick={(e) => { e.stopPropagation(); onDownload(); }}
                  disabled={!deviceConnected}
                >
                  <Download className="h-4 w-4" aria-hidden="true" />
                  {deviceConnected ? 'Download to computer' : 'Device not connected'}
                </DropdownMenuItem>
              )}
              {onMarkPersonal && recording.location !== 'device-only' && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={(e) => { e.stopPropagation(); onMarkPersonal(); }}
                  >
                    {recording.personal
                      ? <><Eye className="h-4 w-4" aria-hidden="true" />Unmark personal</>
                      : <><EyeOff className="h-4 w-4" aria-hidden="true" />Mark personal (ignore)</>}
                  </DropdownMenuItem>
                </>
              )}
              {/* Manual value-rating override (F16/spec-003) — capture-backed,
                  non-device rows only. Explicit user action always applies (the
                  never-downgrade guard only protects against a lower-confidence
                  AI re-classification, never against the user's own rating). */}
              {onSetValueRating && recording.location !== 'device-only' && recording.knowledgeCaptureId && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={(e) => { e.stopPropagation(); onSetValueRating('low-value'); }}
                  >
                    <TrendingDown className="h-4 w-4" aria-hidden="true" />
                    Mark low-value
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={(e) => { e.stopPropagation(); onSetValueRating('garbage'); }}
                  >
                    <Ban className="h-4 w-4" aria-hidden="true" />
                    Mark garbage
                  </DropdownMenuItem>
                  {recording.quality && recording.quality !== 'unrated' && (
                    <DropdownMenuItem
                      onClick={(e) => { e.stopPropagation(); onSetValueRating('unrated'); }}
                    >
                      <RotateCcw className="h-4 w-4" aria-hidden="true" />
                      Clear rating
                    </DropdownMenuItem>
                  )}
                </>
              )}
              {/* spec-005/F17 T5 §D1/§D2/§D3/AR3-4 — every item below is individually
                  onX &&-guarded, which is what lets Library reuse this SAME menu for
                  Trash rows (only onRestore + onDeletePermanent passed) and for
                  synced rows (onDelete + onDeleteFromDevice + onDeletePermanent).
                  AR3-4 (binding): capture-only synthetic rows (no source recording)
                  render NONE of these — gated on isRecordingBacked. */}
              {isRecordingBacked(recording) && (onDelete || onRestore || onDeletePermanent || onDeleteFromDevice) && (
                <>
                  <DropdownMenuSeparator />
                  {onRestore && (
                    <DropdownMenuItem
                      onClick={(e) => { e.stopPropagation(); onRestore(); }}
                      className="items-start gap-2"
                      aria-label={ariaLabelWithScope(LABEL_RESTORE, SCOPE_RESTORE)}
                    >
                      <ArchiveRestore className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
                      <span className="flex flex-col">
                        <span>{LABEL_RESTORE}</span>
                        <span className="text-xs text-muted-foreground">{SCOPE_RESTORE}</span>
                      </span>
                    </DropdownMenuItem>
                  )}
                  {onDelete && recording.location === 'device-only' && (
                    <DropdownMenuItem
                      onClick={(e) => { e.stopPropagation(); onDelete(); }}
                      disabled={!deviceConnected}
                      className="items-start gap-2 text-destructive focus:text-destructive"
                      aria-label={ariaLabelWithScope(LABEL_DELETE_FROM_DEVICE, deviceConnected ? SCOPE_DEVICE_DELETE : SCOPE_DEVICE_NOT_CONNECTED)}
                    >
                      <Trash2 className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
                      <span className="flex flex-col">
                        <span>{LABEL_DELETE_FROM_DEVICE}</span>
                        <span className="text-xs text-muted-foreground">
                          {deviceConnected ? SCOPE_DEVICE_DELETE : SCOPE_DEVICE_NOT_CONNECTED}
                        </span>
                      </span>
                    </DropdownMenuItem>
                  )}
                  {onDelete && recording.location !== 'device-only' && (
                    <DropdownMenuItem
                      onClick={(e) => { e.stopPropagation(); onDelete(); }}
                      className="items-start gap-2 text-destructive focus:text-destructive"
                      aria-label={ariaLabelWithScope(LABEL_MOVE_TO_TRASH, SCOPE_TRASH)}
                    >
                      <Trash2 className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
                      <span className="flex flex-col">
                        <span>{LABEL_MOVE_TO_TRASH}</span>
                        <span className="text-xs text-muted-foreground">{SCOPE_TRASH}</span>
                      </span>
                    </DropdownMenuItem>
                  )}
                  {onDeleteFromDevice && recording.location === 'both' && (
                    <DropdownMenuItem
                      onClick={(e) => { e.stopPropagation(); onDeleteFromDevice(); }}
                      disabled={!deviceConnected}
                      className="items-start gap-2 text-destructive focus:text-destructive"
                      aria-label={ariaLabelWithScope(LABEL_DELETE_FROM_DEVICE, deviceConnected ? SCOPE_DEVICE_DELETE_SYNCED : SCOPE_DEVICE_NOT_CONNECTED)}
                    >
                      <Trash2 className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
                      <span className="flex flex-col">
                        <span>{LABEL_DELETE_FROM_DEVICE}</span>
                        <span className="text-xs text-muted-foreground">
                          {deviceConnected ? SCOPE_DEVICE_DELETE_SYNCED : SCOPE_DEVICE_NOT_CONNECTED}
                        </span>
                      </span>
                    </DropdownMenuItem>
                  )}
                  {onDeletePermanent && recording.location !== 'device-only' && (
                    <DropdownMenuItem
                      onClick={(e) => { e.stopPropagation(); onDeletePermanent(); }}
                      className="items-start gap-2 text-destructive focus:text-destructive"
                      aria-label={ariaLabelWithScope(LABEL_DELETE_PERMANENTLY, SCOPE_PERMANENT)}
                    >
                      <Trash2 className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
                      <span className="flex flex-col">
                        <span>{LABEL_DELETE_PERMANENTLY}</span>
                        <span className="text-xs text-muted-foreground">{SCOPE_PERMANENT}</span>
                      </span>
                    </DropdownMenuItem>
                  )}
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </TooltipProvider>
  )
}, (prevProps, nextProps) => {
  // Custom comparison for performance
  // LB-16 fix: Include recording.location in equality check to detect download state changes
  return (
    prevProps.recording.id === nextProps.recording.id &&
    prevProps.recording.location === nextProps.recording.location &&
    prevProps.recording.personal === nextProps.recording.personal &&
    prevProps.recording.transcriptionStatus === nextProps.recording.transcriptionStatus &&
    prevProps.recording.title === nextProps.recording.title &&
    prevProps.recording.meetingSubject === nextProps.recording.meetingSubject &&
    prevProps.recording.category === nextProps.recording.category &&
    prevProps.recording.quality === nextProps.recording.quality &&
    prevProps.recording.qualityReasons?.join('|') === nextProps.recording.qualityReasons?.join('|') &&
    prevProps.recording.qualitySource === nextProps.recording.qualitySource &&
    prevProps.recording.duration === nextProps.recording.duration &&
    prevProps.recording.size === nextProps.recording.size &&
    prevProps.isSelected === nextProps.isSelected &&
    prevProps.isActiveSource === nextProps.isActiveSource &&
    prevProps.transcript?.id === nextProps.transcript?.id &&
    prevProps.transcript?.title_suggestion === nextProps.transcript?.title_suggestion &&
    prevProps.meeting?.id === nextProps.meeting?.id &&
    prevProps.meeting?.subject === nextProps.meeting?.subject &&
    prevProps.searchQuery === nextProps.searchQuery &&
    // Include callback props to detect when they change
    prevProps.onClick === nextProps.onClick
  )
})
