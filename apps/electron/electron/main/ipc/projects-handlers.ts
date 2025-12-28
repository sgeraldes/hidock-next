/**
 * Projects IPC Handlers
 *
 * Handles all project-related IPC communication using the Result pattern.
 */

import { ipcMain } from 'electron'
import {
  getProjects,
  getProjectById,
  createProject,
  updateProject,
  deleteProject,
  getMeetingsForProject,
  tagMeetingToProject,
  untagMeetingFromProject,
  getMeetingById,
  getTranscriptByRecordingId,
  getRecordingsForMeeting,
  Project as DBProject
} from '../services/database'
import { success, error, Result } from '../types/api'
import {
  GetProjectsRequestSchema,
  GetProjectByIdRequestSchema,
  CreateProjectRequestSchema,
  UpdateProjectRequestSchema,
  DeleteProjectRequestSchema,
  TagMeetingRequestSchema,
  UntagMeetingRequestSchema
} from '../validation/projects'
import type { ProjectWithMeetings } from '../types/database'
import type { GetProjectsResponse } from '../types/api'
import type { Project } from '../../src/types/knowledge'
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

        const { search, limit, offset } = parsed.data
        const result = getProjects(search, limit, offset)

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

        // Extract topics from meeting transcripts
        const topicsSet = new Set<string>()
        for (const meeting of meetings) {
          const recordings = getRecordingsForMeeting(meeting.id)
          for (const recording of recordings) {
            const transcript = getTranscriptByRecordingId(recording.id)
            if (transcript?.topics) {
              try {
                const meetingTopics = JSON.parse(transcript.topics) as string[]
                meetingTopics.forEach((topic) => topicsSet.add(topic))
              } catch {
                // Invalid JSON, skip
              }
            }
          }
        }

        return success({
          project: mapToProject(dbProject),
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
        const project = createProject({
          id,
          name: parsed.data.name,
          description: parsed.data.description ?? null
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

        const { id, name, description, status } = parsed.data
        const project = getProjectById(id)
        if (!project) {
          return error('NOT_FOUND', `Project with ID ${id} not found`)
        }

        updateProject(id, name, description, status)

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
}

function mapToProject(dbProject: DBProject): Project {
  return {
    id: dbProject.id,
    name: dbProject.name,
    description: dbProject.description,
    status: (dbProject as any).status || 'active',
    createdAt: dbProject.created_at
  }
}