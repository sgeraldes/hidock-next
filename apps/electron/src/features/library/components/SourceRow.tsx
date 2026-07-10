import { memo, useState } from 'react'
import { AlertCircle, Download, Trash2, Wand2, Sparkles, FileText, RefreshCw, AudioLines, MoreHorizontal, Calendar, EyeOff, Eye } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import { UnifiedRecording, hasLocalPath } from '@/types/unified-recording'
import { StatusIcon } from './StatusIcon'
import { TranscriptionStatusBadge } from './TranscriptionStatusBadge'
import { useLibraryStore } from '@/store/useLibraryStore'
import { getDisplayTitle } from '@/features/library/utils/getDisplayTitle'
import { highlightText } from '@/features/library/utils/highlightText'
import { getRowMeta } from '@/features/library/utils/rowMeta'
import { sourceTypeLabel } from '@/features/library/utils/sourceType'

interface SourceRowProps {
  recording: UnifiedRecording
  meeting?: Meeting
  transcript?: Transcript
  isSelected?: boolean
  isActiveSource?: boolean
  /** True when ≥1 row anywhere in the list is selected (selection mode active) —
      keeps every row's checkbox revealed so the selected set stays adjustable. */
  anySelected?: boolean
  searchQuery?: string
  onSelectionChange?: (id: string, shiftKey: boolean) => void
  onClick?: () => void
  // Action handlers
  onDownload?: () => void
  onDelete?: () => void
  onDeletePermanent?: () => void
  onMarkPersonal?: () => void
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
  anySelected = false,
  searchQuery = '',
  onSelectionChange,
  onClick,
  onDownload,
  onDelete,
  onDeletePermanent,
  onMarkPersonal,
  onTranscribe,
  onReprocessVibeVoice,
  onAskAssistant,
  onGenerateOutput,
  isDownloading = false,
  downloadProgress,
  deviceConnected = false
}: SourceRowProps) {
  const error = useLibraryStore((state) => state.recordingErrors.get(recording.id))

  // Reveal-on-interaction state for the bulk-selection checkbox. Tracked locally
  // so the checkbox can be CONDITIONALLY RENDERED (not just faded): when hidden it
  // is absent from the DOM entirely, taking ZERO layout width — the title/content
  // then shifts left into the freed space instead of leaving a permanent gap.
  const [isHovering, setIsHovering] = useState(false)
  const [isFocusWithin, setIsFocusWithin] = useState(false)
  // The checkbox is shown ONLY when: this row is checked, selection mode is active
  // (≥1 row selected anywhere), or the user is hovering/keyboard-focusing this row.
  // Merely VIEWING a row (isActiveSource) never shows it — viewing ≠ selecting.
  const showCheckbox = Boolean(onSelectionChange) && (isSelected || anySelected || isHovering || isFocusWithin)

  // Smart title
  const { primaryText, source: titleSource } = getDisplayTitle(recording, meeting, transcript)
  // The machine filename is noise in the prime space — it lives in the row's
  // hover tooltip and the expanded row, never on the always-visible second line.
  const titleIsFilename = titleSource === 'filename'

  const handleCheckboxClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    onSelectionChange?.(recording.id, e.shiftKey)
  }

  const handleRowClick = (e: React.MouseEvent) => {
    // Don't trigger onClick if clicking on buttons or checkbox
    const target = e.target as HTMLElement
    if (target.closest('button') || target.closest('[role="checkbox"]')) {
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
    <div
      className={[
        // `group` lets the selection checkbox reveal on row hover/focus.
        'group @container flex items-center justify-between py-2 px-3 cursor-pointer',
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
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      onFocus={() => setIsFocusWithin(true)}
      onBlur={(e) => {
        // Only drop focus-reveal when focus leaves the row entirely (not when it
        // moves between the row and its checkbox/menu children).
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setIsFocusWithin(false)
        }
      }}
      aria-selected={isSelected}
      tabIndex={0}
    >
      <div className="flex items-center gap-2 min-w-0 flex-1">
        {/* Checkbox is CONDITIONALLY RENDERED: when hidden it is not in the DOM at
            all, so it consumes zero width and no flex gap — the title slides left.
            It reveals on hover/keyboard-focus and stays put while selected or while
            selection mode is active. */}
        {onSelectionChange && showCheckbox && (
          <Checkbox
            checked={isSelected}
            onClick={handleCheckboxClick}
            aria-label={`Select ${recording.filename}`}
            className="shrink-0"
          />
        )}
        <StatusIcon recording={recording} />
        <TranscriptionStatusBadge status={recording.transcriptionStatus} compact />

        {/* Content area — flex-1 to fill remaining space */}
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
            {/* Provenance chip: the row is linked to a calendar meeting. Surfaces the
                connection the system already knows (B1) without repeating the subject. */}
            {meeting && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      className="mt-[3px] inline-flex shrink-0 text-primary/70"
                      role="img"
                      aria-label={`Linked to calendar meeting: ${meeting.subject}`}
                    >
                      <Calendar className="h-3 w-3" aria-hidden="true" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Linked to calendar meeting</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{formatDateTime(meeting.start_time)}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
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

      {/* Action area — error + overflow menu. Playback lives in the mid-panel
          player (clicking the row opens it), so there is no per-row Play button. */}
      <div className="flex items-center gap-1 shrink-0 ml-2">
        {/* Error indicator */}
        {error && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <AlertCircle className="h-3.5 w-3.5 text-destructive shrink-0" aria-label="Processing error" />
              </TooltipTrigger>
              <TooltipContent>
                <p>{error.message}</p>
                {error.details && <p className="text-xs text-muted-foreground mt-1">{error.details}</p>}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
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
            {onDelete && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={(e) => { e.stopPropagation(); onDelete(); }}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  {recording.location === 'device-only' ? 'Delete from device'
                    : recording.location === 'local-only' ? 'Delete from computer'
                      : 'Delete everywhere'}
                </DropdownMenuItem>
                {onDeletePermanent && recording.location !== 'device-only' && (
                  <DropdownMenuItem
                    onClick={(e) => { e.stopPropagation(); onDeletePermanent(); }}
                    className="text-destructive focus:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                    Delete permanently…
                  </DropdownMenuItem>
                )}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
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
    prevProps.recording.duration === nextProps.recording.duration &&
    prevProps.recording.size === nextProps.recording.size &&
    prevProps.isSelected === nextProps.isSelected &&
    prevProps.anySelected === nextProps.anySelected &&
    prevProps.isActiveSource === nextProps.isActiveSource &&
    prevProps.transcript?.id === nextProps.transcript?.id &&
    prevProps.transcript?.title_suggestion === nextProps.transcript?.title_suggestion &&
    prevProps.meeting?.id === nextProps.meeting?.id &&
    prevProps.meeting?.subject === nextProps.meeting?.subject &&
    prevProps.searchQuery === nextProps.searchQuery &&
    // Include callback props to detect when they change
    prevProps.onSelectionChange === nextProps.onSelectionChange &&
    prevProps.onClick === nextProps.onClick
  )
})
