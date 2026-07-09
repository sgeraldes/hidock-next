/**
 * Context Graph entity colors. One hue per node type, with a light + dark
 * variant so the canvas reads clearly in both themes. Kept consistent with the
 * app's entity palette (people = sky, meetings = violet, projects = amber).
 */

export interface EntityColor {
  /** Fill for light theme. */
  light: string
  /** Fill for dark theme. */
  dark: string
  /** Human label for the legend. */
  label: string
}

export const ENTITY_COLORS: Record<string, EntityColor> = {
  person: { light: '#0284c7', dark: '#38bdf8', label: 'People' }, // sky
  meeting: { light: '#7c3aed', dark: '#a78bfa', label: 'Meetings' }, // violet
  project: { light: '#d97706', dark: '#fbbf24', label: 'Projects' }, // amber
  topic: { light: '#059669', dark: '#34d399', label: 'Topics' }, // emerald
  decision: { light: '#0891b2', dark: '#22d3ee', label: 'Decisions' }, // cyan
  action_item: { light: '#e11d48', dark: '#fb7185', label: 'Action items' }, // rose
  risk: { light: '#dc2626', dark: '#f87171', label: 'Risks' }, // red
  next_step: { light: '#0d9488', dark: '#2dd4bf', label: 'Next steps' }, // teal
  skill: { light: '#c026d3', dark: '#e879f9', label: 'Skills' }, // fuchsia
}

export const FALLBACK_COLOR: EntityColor = { light: '#64748b', dark: '#94a3b8', label: 'Other' }

export function entityColor(type: string): EntityColor {
  return ENTITY_COLORS[type] ?? FALLBACK_COLOR
}

/** Concrete fill for a node type in the active theme. */
export function colorForType(type: string, isDark: boolean): string {
  const c = entityColor(type)
  return isDark ? c.dark : c.light
}

// ---------------------------------------------------------------------------
// Strata — the reasoning bands the lens lays nodes out in (top → down)
// ---------------------------------------------------------------------------

import type { Stratum } from './types'

/** Bands top-to-bottom: strategy at the top, the evidence it rests on at the bottom. */
export const STRATA_ORDER: readonly Stratum[] = [
  'strategic',
  'operational',
  'people',
  'evidence',
] as const

/** Which stratum each node type belongs to (mirrors the knowledge-graph package). */
const STRATUM_OF: Record<string, Stratum> = {
  decision: 'strategic',
  risk: 'strategic',
  project: 'operational',
  action_item: 'operational',
  next_step: 'operational',
  topic: 'operational',
  person: 'people',
  skill: 'people',
  meeting: 'evidence',
}

export function stratumOf(type: string): Stratum {
  return STRATUM_OF[type] ?? 'operational'
}

export interface StratumStyle {
  /** Crisp band name shown in the left rail + as the canvas band tag. */
  label: string
  /** One-line description of what the band holds. */
  hint: string
  /** Faint band-fill tint (theme-specific), drawn behind the nodes. */
  bgLight: string
  bgDark: string
  /** High-contrast band-label color (≥4.5:1 on the app background). */
  labelLight: string
  labelDark: string
}

/**
 * Band styling. Fills are deliberately faint (low-alpha) so nodes read on top;
 * the label colors are full-strength slate that clears 4.5:1 on both themes.
 */
export const STRATUM_STYLES: Record<Stratum, StratumStyle> = {
  strategic: {
    label: 'Decisions',
    hint: 'Strategy & risk — what was decided',
    bgLight: 'rgba(8,145,178,0.06)', // cyan
    bgDark: 'rgba(34,211,238,0.07)',
    labelLight: '#334155',
    labelDark: '#cbd5e1',
  },
  operational: {
    label: 'Work',
    hint: 'Projects, action items, topics',
    bgLight: 'rgba(217,119,6,0.055)', // amber
    bgDark: 'rgba(251,191,36,0.06)',
    labelLight: '#334155',
    labelDark: '#cbd5e1',
  },
  people: {
    label: 'People',
    hint: 'Who was involved',
    bgLight: 'rgba(2,132,199,0.055)', // sky
    bgDark: 'rgba(56,189,248,0.06)',
    labelLight: '#334155',
    labelDark: '#cbd5e1',
  },
  evidence: {
    label: 'Meetings',
    hint: 'The sources everything derives from',
    bgLight: 'rgba(124,58,237,0.055)', // violet
    bgDark: 'rgba(167,139,250,0.06)',
    labelLight: '#334155',
    labelDark: '#cbd5e1',
  },
}

/** The node types that have a dedicated entity page to click through to. */
export const NAVIGABLE_TYPES = new Set(['person', 'meeting', 'project'])

/** Human-friendly name for an edge relation (e.g. HAS_NEXT_STEP → "has next step"). */
export function relationLabel(edgeType: string): string {
  return edgeType.toLowerCase().replace(/_/g, ' ')
}
