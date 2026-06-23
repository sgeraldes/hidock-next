/**
 * Knowledge Graph Service — wires @hidock/knowledge-graph into the Electron app.
 *
 * Provides:
 * - Singleton KnowledgeGraphStore backed by the app's SQLite database
 * - LlmExtractor that uses @hidock/ai-providers complete()
 * - Incremental ingestion from DB transcripts and from a folder of .txt/.md files
 * - Thin query wrappers for IPC handlers
 */

import { resolve, basename, extname } from 'path'
import { readdirSync, readFileSync, existsSync, statSync } from 'fs'
import {
  KnowledgeGraphStore,
  extractGraphFromTranscript,
  ingestExtraction,
  topAttendeesForProjectOrTopic,
  topSkillDemonstrators,
  personProfile,
  meetingSummaryGraph,
} from '@hidock/knowledge-graph'
import type { GraphDb, LlmExtractor, AttendeeResult, SkillDemonstratorResult, PersonProfile, MeetingGraph, GraphNode } from '@hidock/knowledge-graph'
import { complete } from '@hidock/ai-providers'
import type { ProviderConfig } from '@hidock/ai-providers'
import { getConfig } from './config'
import { run, queryAll, queryOne } from './database'

// ---------------------------------------------------------------------------
// GraphDb adapter — bridges the app's database exports to the GraphDb interface
// ---------------------------------------------------------------------------

const graphDbAdapter: GraphDb = {
  run(sql: string, params?: unknown[]) {
    run(sql, (params ?? []) as any[])
  },
  queryAll<T>(sql: string, params?: unknown[]): T[] {
    return queryAll<T>(sql, (params ?? []) as any[])
  },
  queryOne<T>(sql: string, params?: unknown[]): T | undefined {
    return queryOne<T>(sql, (params ?? []) as any[])
  },
}

// ---------------------------------------------------------------------------
// Singleton store (lazy init on first use)
// ---------------------------------------------------------------------------

let _store: KnowledgeGraphStore | null = null

export function getKnowledgeGraphStore(): KnowledgeGraphStore {
  if (!_store) {
    _store = new KnowledgeGraphStore(graphDbAdapter)
  }
  // Always (re-)run schema init — idempotent (CREATE TABLE IF NOT EXISTS).
  // This ensures graph tables + tracking table exist even when the DB engine
  // has been re-initialized since the singleton was created (e.g., in tests).
  _store.initSchema()
  _ensureIngestTrackingTable()
  return _store
}

function _ensureIngestTrackingTable(): void {
  try {
    run(
      `CREATE TABLE IF NOT EXISTS graph_ingested_transcripts (
        transcript_id TEXT PRIMARY KEY,
        ingested_at TEXT NOT NULL
      )`
    )
  } catch (e) {
    console.warn('[KnowledgeGraph] Could not create graph_ingested_transcripts table:', e)
  }
}

// ---------------------------------------------------------------------------
// Provider config — reads from app config
// ---------------------------------------------------------------------------

function providerConfigFromSettings(): ProviderConfig | null {
  const cfg = getConfig()

  // Use gemini if api key is set
  if (cfg.chat.provider === 'gemini' && cfg.transcription.geminiApiKey) {
    return {
      provider: 'google',
      model: cfg.chat.geminiModel || 'gemini-2.0-flash',
      apiKey: cfg.transcription.geminiApiKey,
    }
  }

  // No valid provider configured
  return null
}

// ---------------------------------------------------------------------------
// Ingestion from DB transcripts
// ---------------------------------------------------------------------------

interface TranscriptRow {
  id: string
  full_text: string
  recording_id: string
  date_recorded: string | null
  meeting_id: string | null
  subject: string | null
}

export interface IngestResult {
  ingested: number
  skipped: number
  errors: Array<{ transcriptId: string; error: string }>
}

