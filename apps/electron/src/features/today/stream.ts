/**
 * Stream aggregation — pure, deterministic, framework-free.
 *
 * These functions turn the app's existing data (unified recordings, plus any
 * moments produced by other features) into the day-grouped feed and the
 * right-rail rollups the Today page renders. Keeping them pure means the whole
 * data model is unit-testable from fixtures with zero mocking.
 */

import type { UnifiedRecording } from '@/types/unified-recording'
import { getSourceType } from '@/features/library/utils/sourceType'
import { firstMeaningfulLine } from '@/lib/description-format'
import type {
  Moment,
  MomentDay,
  MomentPerson,
  MomentSource,
  PersonToday,
  SourceMixEntry,
  ThreadSummary
} from './types'

// ── date helpers ──────────────────────────────────────────────────────────

/** Local-date key `YYYY-MM-DD` (NOT UTC — the user's calendar day). */
export function dayKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function startOfLocalDay(d: Date): Date {
  const c = new Date(d)
  c.setHours(0, 0, 0, 0)
  return c
}

/** Whole calendar days between two dates (a earlier than b → positive). */
function dayDelta(a: Date, b: Date): number {
  const ms = startOfLocalDay(b).getTime() - startOfLocalDay(a).getTime()
  return Math.round(ms / 86_400_000)
}

/** "Today" / "Yesterday" / "Thursday, July 9". */
export function formatDayLabel(date: Date, now: Date): string {
  const delta = dayDelta(date, now)
  if (delta === 0) return 'Today'
  if (delta === 1) return 'Yesterday'
  return date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
}

function toDate(value: Date | string | number | undefined | null): Date | null {
  if (value == null) return null
  const d = value instanceof Date ? value : new Date(value)
  return isNaN(d.getTime()) ? null : d
}

// ── recording → moment ──────────────────────────────────────────────────────

/**
 * Map a unified recording to its moment source kind. Audio (incl. all
 * device-backed rows) → recording; other extensions → document/image, exactly
 * as the Library's source-type filter classifies them.
 */
export function recordingMomentSource(rec: Pick<UnifiedRecording, 'filename' | 'location'>): MomentSource {
  const t = getSourceType(rec)
  if (t === 'image') return 'image'
  if (t === 'audio') return 'recording'
  return 'document' // pdf / note / data / unknown
}

function documentKind(rec: UnifiedRecording): 'pdf' | 'note' | 'data' | 'doc' {
  const t = getSourceType(rec)
  if (t === 'pdf') return 'pdf'
  if (t === 'note') return 'note'
  if (t === 'data') return 'data'
  return 'doc'
}

export interface RecordingMomentContext {
  /** Meeting participants keyed by meetingId (DB Contact-ish objects). */
  participantsByMeeting?: Record<string, MomentPerson[]>
}

/** Convert one unified recording into a Moment (recording | document | image). */
export function recordingToMoment(rec: UnifiedRecording, ctx: RecordingMomentContext = {}): Moment {
  const source = recordingMomentSource(rec)
  const when = toDate(rec.dateRecorded) ?? new Date(0)
  const timestamp = when.toISOString()
  const title = (rec.title && rec.title.trim()) || rec.filename || 'Untitled'
  const summary = firstMeaningfulLine(rec.summary ?? rec.transcript?.summary) || undefined
  const stillOnDevice = rec.location === 'device-only'
  const transcribed = rec.transcriptionStatus === 'complete'
  const people = rec.meetingId ? ctx.participantsByMeeting?.[rec.meetingId] ?? [] : []
  const thread = rec.meetingSubject
    ? { key: `meeting:${rec.meetingId ?? rec.meetingSubject}`, label: rec.meetingSubject }
    : undefined

  const open = { route: '/library', state: { selectedId: rec.id } }
  const links: Moment['links'] = []
  if (rec.meetingSubject) {
    links.push({ kind: 'meeting', label: rec.meetingSubject, id: rec.meetingId, route: rec.meetingId ? `/meeting/${rec.meetingId}` : undefined })
  }
  for (const p of people) {
    links.push({ kind: 'person', label: p.name, id: p.id, route: p.id ? `/person/${p.id}` : undefined })
  }

  const base = {
    id: `rec:${rec.id}`,
    timestamp,
    title,
    summary,
    stillOnDevice,
    open,
    people,
    thread
  }

  if (source === 'image') {
    return {
      ...base,
      source: 'image',
      badges: buildImageBadges(rec),
      links,
      image: { recordingId: rec.id }
    }
  }
  if (source === 'document') {
    const kind = documentKind(rec)
    return {
      ...base,
      source: 'document',
      badges: buildDocumentBadges(kind, transcribed),
      links,
      document: { recordingId: rec.id, kind, extracted: transcribed }
    }
  }

  const actionCount = rec.transcript?.actionItems?.length
  const keyPointCount = rec.transcript?.keyPoints?.length
  return {
    ...base,
    source: 'recording',
    badges: buildRecordingBadges(rec, { transcribed, actionCount, keyPointCount, participantCount: people.length }),
    links,
    recording: {
      recordingId: rec.id,
      durationSec: rec.duration,
      transcribed,
      actionCount,
      keyPointCount,
      participantCount: people.length || undefined
    }
  }
}

