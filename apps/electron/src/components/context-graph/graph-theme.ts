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

/** The node types that have a dedicated entity page to click through to. */
export const NAVIGABLE_TYPES = new Set(['person', 'meeting', 'project'])

/** Human-friendly name for an edge relation (e.g. HAS_NEXT_STEP → "has next step"). */
export function relationLabel(edgeType: string): string {
  return edgeType.toLowerCase().replace(/_/g, ' ')
}