export async function ingestFromDbTranscripts(): Promise<IngestResult> {
  const providerConfig = providerConfigFromSettings()
  if (!providerConfig) {
    throw new Error('No AI provider configured. Please set a provider API key in Settings.')
  }

  const store = getKnowledgeGraphStore()
  const llm: LlmExtractor = (prompt: string) => complete(prompt, providerConfig)

  // Get all transcripts with recording + meeting meta
  const rows = queryAll<TranscriptRow>(`
    SELECT
      t.id,
      t.full_text,
      t.recording_id,
      r.date_recorded,
      r.meeting_id,
      m.subject
    FROM transcripts t
    JOIN recordings r ON r.id = t.recording_id
    LEFT JOIN meetings m ON m.id = r.meeting_id
  `)

  const result: IngestResult = { ingested: 0, skipped: 0, errors: [] }

  for (const row of rows) {
    // Check if already ingested (incremental)
    const already = queryOne<{ transcript_id: string }>(
      'SELECT transcript_id FROM graph_ingested_transcripts WHERE transcript_id = ?',
      [row.id]
    )
    if (already) {
      result.skipped++
      continue
    }

    try {
      const meta = {
        meetingId: row.meeting_id ?? row.recording_id,
        title: row.subject ?? undefined,
        date: row.date_recorded ?? undefined,
      }
      const extraction = await extractGraphFromTranscript(row.full_text, meta, llm)
      ingestExtraction(store, extraction, meta, new Date().toISOString())

      // Mark as ingested
      run(
        'INSERT OR IGNORE INTO graph_ingested_transcripts (transcript_id, ingested_at) VALUES (?, ?)',
        [row.id, new Date().toISOString()]
      )
      result.ingested++
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      result.errors.push({ transcriptId: row.id, error: msg })
      console.error(`[KnowledgeGraph] Failed to ingest transcript ${row.id}:`, e)
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// Ingestion from folder (text/markdown files)
// ---------------------------------------------------------------------------

export async function ingestFromFolder(folderPath: string): Promise<IngestResult> {
  // Security: validate path (no traversal)
  if (!folderPath || typeof folderPath !== 'string') {
    throw new Error('Invalid folder path')
  }

  const resolved = resolve(folderPath)

  // Reject paths that contain traversal segments
  if (folderPath.includes('..')) {
    throw new Error('Path traversal not allowed')
  }

  if (!existsSync(resolved)) {
    throw new Error(`Folder does not exist: ${resolved}`)
  }

  if (!statSync(resolved).isDirectory()) {
    throw new Error(`Path is not a directory: ${resolved}`)
  }

  const providerConfig = providerConfigFromSettings()
  if (!providerConfig) {
    throw new Error('No AI provider configured. Please set a provider API key in Settings.')
  }

  const store = getKnowledgeGraphStore()
  const llm: LlmExtractor = (prompt: string) => complete(prompt, providerConfig)

  const files = readdirSync(resolved).filter((f) => {
    const ext = extname(f).toLowerCase()
    return ext === '.txt' || ext === '.md'
  })

  const result: IngestResult = { ingested: 0, skipped: 0, errors: [] }

  for (const file of files) {
    const filePath = resolve(resolved, file)
    const transcriptId = `folder:${resolved}:${file}`

    // Incremental check
    const already = queryOne<{ transcript_id: string }>(
      'SELECT transcript_id FROM graph_ingested_transcripts WHERE transcript_id = ?',
      [transcriptId]
    )
    if (already) {
      result.skipped++
      continue
    }

    try {
      const content = readFileSync(filePath, 'utf-8')
      const nameWithoutExt = basename(file, extname(file))
      const meta = {
        meetingId: transcriptId,
        title: nameWithoutExt,
        date: undefined,
      }

      const extraction = await extractGraphFromTranscript(content, meta, llm)
      ingestExtraction(store, extraction, meta, new Date().toISOString())

      run(
        'INSERT OR IGNORE INTO graph_ingested_transcripts (transcript_id, ingested_at) VALUES (?, ?)',
        [transcriptId, new Date().toISOString()]
      )
      result.ingested++
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      result.errors.push({ transcriptId: file, error: msg })
      console.error(`[KnowledgeGraph] Failed to ingest file ${file}:`, e)
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// Query wrappers
// ---------------------------------------------------------------------------

export function queryTopAttendees(name: string): AttendeeResult[] {
  const store = getKnowledgeGraphStore()
  return topAttendeesForProjectOrTopic(store, name)
}

export function queryTopSkill(skill: string): SkillDemonstratorResult[] {
  const store = getKnowledgeGraphStore()
  return topSkillDemonstrators(store, skill)
}

export function queryPersonProfile(name: string): PersonProfile | undefined {
  const store = getKnowledgeGraphStore()
  return personProfile(store, name)
}

export function queryMeetingGraph(meetingId: string): MeetingGraph {
  const store = getKnowledgeGraphStore()
  return meetingSummaryGraph(store, meetingId)
}

export function queryStats(): { nodes: number; edges: number; nodesByType: Record<string, number> } {
  const store = getKnowledgeGraphStore()
  const nodes = store.db.queryAll<{ count: number }>('SELECT COUNT(*) AS count FROM graph_nodes')
  const edges = store.db.queryAll<{ count: number }>('SELECT COUNT(*) AS count FROM graph_edges')
  const byType = store.db.queryAll<{ type: string; count: number }>(
    'SELECT type, COUNT(*) AS count FROM graph_nodes GROUP BY type'
  )
  const nodesByType: Record<string, number> = {}
  for (const row of byType) {
    nodesByType[row.type] = row.count
  }
  return {
    nodes: nodes[0]?.count ?? 0,
    edges: edges[0]?.count ?? 0,
    nodesByType,
  }
}

export function queryListNodes(type?: string): GraphNode[] {
  const store = getKnowledgeGraphStore()
  return store.findNodes(type ? { type: type as any } : {})
}