function formatDuration(sec?: number): string | null {
  if (!sec || sec <= 0) return null
  const m = Math.round(sec / 60)
  if (m < 1) return '<1 min'
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const rem = m % 60
  return rem ? `${h}h ${rem}m` : `${h}h`
}

function buildRecordingBadges(
  rec: UnifiedRecording,
  extra: { transcribed: boolean; actionCount?: number; keyPointCount?: number; participantCount: number }
): Moment['badges'] {
  const badges: Moment['badges'] = []
  const dur = formatDuration(rec.duration)
  if (dur) badges.push({ label: dur, tone: 'neutral' })
  if (rec.location === 'device-only') {
    badges.push({ label: 'on device', tone: 'device' })
  } else if (extra.transcribed) {
    badges.push({ label: 'transcribed', tone: 'info' })
  } else if (rec.transcriptionStatus === 'processing' || rec.transcriptionStatus === 'pending') {
    badges.push({ label: 'transcribing…', tone: 'info' })
  }
  if (extra.actionCount && extra.actionCount > 0) {
    badges.push({ label: `${extra.actionCount} ${extra.actionCount === 1 ? 'action' : 'actions'}`, tone: 'action' })
  }
  if (extra.keyPointCount && extra.keyPointCount > 0) {
    badges.push({ label: `${extra.keyPointCount} key ${extra.keyPointCount === 1 ? 'point' : 'points'}`, tone: 'decision' })
  }
  if (extra.participantCount > 0) {
    badges.push({ label: `${extra.participantCount} ${extra.participantCount === 1 ? 'person' : 'people'}`, tone: 'neutral' })
  }
  return badges
}

function buildDocumentBadges(kind: 'pdf' | 'note' | 'data' | 'doc', extracted: boolean): Moment['badges'] {
  const label = kind === 'pdf' ? 'PDF' : kind === 'note' ? 'Note' : kind === 'data' ? 'Data' : 'Document'
  const badges: Moment['badges'] = [{ label, tone: 'neutral' }]
  if (extracted) badges.push({ label: 'extracted', tone: 'info' })
  return badges
}

function buildImageBadges(rec: UnifiedRecording): Moment['badges'] {
  const badges: Moment['badges'] = [{ label: 'screenshot', tone: 'neutral' }]
  if (rec.transcriptionStatus === 'complete') badges.push({ label: 'OCR’d', tone: 'info' })
  return badges
}

// ── building the stream ─────────────────────────────────────────────────────

export interface BuildMomentsInput {
  recordings?: UnifiedRecording[]
  /** Moments produced by other features (code/diagram/image) — rendered as-is. */
  extra?: Moment[]
  context?: RecordingMomentContext
}

/** All moments, newest first, de-duplicated by id (extra wins over derived). */
export function buildMoments({ recordings = [], extra = [], context = {} }: BuildMomentsInput): Moment[] {
  const derived = recordings
    .filter((r) => !r.personal) // respect the "personal/ignored" flag
    .map((r) => recordingToMoment(r, context))
  const byId = new Map<string, Moment>()
  for (const m of derived) byId.set(m.id, m)
  for (const m of extra) byId.set(m.id, m) // producer-supplied moments override
  return sortMomentsDesc([...byId.values()])
}

