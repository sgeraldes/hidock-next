/**
 * Projects IPC Handlers
 *
 * Handles all project-related IPC communication using the Result pattern.
 */

import { ipcMain, shell } from 'electron'
import { existsSync } from 'fs'
import {
  getProjects,
  getProjectById,
  createProject,
  updateProject,
  deleteProject,
  getMeetingsForProject,
  getProjectsForMeeting,
  tagMeetingToProject,
  untagMeetingFromProject,
  getMeetingById,
  getTopicsForProjectMeetings,
  getKnowledgeIdsForProject,
  getPersonIdsForProject,
  mergeProjects,
  unmergeProjects,
  UnmergeResult,
  getProjectsForKnowledge,
  getProjectNotes,
  addProjectNote,
  updateProjectNote,
  deleteProjectNote,
  getActionablesForProject,
  Project as DBProject,
  ProjectNote
} from '../services/database'
import { success, error, Result } from '../types/api'
import {
  GetProjectsRequestSchema,
  GetProjectByIdRequestSchema,
  CreateProjectRequestSchema,
  UpdateProjectRequestSchema,
  DeleteProjectRequestSchema,
  TagMeetingRequestSchema,
  UntagMeetingRequestSchema,
  MergeProjectsRequestSchema,
  GetProjectNotesRequestSchema,
  AddProjectNoteRequestSchema,
  UpdateProjectNoteRequestSchema,
  DeleteProjectNoteRequestSchema
} from '../validation/projects'
import { UUIDSchema } from '../validation/common'
import type { Project } from '@/types/knowledge'
import { randomUUID } from 'crypto'

