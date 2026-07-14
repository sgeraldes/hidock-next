/** Renderer-side mirror of the Context Graph DTO (see knowledge-graph-service.ts). */

export interface ContextGraphNode {
  id: string
  type: string
  label: string
  degree: number
  contactId?: string
  meetingId?: string
  projectId?: string
}

export interface ContextGraphEdge {
  id: string
  source: string
  target: string
  type: string
  weight: number
}

export interface ContextGraphData {
  center: string | null
  nodes: ContextGraphNode[]
  edges: ContextGraphEdge[]
}

/** Abstraction bands, top-down. Mirrors the knowledge-graph package's Stratum. */
export type Stratum = 'strategic' | 'operational' | 'people' | 'evidence'

/** A lens node: a graph node annotated with its stratum band + effective date. */
export interface ContextLensNode extends ContextGraphNode {
  stratum: Stratum
  /** Effective recency (epoch ms) for time ordering + age decay, or null. */
  dateMs: number | null
}

/** Per-stratum totals-in-scope vs. shown after the lens node budget. */
export interface ContextLensStratumCount {
  stratum: Stratum
  /** Nodes of this stratum in scope after the time-window filter, before the budget. */
  total: number
  /** Nodes of this stratum actually shown after the budget. */
  shown: number
}

export interface ContextLensData {
  center: string | null
  nodes: ContextLensNode[]
  edges: ContextGraphEdge[]
  /** Newest activity in the lens — the reference the time chips measure back from. */
  referenceMs: number | null
  /**
   * Per-stratum totals-vs-shown — drives the "20 of 214" truncation affordance
   * in the band rail. Empty when the lens is empty.
   */
  strata: ContextLensStratumCount[]
}

/** A one-line entity descriptor (lens center / provenance node). */
export interface LensCenter {
  id: string
  type: string
  label: string
  contactId?: string
  meetingId?: string
  projectId?: string
}

export type ProvenanceEntity = LensCenter & { dateMs: number | null }

/** The evidence path + narrative behind a decision / risk / action. */
export interface Provenance {
  node: ProvenanceEntity | null
  meetings: ProvenanceEntity[]
  people: ProvenanceEntity[]
  projects: ProvenanceEntity[]
  actions: ProvenanceEntity[]
  pathIds: string[]
  narrative: string
  dateMs: number | null
}

/** Rich node detail for the inspector — what a bare label CANNOT show. */
export interface NodeDetail {
  node: LensCenter | null
  /** True when this person node is bound to a real, saved contact. */
  linked: boolean
  contactId: string | null
  pronouns: string | null
  role: string | null
  company: string | null
  email: string | null
  meetingCount: number
  firstSeenMs: number | null
  lastSeenMs: number | null
  peopleCount: number
  projectCount: number
  degree: number
  /** Known spellings folded onto this identity (contact aliases). */
  aliases: string[]
  narrative: string
}

/** Blast-radius preview for a two-node merge. */
export interface MergePreview {
  a: { id: string; label: string; type: string; edges: number } | null
  b: { id: string; label: string; type: string; edges: number } | null
  shared: number
  resulting: number
  /** True when both nodes are linked contacts (folds contacts, undoable). */
  contactMerge: boolean
  contactImpact?: { keeper: number; loser: number }
}
