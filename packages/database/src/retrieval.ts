/** Deterministic, provider-free retrieval routing shared by Electron and MCP. */

export type RetrievalIntent = 'actions' | 'topics' | 'report' | 'general'

const ACTIONS_RE =
  /\b(action items?|actions?|to-?dos?|tasks?|commitments?|compromisos?|acciones?|tareas?|pendientes?|follow.?ups?|assigned|deadlines?|deliverables?|next steps?|pr[óo]ximos pasos)\b/i
const REPORT_RE =
  /\b(report|reporte|informe|deep.?dive|complete (?:summary|analysis)|full (?:summary|report|analysis)|prepar[ae](?:r)?\b.*\b(?:report|informe|resumen)|top \d+|most discussed|m[áa]s discutid)/i
const TOPICS_RE =
  /\b(topics?|subjects?|themes?|temas?|main points?|talked about|discussed|discussi[óo]n|what happened|qu[ée] pas[óo]|overview|resumen|summary|summarize)\b/i

export function detectIntent(message: string): RetrievalIntent {
  if (ACTIONS_RE.test(message)) return 'actions'
  if (REPORT_RE.test(message)) return 'report'
  if (TOPICS_RE.test(message)) return 'topics'
  return 'general'
}

export interface TemporalRange {
  start: string
  end: string
  label: string
}

const iso = (date: Date): string => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
const DAY = 24 * 60 * 60 * 1000

function weekBounds(now: Date, weekOffset: number): { start: Date; end: Date } {
  const day = now.getDay()
  const mondayOffset = day === 0 ? -6 : 1 - day
  const monday = new Date(now.getTime() + (mondayOffset + weekOffset * 7) * DAY)
  return { start: monday, end: new Date(monday.getTime() + 6 * DAY) }
}

function monthBounds(now: Date, monthOffset: number): { start: Date; end: Date } {
  return {
    start: new Date(now.getFullYear(), now.getMonth() + monthOffset, 1),
    end: new Date(now.getFullYear(), now.getMonth() + monthOffset + 1, 0),
  }
}

const formatDate = (date: Date): string =>
  date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

export function resolveTemporalRange(message: string, now: Date = new Date()): TemporalRange | null {
  const normalized = message.toLowerCase()
  let bounds: { start: Date; end: Date } | null = null
  let label = ''

  if (/\b(this week|esta semana)\b/.test(normalized)) {
    bounds = weekBounds(now, 0)
    label = 'this week'
  } else if (/\b(last week|past week|la semana pasada|la última semana|última semana)\b/.test(normalized)) {
    bounds = weekBounds(now, -1)
    label = 'last week'
  } else if (/\b(this month|este mes)\b/.test(normalized)) {
    bounds = monthBounds(now, 0)
    label = 'this month'
  } else if (/\b(last month|el mes pasado|último mes)\b/.test(normalized)) {
    bounds = monthBounds(now, -1)
    label = 'last month'
  } else if (/\b(today|hoy)\b/.test(normalized)) {
    bounds = { start: now, end: now }
    label = 'today'
  } else if (/\b(yesterday|ayer)\b/.test(normalized)) {
    const yesterday = new Date(now.getTime() - DAY)
    bounds = { start: yesterday, end: yesterday }
    label = 'yesterday'
  }

  if (!bounds) return null
  return {
    start: iso(bounds.start),
    end: iso(bounds.end),
    label: `${label} (${formatDate(bounds.start)} – ${formatDate(bounds.end)})`,
  }
}

export function dateGroundingPart(now: Date = new Date(), range: TemporalRange | null = null): string {
  const today = now.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
  const rangeLine = range
    ? ` The user is asking about ${range.label} (dates ${range.start} to ${range.end}, inclusive).`
    : ''
  return `[DATE GROUNDING: Today is ${today}.${rangeLine} Resolve every relative date in the question against this before answering.]`
}

export function inRange(timestamp: string | undefined, range: TemporalRange | null): boolean {
  if (!range || !timestamp) return false
  const day = timestamp.slice(0, 10)
  return day >= range.start && day <= range.end
}
