/**
 * Projects Page
 *
 * Displays user-created projects for organizing meetings.
 * Supports creating, editing, deleting projects and tagging meetings.
 */

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Search,
  Folder,
  Plus,
  Calendar,
  Tag,
  X,
  ChevronRight,
  Pencil,
  Trash2
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { useProjectsStore } from '@/store'
import { cn, formatDate } from '@/lib/utils'
import type { Project, Meeting } from '@/types'

export function Projects() {
  const navigate = useNavigate()
  const {
    projects,
    selectedProject,
    selectedProjectMeetings,
    selectedProjectTopics,
    loading,
    searchQuery,
    total,
    loadProjects,
    selectProject,
    createProject,
    updateProject,
    deleteProject,
    setSearchQuery,
    clearSelection
  } = useProjectsStore()

  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [newProjectDescription, setNewProjectDescription] = useState('')
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')

  // Load projects on mount
  useEffect(() => {
    loadProjects()
  }, [loadProjects])

  // Sync edit state when selected project changes
  useEffect(() => {
    if (selectedProject) {
      setEditName(selectedProject.name)
      setEditDescription(selectedProject.description || '')
    }
  }, [selectedProject])

  const handleCreate = async () => {
    if (!newProjectName.trim()) return

    try {
      const project = await createProject(newProjectName.trim(), newProjectDescription.trim() || undefined)
      setIsCreateDialogOpen(false)
      setNewProjectName('')
      setNewProjectDescription('')
      selectProject(project.id)
    } catch (error) {
      console.error('Failed to create project:', error)
    }
  }

  const handleEdit = async () => {
    if (!selectedProject || !editName.trim()) return

    try {
      await updateProject(selectedProject.id, editName.trim(), editDescription.trim() || undefined)
      setIsEditDialogOpen(false)
    } catch (error) {
      console.error('Failed to update project:', error)
    }
  }

  const handleDelete = async () => {
    if (!selectedProject) return

    try {
      await deleteProject(selectedProject.id)
      setIsDeleteDialogOpen(false)
    } catch (error) {
      console.error('Failed to delete project:', error)
    }
  }

  const handleMeetingClick = (meeting: Meeting) => {
    navigate(`/meeting/${meeting.id}`)
  }

  return (
    <div className="flex h-full">
      {/* Project List */}
      <div className="w-80 border-r flex flex-col">
        {/* Header */}
        <div className="p-4 border-b space-y-3">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-semibold">Projects</h1>
            <Button
              size="sm"
              onClick={() => setIsCreateDialogOpen(true)}
            >
              <Plus className="h-4 w-4 mr-1" />
              New
            </Button>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search projects..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {total} projects
          </p>
        </div>

        {/* Project List */}
        <div className="flex-1 overflow-auto">
          {loading && projects.length === 0 ? (
            <div className="p-4 text-center text-muted-foreground">
              Loading projects...
            </div>
          ) : projects.length === 0 ? (
            <div className="p-4 text-center text-muted-foreground">
              <Folder className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No projects yet</p>
              <p className="text-xs mt-1">Create one to organize your meetings</p>
            </div>
          ) : (
            <div className="divide-y">
              {projects.map((project) => (
                <ProjectListItem
                  key={project.id}
                  project={project}
                  isSelected={selectedProject?.id === project.id}
                  onClick={() => selectProject(project.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Project Detail */}
      <div className="flex-1 flex flex-col">
        {selectedProject ? (
          <>
            {/* Project Header */}
            <div className="p-6 border-b">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-4">
                  <div className="h-16 w-16 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Folder className="h-8 w-8 text-primary" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-semibold">{selectedProject.name}</h2>
                    {selectedProject.description && (
                      <p className="text-muted-foreground mt-1">{selectedProject.description}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setIsEditDialogOpen(true)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setIsDeleteDialogOpen(true)}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={clearSelection}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* Stats */}
              <div className="flex gap-6 mt-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Meetings:</span>
                  <span className="ml-1 font-medium">{selectedProjectMeetings.length}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Created:</span>
                  <span className="ml-1 font-medium">{formatDate(selectedProject.created_at)}</span>
                </div>
              </div>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-auto p-6 space-y-6">
              {/* Topics Section */}
              {selectedProjectTopics.length > 0 && (
                <div>
                  <h3 className="font-medium flex items-center gap-2 mb-3">
                    <Tag className="h-4 w-4" />
                    Topics
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {selectedProjectTopics.map((topic, index) => (
                      <span
                        key={index}
                        className="px-2 py-1 bg-muted rounded-md text-sm"
                      >
                        {topic}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Meetings Section */}
              <div>
                <h3 className="font-medium flex items-center gap-2 mb-3">
                  <Calendar className="h-4 w-4" />
                  Meetings ({selectedProjectMeetings.length})
                </h3>
                {selectedProjectMeetings.length === 0 ? (
                  <div className="text-sm text-muted-foreground bg-muted/30 rounded-md p-4 text-center">
                    <p>No meetings tagged to this project yet.</p>
                    <p className="text-xs mt-1">Tag meetings from the meeting detail page.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {selectedProjectMeetings.map((meeting) => (
                      <button
                        key={meeting.id}
                        onClick={() => handleMeetingClick(meeting)}
                        className="w-full text-left p-3 rounded-md border hover:bg-accent transition-colors group"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="font-medium group-hover:text-primary transition-colors">
                              {meeting.subject}
                            </div>
                            <div className="text-sm text-muted-foreground">
                              {formatDate(meeting.start_time)}
                            </div>
                          </div>
                          <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary" />
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <Folder className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>Select a project to view details</p>
              <p className="text-xs mt-1">or create a new one to get started</p>
            </div>
          </div>
        )}
      </div>

      {/* Create Project Dialog */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Project</DialogTitle>
            <DialogDescription>
              Create a project to organize related meetings together.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <label className="text-sm font-medium">Name</label>
              <Input
                placeholder="Project name"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                className="mt-1"
                autoFocus
              />
            </div>
            <div>
              <label className="text-sm font-medium">Description (optional)</label>
              <Textarea
                placeholder="Describe what this project is about..."
                value={newProjectDescription}
                onChange={(e) => setNewProjectDescription(e.target.value)}
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={!newProjectName.trim()}>
              Create Project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Project Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Project</DialogTitle>
            <DialogDescription>
              Update the project name and description.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <label className="text-sm font-medium">Name</label>
              <Input
                placeholder="Project name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="mt-1"
                autoFocus
              />
            </div>
            <div>
              <label className="text-sm font-medium">Description (optional)</label>
              <Textarea
                placeholder="Describe what this project is about..."
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleEdit} disabled={!editName.trim()}>
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Project</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{selectedProject?.name}"?
              This will untag all meetings from this project. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

interface ProjectListItemProps {
  project: Project
  isSelected: boolean
  onClick: () => void
}

function ProjectListItem({ project, isSelected, onClick }: ProjectListItemProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full text-left p-3 hover:bg-accent transition-colors',
        isSelected && 'bg-primary/10'
      )}
    >
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
          <Folder className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-medium truncate">{project.name}</div>
          {project.description && (
            <div className="text-sm text-muted-foreground truncate">{project.description}</div>
          )}
        </div>
      </div>
    </button>
  )
}
