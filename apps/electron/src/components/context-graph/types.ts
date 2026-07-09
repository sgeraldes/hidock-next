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

export interface ContextLensData {
  center: string | null
  nodes: ContextLensNode[]
  edges: ContextGraphEdge[]
  /** Newest activity in the lens — the reference the time chips measure back from. */
  referenceMs: number | null
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
