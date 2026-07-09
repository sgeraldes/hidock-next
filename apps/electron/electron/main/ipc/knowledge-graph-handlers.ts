/**
 * IPC handlers for Knowledge Graph operations.
 *
 * Channels:
 *   graph:stats          — node/edge counts by type
 *   graph:ingestAll      — ingest all DB transcripts (incremental)
 *   graph:ingestFolder   — ingest *.txt/*.md from a folder path
 *   graph:topAttendees   — top attendees for a topic/project name
 *   graph:topSkill       — top skill demonstrators
 *   graph:personProfile  — person profile (meetings, skills, action items)
 *   graph:meetingGraph   — all nodes/edges for a meeting
 *   graph:listNodes      — list nodes, optionally filtered by type
 *   graph:resolvePerson  — resolve a graph person name to a canonical contact
 */

import { ipcMain } from 'electron'
import {
  queryStats,
  ingestFromDbTranscripts,
  ingestFromFolder,
  queryTopAttendees,
  queryTopSkill,
  queryPersonProfile,
  queryMeetingGraph,
  queryListNodes,
  queryContextGraph,
  queryNeighborhood,
  searchGraphNodes,
  rekeyExistingPersonNodes,
} from '../services/knowledge-graph-service'
import { getContactByName } from '../services/database'

export function registerKnowledgeGraphHandlers(): void {
  ipcMain.handle('graph:stats', async () => {
    try {
      return { success: true, data: queryStats() }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[graph:stats] Error:', e)
      return { success: false, error: msg }
    }
  })

  ipcMain.handle('graph:ingestAll', async () => {
    try {
      const result = await ingestFromDbTranscripts()
      return { success: true, data: result }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[graph:ingestAll] Error:', e)
      return { success: false, error: msg }
    }
  })

  ipcMain.handle('graph:ingestFolder', async (_event, folderPath: unknown) => {
    try {
      if (!folderPath || typeof folderPath !== 'string') {
        return { success: false, error: 'folderPath must be a non-empty string' }
      }
      // Reject traversal attempts at the IPC layer
      if ((folderPath as string).includes('..')) {
        return { success: false, error: 'Path traversal not allowed' }
      }
      const result = await ingestFromFolder(folderPath as string)
      return { success: true, data: result }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[graph:ingestFolder] Error:', e)
      return { success: false, error: msg }
    }
  })

  ipcMain.handle('graph:topAttendees', async (_event, name: unknown) => {
    try {
      if (!name || typeof name !== 'string') {
        return { success: false, error: 'name must be a non-empty string' }
      }
      return { success: true, data: queryTopAttendees(name as string) }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[graph:topAttendees] Error:', e)
      return { success: false, error: msg }
    }
  })

  ipcMain.handle('graph:topSkill', async (_event, skill: unknown) => {
    try {
      if (!skill || typeof skill !== 'string') {
        return { success: false, error: 'skill must be a non-empty string' }
      }
      return { success: true, data: queryTopSkill(skill as string) }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[graph:topSkill] Error:', e)
      return { success: false, error: msg }
    }
  })

  ipcMain.handle('graph:personProfile', async (_event, name: unknown) => {
    try {
      if (!name || typeof name !== 'string') {
        return { success: false, error: 'name must be a non-empty string' }
      }
      return { success: true, data: queryPersonProfile(name as string) }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[graph:personProfile] Error:', e)
      return { success: false, error: msg }
    }
  })

  ipcMain.handle('graph:meetingGraph', async (_event, meetingId: unknown) => {
    try {
      if (!meetingId || typeof meetingId !== 'string') {
        return { success: false, error: 'meetingId must be a non-empty string' }
      }
      return { success: true, data: queryMeetingGraph(meetingId as string) }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[graph:meetingGraph] Error:', e)
      return { success: false, error: msg }
    }
  })

  ipcMain.handle('graph:listNodes', async (_event, type?: unknown) => {
    try {
      const nodeType = (type && typeof type === 'string') ? type : undefined
      return { success: true, data: queryListNodes(nodeType) }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[graph:listNodes] Error:', e)
      return { success: false, error: msg }
    }
  })

  // Resolve a graph person node's name to a canonical contact (v26). Gives the
  // renderer a direct, indexed lookup instead of scanning contacts.getAll.
  ipcMain.handle('graph:resolvePerson', async (_event, name: unknown) => {
    try {
      if (!name || typeof name !== 'string') {
        return { success: false, error: 'name must be a non-empty string' }
      }
      const contact = getContactByName(name)
      return { success: true, data: contact ?? null }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[graph:resolvePerson] Error:', e)
      return { success: false, error: msg }
    }
  })

  // -------------------------------------------------------------------------
  // Context Graph — interactive visualization + neighborhood retrieval
  // -------------------------------------------------------------------------

  ipcMain.handle('contextGraph:getGraph', async (_event, limit?: unknown) => {
    try {
      const cap = typeof limit === 'number' && limit > 0 ? Math.min(limit, 2000) : undefined
      return { success: true, data: queryContextGraph(cap) }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[contextGraph:getGraph] Error:', e)
      return { success: false, error: msg }
    }
  })

  ipcMain.handle('contextGraph:getNeighborhood', async (_event, entityId: unknown, hops?: unknown) => {
    try {
      if (!entityId || typeof entityId !== 'string') {
        return { success: false, error: 'entityId must be a non-empty string' }
      }
      const h = typeof hops === 'number' ? hops : 1
      return { success: true, data: queryNeighborhood(entityId as string, h) }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[contextGraph:getNeighborhood] Error:', e)
      return { success: false, error: msg }
    }
  })

  ipcMain.handle('contextGraph:search', async (_event, query: unknown) => {
    try {
      if (!query || typeof query !== 'string') {
        return { success: false, error: 'query must be a non-empty string' }
      }
      return { success: true, data: searchGraphNodes(query as string) }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[contextGraph:search] Error:', e)
      return { success: false, error: msg }
    }
  })

  ipcMain.handle('contextGraph:rekey', async () => {
    try {
      return { success: true, data: rekeyExistingPersonNodes() }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[contextGraph:rekey] Error:', e)
      return { success: false, error: msg }
    }
  })

  console.log('Knowledge Graph IPC handlers registered')
}
