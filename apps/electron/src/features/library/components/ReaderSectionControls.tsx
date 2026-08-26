import { ChevronDown, ChevronRight, EyeOff, Maximize2, PanelTop, Square, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import type { ReaderSectionId, ReaderSectionMode } from '@/store/useLibraryStore'

const MODE_LABELS: Record<ReaderSectionMode, string> = {
  expanded: 'Expanded',
  compact: 'Minimized',
  docked: 'Docked',
  hidden: 'Hidden'
}

interface ReaderSectionControlsProps {
  section: ReaderSectionId
  label: string
  mode: ReaderSectionMode
  onModeChange: (mode: ReaderSectionMode) => void
  onMaximize: () => void
  maximized?: boolean
  className?: string
}

export function ReaderSectionControls({
  section,
  label,
  mode,
  onModeChange,
  onMaximize,
  maximized = false,
  className
}: ReaderSectionControlsProps) {
  const expanded = mode === 'expanded' || mode === 'docked'

  return (
    <div
      className={cn('flex min-h-9 items-center gap-1.5', className)}
      data-testid={`reader-${section}-controls`}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-left text-sm font-semibold text-foreground hover:text-foreground/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
        onClick={() => onModeChange(expanded ? 'compact' : 'expanded')}
        aria-expanded={expanded}
        aria-controls={`reader-${section}-content`}
      >
        {expanded ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
        <span className="truncate">{label}</span>
        {mode !== 'expanded' && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            {MODE_LABELS[mode]}
          </span>
        )}
      </button>

      {maximized ? (
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5"
          onClick={() => onMaximize()}
          aria-label={`Return ${label} to reader`}
        >
          <Undo2 className="h-3.5 w-3.5" />
          Return to reader
        </Button>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 shrink-0 gap-1.5 px-2 text-muted-foreground"
              aria-label={`Layout options for ${label}`}
              title={`Layout options for ${label}`}
            >
              <PanelTop className="h-4 w-4" />
              <span className="hidden @md:inline">Layout</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onClick={() => onModeChange('expanded')} disabled={mode === 'expanded'}>
              <Square className="h-4 w-4" />
              Expand
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onModeChange('compact')} disabled={mode === 'compact'}>
              <ChevronRight className="h-4 w-4" />
              Minimize
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onModeChange('docked')} disabled={mode === 'docked'}>
              <PanelTop className="h-4 w-4" />
              {section === 'player' ? 'Dock small player' : 'Dock to top'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onMaximize}>
              <Maximize2 className="h-4 w-4" />
              Maximize section
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onModeChange('hidden')} className="text-muted-foreground">
              <EyeOff className="h-4 w-4" />
              Hide section
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}

interface HiddenReaderSectionsProps {
  hidden: Array<{ id: ReaderSectionId; label: string }>
  onRestore: (section: ReaderSectionId) => void
}

export function HiddenReaderSections({ hidden, onRestore }: HiddenReaderSectionsProps) {
  if (hidden.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b bg-muted/20 px-4 py-1.5 text-xs" data-testid="reader-hidden-sections">
      <span className="mr-1 text-muted-foreground">Hidden</span>
      {hidden.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          onClick={() => onRestore(id)}
          className="rounded-full border bg-background px-2.5 py-1 font-medium text-foreground hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
        >
          Show {label}
        </button>
      ))}
    </div>
  )
}
