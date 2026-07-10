/**
 * The Stream (Today) moment model.
 *
 * A "moment" is one thing you captured — a recording, a document, an image
 * (clipboard screenshot), a code push, a diagram. The Today page renders these
 * as a single chronological feed grouped by day, regardless of source type.
 *
 * This is a discriminated union on `source`, so a renderer can `switch` on it
 * and TypeScript narrows to the right per-source `meta` payload. The five source
 * types are stable contract: producers in OTHER features (a clipboard-screenshot
 * agent, a future GitHub connector) build `image` / `code` moments to this shape
 * and the Stream renders them automatically.
 */

export type MomentSource = 'recording' | 'document' | 'image' | 'code' | 'diagram'

/** A metadata chip on a moment card. `tone` maps to a semantic color. */
export interface MomentBadge {
  label: string
  tone?: 'neutral' | 'action' | 'decision' | 'info' | 'device'
}

/** A clickable relationship rendered under a moment (people, project, output…). */
export interface MomentLink {
  kind: 'meeting' | 'project' | 'person' | 'output' | 'recording' | 'document' | 'thread' | 'external'
  label: string
  /** Entity id, when the link is navigable to a detail surface. */
  id?: string
  /** Explicit navigation target; when absent the renderer derives one from kind+id. */
  route?: string
  state?: Record<string, unknown>
}

/** A person associated with a moment — used for chips AND People-today rollup. */
export interface MomentPerson {
  id?: string
  name: string
}

/** The "thread" a moment belongs to (a meeting subject or a project). */
export interface MomentThread {
  key: string
  label: string
}

/** Where clicking the moment's title takes you. */
export interface MomentOpenTarget {
  route: string
  state?: Record<string, unknown>
}

interface MomentBase {
  id: string
  /** ISO 8601 capture time. */
  timestamp: string
  title: string
  summary?: string
  badges: MomentBadge[]
  links: MomentLink[]
  /** Recorded on the HiDock but not yet downloaded/transcribed. */
  stillOnDevice?: boolean
  open?: MomentOpenTarget
  people?: MomentPerson[]
  thread?: MomentThread
}

export interface RecordingMoment extends MomentBase {
  source: 'recording'
  recording: {
    recordingId: string
    durationSec?: number
    transcribed: boolean
    actionCount?: number
    decisionCount?: number
    keyPointCount?: number
    participantCount?: number
  }
}

export interface DocumentMoment extends MomentBase {
  source: 'document'
  document: {
    recordingId?: string
    kind: 'pdf' | 'note' | 'data' | 'doc'
    pageCount?: number
    extracted?: boolean
    claimCount?: number
  }
}

export interface ImageMoment extends MomentBase {
  source: 'image'
  image: {
    recordingId?: string
    thumbnailUrl?: string
    ocr?: boolean
    tableExtracted?: boolean
  }
}

export interface CodeMoment extends MomentBase {
  source: 'code'
  code: {
    repo?: string
    branch?: string
    commitCount?: number
    openQuestion?: string
  }
}

export interface DiagramMoment extends MomentBase {
  source: 'diagram'
  diagram: {
    tool?: string
    componentCount?: number
  }
}

export type Moment = RecordingMoment | DocumentMoment | ImageMoment | CodeMoment | DiagramMoment

/** One day's worth of moments, newest day first, newest moment first within. */
export interface MomentDay {
  /** Local-date key `YYYY-MM-DD` — stable grouping key. */
  key: string
  date: Date
  /** "Today" / "Yesterday" / "Thursday, July 9". */
  label: string
  moments: Moment[]
  /** Total moments captured on the day. */
  capturedCount: number
  /** Of those, how many are still on the device (not yet downloaded). */
  onDeviceCount: number
}

/** Right-rail: a thread (meeting/project) with its moments this week. */
export interface ThreadSummary {
  key: string
  label: string
  count: number
  sources: MomentSource[]
}

/** Right-rail: a person appearing in today's moments. */
export interface PersonToday {
  id?: string
  name: string
  momentCount: number
  actionCount: number
}

/** Right-rail: moments of one source type over the trailing window. */
export interface SourceMixEntry {
  source: MomentSource
  count: number
}
