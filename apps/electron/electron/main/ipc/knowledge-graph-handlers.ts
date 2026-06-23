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
} from '../services/knowledge-graph-service'

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

  console.log('Knowledge Graph IPC handlers registered')
}