/** Newest first; ties broken by id for stability. */
export function sortMomentsDesc(moments: Moment[]): Moment[] {
  return [...moments].sort((a, b) => {
    const ta = new Date(a.timestamp).getTime()
    const tb = new Date(b.timestamp).getTime()
    if (tb !== ta) return tb - ta
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
  })
}

/** Group moments into days (newest day first, newest moment first within). */
export function groupMomentsByDay(moments: Moment[], now: Date = new Date()): MomentDay[] {
  const sorted = sortMomentsDesc(moments)
  const groups = new Map<string, Moment[]>()
  for (const m of sorted) {
    const d = new Date(m.timestamp)
    const key = dayKey(d)
    const list = groups.get(key)
    if (list) list.push(m)
    else groups.set(key, [m])
  }
  const days: MomentDay[] = []
  for (const [key, list] of groups) {
    const date = new Date(list[0].timestamp)
    days.push({
      key,
      date,
      label: formatDayLabel(date, now),
      moments: list,
      capturedCount: list.length,
      onDeviceCount: list.filter((m) => m.stillOnDevice).length
    })
  }
  return days.sort((a, b) => b.key.localeCompare(a.key))
}

/** Moments captured within the trailing `days` window (inclusive of today). */
export function momentsWithinDays(moments: Moment[], now: Date, days: number): Moment[] {
  const cutoff = startOfLocalDay(now).getTime() - (days - 1) * 86_400_000
  return moments.filter((m) => {
    const t = new Date(m.timestamp).getTime()
    return !isNaN(t) && t >= cutoff && t <= now.getTime() + 1
  })
}

const SOURCE_MIX_ORDER: MomentSource[] = ['recording', 'document', 'image', 'code', 'diagram']

/** Count moments per source type over the trailing window (only non-zero rows). */
export function computeSourceMix(moments: Moment[], now: Date = new Date(), days = 7): SourceMixEntry[] {
  const recent = momentsWithinDays(moments, now, days)
  const counts = new Map<MomentSource, number>()
  for (const m of recent) counts.set(m.source, (counts.get(m.source) ?? 0) + 1)
  return SOURCE_MIX_ORDER.map((source) => ({ source, count: counts.get(source) ?? 0 })).filter((e) => e.count > 0)
}

/** Threads (meeting/project) touched this week, by moment count (desc). */
export function computeThreads(moments: Moment[], now: Date = new Date(), days = 7, limit = 5): ThreadSummary[] {
  const recent = momentsWithinDays(moments, now, days)
  const map = new Map<string, ThreadSummary>()
  for (const m of recent) {
    if (!m.thread) continue
    const existing = map.get(m.thread.key)
    if (existing) {
      existing.count += 1
      if (!existing.sources.includes(m.source)) existing.sources.push(m.source)
    } else {
      map.set(m.thread.key, { key: m.thread.key, label: m.thread.label, count: 1, sources: [m.source] })
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)).slice(0, limit)
}

/** People appearing in TODAY's moments, with meeting + action rollups (desc). */
export function computePeopleToday(moments: Moment[], now: Date = new Date(), limit = 6): PersonToday[] {
  const todayKey = dayKey(now)
  const map = new Map<string, PersonToday>()
  for (const m of moments) {
    if (dayKey(new Date(m.timestamp)) !== todayKey) continue
    const actions = m.source === 'recording' ? m.recording.actionCount ?? 0 : 0
    for (const p of m.people ?? []) {
      const mapKey = p.id ?? `name:${p.name.toLowerCase()}`
      const existing = map.get(mapKey)
      if (existing) {
        existing.momentCount += 1
        existing.actionCount += actions
      } else {
        map.set(mapKey, { id: p.id, name: p.name, momentCount: 1, actionCount: actions })
      }
    }
  }
  return [...map.values()]
    .sort((a, b) => b.momentCount - a.momentCount || b.actionCount - a.actionCount || a.name.localeCompare(b.name))
    .slice(0, limit)
}
