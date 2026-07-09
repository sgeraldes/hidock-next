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