export function registerProjectsHandlers(): void {
  /**
   * Get all projects with optional search and pagination
   */
  ipcMain.handle(
    'projects:getAll',
    async (_, request?: unknown): Promise<Result<{ projects: Project[]; total: number }>> => {
      try {
        const parsed = GetProjectsRequestSchema.safeParse(request ?? {})
        if (!parsed.success) {
          return error('VALIDATION_ERROR', 'Invalid request parameters', parsed.error.format())
        }

        const { search, limit, offset, status } = parsed.data
        const result = getProjects(search, limit, offset, status)

        return success({
          projects: result.projects.map(mapToProject),
          total: result.total
        })
      } catch (err) {
        console.error('projects:getAll error:', err)
        return error('DATABASE_ERROR', 'Failed to fetch projects', err)
      }
    }
  )

  /**
   * Get project by ID with associated meetings and topics
   */
  ipcMain.handle(
    'projects:getById',
    async (_, id: unknown): Promise<Result<{ project: Project; meetings: any[]; topics: string[] }>> => {
      try {
        const parsed = GetProjectByIdRequestSchema.safeParse({ id })
        if (!parsed.success) {
          return error('VALIDATION_ERROR', 'Invalid project ID', parsed.error.format())
        }

        const dbProject = getProjectById(parsed.data.id)
        if (!dbProject) {
          return error('NOT_FOUND', `Project with ID ${parsed.data.id} not found`)
        }

        const meetings = getMeetingsForProject(parsed.data.id)

        // Extract topics via single JOIN query (replaces N+1 nested loops)
        const topicsSet = new Set<string>()
        const topicsJsonStrings = getTopicsForProjectMeetings(parsed.data.id)
        for (const topicsJson of topicsJsonStrings) {
          try {
            const meetingTopics = JSON.parse(topicsJson) as string[]
            meetingTopics.forEach((topic) => topicsSet.add(topic))
          } catch {
            // Invalid JSON, skip
          }
        }

        // Populate knowledgeIds and personIds from junction tables (B-PRJ-002)
        const knowledgeIds = getKnowledgeIdsForProject(parsed.data.id)
        const personIds = getPersonIdsForProject(parsed.data.id)

        const project = mapToProject(dbProject)
        project.knowledgeIds = knowledgeIds
        project.personIds = personIds

        return success({
          project,
          meetings,
          topics: Array.from(topicsSet)
        })
      } catch (err) {
        console.error('projects:getById error:', err)
        return error('DATABASE_ERROR', 'Failed to fetch project', err)
      }
    }
  )

  /**
   * Create new project
   */
  ipcMain.handle(
    'projects:create',
    async (_, request: unknown): Promise<Result<Project>> => {
      try {
        const parsed = CreateProjectRequestSchema.safeParse(request)
        if (!parsed.success) {
          return error('VALIDATION_ERROR', 'Invalid create request', parsed.error.format())
        }

        const id = randomUUID()
        createProject({
          id,
          name: parsed.data.name,
          description: parsed.data.description ?? null,
          status: 'active'
        })

        // Re-fetch to get status and created_at
        const newProject = getProjectById(id)
        return success(mapToProject(newProject!))
      } catch (err) {
        console.error('projects:create error:', err)
        return error('DATABASE_ERROR', 'Failed to create project', err)
      }
    }
  )

  /**
   * Update project
   */
  ipcMain.handle(
    'projects:update',
    async (_, request: unknown): Promise<Result<Project>> => {
      try {
        const parsed = UpdateProjectRequestSchema.safeParse(request)
        if (!parsed.success) {
          return error('VALIDATION_ERROR', 'Invalid update request', parsed.error.format())
        }

        const { id, name, description, status, folderPath, url } = parsed.data
        const project = getProjectById(id)
        if (!project) {
          return error('NOT_FOUND', `Project with ID ${id} not found`)
        }

        updateProject(id, {
          name,
          description: description ?? undefined,
          status,
          folderPath,
          url
        })

        const updatedProject = getProjectById(id)
        return success(mapToProject(updatedProject!))
      } catch (err) {
        console.error('projects:update error:', err)
        return error('DATABASE_ERROR', 'Failed to update project', err)
      }
    }
  )

  /**
   * Delete project
   */
  ipcMain.handle(
    'projects:delete',
    async (_, id: unknown): Promise<Result<void>> => {
      try {
        const parsed = DeleteProjectRequestSchema.safeParse({ id })
        if (!parsed.success) {
          return error('VALIDATION_ERROR', 'Invalid project ID', parsed.error.format())
        }

        const project = getProjectById(parsed.data.id)
        if (!project) {
          return error('NOT_FOUND', `Project with ID ${parsed.data.id} not found`)
        }

        deleteProject(parsed.data.id)

        return success(undefined)
      } catch (err) {
        console.error('projects:delete error:', err)
        return error('DATABASE_ERROR', 'Failed to delete project', err)
      }
    }
  )

  /**
   * Tag meeting to project
   */
  ipcMain.handle(
    'projects:tagMeeting',
    async (_, request: unknown): Promise<Result<void>> => {
      try {
        const parsed = TagMeetingRequestSchema.safeParse(request)
        if (!parsed.success) {
          return error('VALIDATION_ERROR', 'Invalid tag request', parsed.error.format())
        }

        const { meetingId, projectId } = parsed.data

        // Validate meeting exists
        const meeting = getMeetingById(meetingId)
        if (!meeting) {
          return error('NOT_FOUND', `Meeting with ID ${meetingId} not found`)
        }

        // Validate project exists
        const project = getProjectById(projectId)
        if (!project) {
          return error('NOT_FOUND', `Project with ID ${projectId} not found`)
        }

        tagMeetingToProject(meetingId, projectId)

        return success(undefined)
      } catch (err) {
        console.error('projects:tagMeeting error:', err)
        return error('DATABASE_ERROR', 'Failed to tag meeting to project', err)
      }
    }
  )

  /**
   * Untag meeting from project
   */
  ipcMain.handle(
    'projects:untagMeeting',
    async (_, request: unknown): Promise<Result<void>> => {
      try {
        const parsed = UntagMeetingRequestSchema.safeParse(request)
        if (!parsed.success) {
          return error('VALIDATION_ERROR', 'Invalid untag request', parsed.error.format())
        }

        const { meetingId, projectId } = parsed.data
        untagMeetingFromProject(meetingId, projectId)

        return success(undefined)
      } catch (err) {
        console.error('projects:untagMeeting error:', err)
        return error('DATABASE_ERROR', 'Failed to untag meeting from project', err)
      }
    }
  )

  /**
   * Merge one project into another. The keeper survives; the loser's links are
   * repointed, useful fields folded in, and the loser row deleted.
   */
  ipcMain.handle(
    'projects:merge',
    async (_, request: unknown): Promise<Result<Project>> => {
      try {
        const parsed = MergeProjectsRequestSchema.safeParse(request)
        if (!parsed.success) {
          return error('VALIDATION_ERROR', 'Invalid merge request', parsed.error.format())
        }

        const { keeperId, loserId } = parsed.data
        if (keeperId === loserId) {
          return error('VALIDATION_ERROR', 'Cannot merge a project into itself')
        }
        if (!getProjectById(keeperId)) {
          return error('NOT_FOUND', `Keeper project ${keeperId} not found`)
        }
        if (!getProjectById(loserId)) {
          return error('NOT_FOUND', `Loser project ${loserId} not found`)
        }

        const merged = mergeProjects(keeperId, loserId)
        return success(mapToProject(merged))
      } catch (err) {
        console.error('projects:merge error:', err)
        return error('DATABASE_ERROR', 'Failed to merge projects', err)
      }
    }
  )

  /**
   * Reverse a project merge from its merge_journal id. Mirrors contacts:unmerge.
   */
  ipcMain.handle('projects:unmerge', async (_, journalId: unknown): Promise<Result<UnmergeResult>> => {
    try {
      const parsed = UUIDSchema.safeParse(journalId)
      if (!parsed.success) {
        return error('VALIDATION_ERROR', 'Invalid journal id', parsed.error.format())
      }
      return success(unmergeProjects(parsed.data))
    } catch (err) {
      console.error('projects:unmerge error:', err)
      return error('DATABASE_ERROR', err instanceof Error ? err.message : 'Failed to unmerge projects', err)
    }
  })

  /**
   * Get projects directly assigned to a knowledge capture (knowledge_projects).
   */
  ipcMain.handle(
    'projects:getForKnowledge',
    async (_, knowledgeCaptureId: unknown): Promise<Result<Project[]>> => {
      try {
        const parsed = UUIDSchema.safeParse(knowledgeCaptureId)
        if (!parsed.success) {
          return error('VALIDATION_ERROR', 'Invalid knowledge capture ID', parsed.error.format())
        }

        const projects = getProjectsForKnowledge(parsed.data)
        return success(projects.map(mapToProject))
      } catch (err) {
        console.error('projects:getForKnowledge error:', err)
        return error('DATABASE_ERROR', 'Failed to fetch projects for knowledge capture', err)
      }
    }
  )

  /**
   * Get projects for a specific meeting
   */
  ipcMain.handle(
    'projects:getForMeeting',
    async (_, meetingId: unknown): Promise<Result<Project[]>> => {
      try {
        if (typeof meetingId !== 'string') {
          return error('VALIDATION_ERROR', 'Meeting ID must be a string')
        }

        const projects = getProjectsForMeeting(meetingId)
        return success(projects.map(mapToProject))
      } catch (err) {
        console.error('projects:getForMeeting error:', err)
        return error('DATABASE_ERROR', 'Failed to fetch projects for meeting', err)
      }
    }
  )

  /**
   * Get a project's notes (issues / risks / notes), optionally filtered by kind.
   */
  ipcMain.handle(
    'projects:getNotes',
    async (_, request: unknown): Promise<Result<ProjectNote[]>> => {
      try {
        const parsed = GetProjectNotesRequestSchema.safeParse(request)
        if (!parsed.success) {
          return error('VALIDATION_ERROR', 'Invalid getNotes request', parsed.error.format())
        }
        const notes = getProjectNotes(parsed.data.projectId, parsed.data.kind)
        return success(notes)
      } catch (err) {
        console.error('projects:getNotes error:', err)
        return error('DATABASE_ERROR', 'Failed to fetch project notes', err)
      }
    }
  )

  /**
   * Add a note (issue / risk / note) to a project.
   */
  ipcMain.handle(
    'projects:addNote',
    async (_, request: unknown): Promise<Result<ProjectNote>> => {
      try {
        const parsed = AddProjectNoteRequestSchema.safeParse(request)
        if (!parsed.success) {
          return error('VALIDATION_ERROR', 'Invalid addNote request', parsed.error.format())
        }
        if (!getProjectById(parsed.data.projectId)) {
          return error('NOT_FOUND', `Project with ID ${parsed.data.projectId} not found`)
        }
        const note = addProjectNote(parsed.data.projectId, parsed.data.kind, parsed.data.content)
        return success(note)
      } catch (err) {
        console.error('projects:addNote error:', err)
        return error('DATABASE_ERROR', 'Failed to add project note', err)
      }
    }
  )

  /**
   * Update a note's content and/or status (open ↔ resolved).
   */
  ipcMain.handle(
    'projects:updateNote',
    async (_, request: unknown): Promise<Result<ProjectNote>> => {
      try {
        const parsed = UpdateProjectNoteRequestSchema.safeParse(request)
        if (!parsed.success) {
          return error('VALIDATION_ERROR', 'Invalid updateNote request', parsed.error.format())
        }
        const note = updateProjectNote(parsed.data.id, {
          content: parsed.data.content,
          status: parsed.data.status
        })
        return success(note)
      } catch (err) {
        console.error('projects:updateNote error:', err)
        return error('DATABASE_ERROR', 'Failed to update project note', err)
      }
    }
  )

  /**
   * Delete a note.
   */
  ipcMain.handle(
    'projects:deleteNote',
    async (_, request: unknown): Promise<Result<void>> => {
      try {
        const parsed = DeleteProjectNoteRequestSchema.safeParse(request)
        if (!parsed.success) {
          return error('VALIDATION_ERROR', 'Invalid deleteNote request', parsed.error.format())
        }
        deleteProjectNote(parsed.data.id)
        return success(undefined)
      } catch (err) {
        console.error('projects:deleteNote error:', err)
        return error('DATABASE_ERROR', 'Failed to delete project note', err)
      }
    }
  )

  /**
   * Get actionables whose source knowledge links to the project (v29).
   */
  ipcMain.handle(
    'projects:getActionables',
    async (_, projectId: unknown): Promise<Result<ProjectActionable[]>> => {
      try {
        const parsed = UUIDSchema.safeParse(projectId)
        if (!parsed.success) {
          return error('VALIDATION_ERROR', 'Invalid project ID', parsed.error.format())
        }
        const rows = getActionablesForProject(parsed.data)
        return success(rows.map(mapToActionable))
      } catch (err) {
        console.error('projects:getActionables error:', err)
        return error('DATABASE_ERROR', 'Failed to fetch project actionables', err)
      }
    }
  )

  /**
   * Open a project's folder_path in the OS file explorer. Validates the path is
   * set and exists on disk before calling shell.openPath.
   */
  ipcMain.handle(
    'projects:openFolder',
    async (_, projectId: unknown): Promise<Result<void>> => {
      try {
        const parsed = UUIDSchema.safeParse(projectId)
        if (!parsed.success) {
          return error('VALIDATION_ERROR', 'Invalid project ID', parsed.error.format())
        }
        const project = getProjectById(parsed.data)
        if (!project) {
          return error('NOT_FOUND', `Project with ID ${parsed.data} not found`)
        }
        const folderPath = project.folder_path
        if (!folderPath || !folderPath.trim()) {
          return error('VALIDATION_ERROR', 'Project has no folder path set')
        }
        if (!existsSync(folderPath)) {
          return error('NOT_FOUND', `Folder does not exist: ${folderPath}`)
        }
        const openError = await shell.openPath(folderPath)
        if (openError) {
          return error('DATABASE_ERROR', openError)
        }
        return success(undefined)
      } catch (err) {
        console.error('projects:openFolder error:', err)
        return error('DATABASE_ERROR', 'Failed to open project folder', err)
      }
    }
  )
}

/** Actionable shape returned to the renderer (subset of the actionables table). */
interface ProjectActionable {
  id: string
  type: string
  title: string
  description: string | null
  sourceKnowledgeId: string
  status: string
  confidence: number | null
  createdAt: string
}

function mapToActionable(row: Record<string, unknown>): ProjectActionable {
  return {
    id: row.id as string,
    type: row.type as string,
    title: row.title as string,
    description: (row.description as string) ?? null,
    sourceKnowledgeId: row.source_knowledge_id as string,
    status: row.status as string,
    confidence: (row.confidence as number) ?? null,
    createdAt: row.created_at as string
  }
}

function mapToProject(dbProject: DBProject): Project & { knowledgeIds?: string[]; personIds?: string[] } {
  return {
    id: dbProject.id,
    name: dbProject.name,
    description: dbProject.description,
    status: (dbProject.status === 'archived' ? 'archived' : 'active') as 'active' | 'archived',
    folderPath: dbProject.folder_path ?? null,
    url: dbProject.url ?? null,
    createdAt: dbProject.created_at
  }
}