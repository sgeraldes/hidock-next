/**
 * Per-source-type visual identity for the Stream.
 *
 * One place owns the icon, short label, and color for each moment source, so
 * the day gutter dot, the card's type badge, and the source-mix chart all read
 * as one system. Colors are chosen for ≥4.5:1 text contrast in both themes
 * (the `text` classes carry a dark-mode variant; dots/tints are decorative).
 */

import { Mic, FileText, Image as ImageIcon, GitCommit, Workflow, type LucideIcon } from 'lucide-react'
import type { MomentSource } from './types'

export interface SourceMeta {
  label: string
  short: string
  Icon: LucideIcon
  /** Gutter/legend dot fill. */
  dot: string
  /** Type-badge classes (bg + border + text), contrast-safe in both themes. */
  badge: string
  /** Source-mix bar fill. */
  bar: string
}

export const SOURCE_META: Record<MomentSource, SourceMeta> = {
  recording: {
    label: 'Recording',
    short: 'REC',
    Icon: Mic,
    dot: 'bg-violet-500',
    badge: 'border-violet-500/25 bg-violet-500/10 text-violet-700 dark:text-violet-300',
    bar: 'bg-violet-500'
  },
  document: {
    label: 'Document',
    short: 'DOC',
    Icon: FileText,
    dot: 'bg-sky-500',
    badge: 'border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300',
    bar: 'bg-sky-500'
  },
  image: {
    label: 'Image',
    short: 'IMG',
    Icon: ImageIcon,
    dot: 'bg-amber-500',
    badge: 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    bar: 'bg-amber-500'
  },
  code: {
    label: 'Code',
    short: 'CODE',
    Icon: GitCommit,
    dot: 'bg-emerald-500',
    badge: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    bar: 'bg-emerald-500'
  },
  diagram: {
    label: 'Diagram',
    short: 'DGM',
    Icon: Workflow,
    dot: 'bg-rose-500',
    badge: 'border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-300',
    bar: 'bg-rose-500'
  }
}

/** Semantic tone → chip classes for a moment's metadata badges. */
export const BADGE_TONE: Record<NonNullable<import('./types').MomentBadge['tone']>, string> = {
  neutral: 'border-border bg-muted text-muted-foreground',
  action: 'border-blue-500/25 bg-blue-500/10 text-blue-700 dark:text-blue-300',
  decision: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  info: 'border-violet-500/25 bg-violet-500/10 text-violet-700 dark:text-violet-300',
  device: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
}
