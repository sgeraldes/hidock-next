/**
 * Actionables Page
 *
 * AI-suggested tasks and actionable items from your meetings and knowledge.
 */

import { useEffect, useState } from 'react'
import {
  FileText,
  Copy,
  Download,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ClipboardList,
  UserCheck,
  FolderKanban,
  ListTodo
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useAppStore } from '@/store/useAppStore'
import { useProjectsStore, useContactsStore } from '@/store'
import { useUIStore } from '@/store/useUIStore'
import { cn } from '@/lib/utils'
import type { OutputTemplateId } from '@/types'

interface OutputTemplate {
  id: OutputTemplateId
  name: string
  description: string
  icon: typeof FileText
}

const TEMPLATES: OutputTemplate[] = [
  {
    id: 'meeting_minutes',
    name: 'Meeting Minutes',
    description: 'Formal meeting minutes with attendees, discussion points, and decisions',
    icon: ClipboardList
  },
  {
    id: 'interview_feedback',
    name: 'Interview Feedback',
    description: 'Structured interview feedback form for hiring decisions',
    icon: UserCheck
  },
  {
    id: 'project_status',
    name: 'Project Status Report',
    description: 'Status report summarizing project progress across meetings',
    icon: FolderKanban
  },
  {
    id: 'action_items',
    name: 'Action Items Summary',
    description: 'Extract and list action items from meetings',
    icon: ListTodo
  }
]

type ContextType = 'meeting' | 'project' | 'contact'

export function Outputs() {
  const { meetings, loadMeetings, meetingsLoading } = useAppStore()
  const { projects, loadProjects, loading: projectsLoading } = useProjectsStore()
  const { contacts, loadContacts, loading: contactsLoading } = useContactsStore()

  // Use individual selectors to avoid creating new objects on every render
  const isGenerating = useUIStore((state) => state.isGeneratingOutput)
  const content = useUIStore((state) => state.outputContent)
  const setGenerating = useUIStore((state) => state.setGeneratingOutput)
  const setContent = useUIStore((state) => state.setOutputContent)
  const clear = useUIStore((state) => state.clearOutput)

  const [selectedTemplate, setSelectedTemplate] = useState<OutputTemplateId | null>(null)
  const [contextType, setContextType] = useState<ContextType>('meeting')
  const [selectedMeetingId, setSelectedMeetingId] = useState<string>('')
  const [selectedProjectId, setSelectedProjectId] = useState<string>('')
  const [selectedContactId, setSelectedContactId] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const isLoading = meetingsLoading || projectsLoading || contactsLoading

  // Load data on mount - use empty deps to avoid re-running
  useEffect(() => {
    const loadData = async () => {
      try {
        await Promise.all([
          loadMeetings(),
          loadProjects(),
          loadContacts()
        ])
      } catch (err) {
        console.error('Failed to load data for Actionables page:', err)
      }
    }
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleGenerate = async () => {
    if (!selectedTemplate) return

    const request: { templateId: OutputTemplateId; meetingId?: string; projectId?: string; contactId?: string } = {
      templateId: selectedTemplate
    }

    // Add context based on selection
    if (contextType === 'meeting' && selectedMeetingId) {
      request.meetingId = selectedMeetingId
    } else if (contextType === 'project' && selectedProjectId) {
      request.projectId = selectedProjectId
    } else if (contextType === 'contact' && selectedContactId) {
      request.contactId = selectedContactId
    } else {
      setError('Please select a context (meeting, project, or contact)')
      return
    }

    setError(null)
    setGenerating(true)

    try {
      const result = await window.electronAPI.outputs.generate(request)

      if (result.success) {
        setContent(result.data.content)
      } else {
        // Handle error safely - result.error could have different structures
        const errorMessage = result.error?.message || 'Failed to create actionable'
        setError(errorMessage)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create actionable')
    } finally {
      setGenerating(false)
    }
  }

  const handleCopy = async () => {
    if (!content) return

    try {
      const result = await window.electronAPI.outputs.copyToClipboard(content)
      if (result.success) {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  const handleSave = async () => {
    if (!content || !selectedTemplate) return

    try {
      const template = TEMPLATES.find(t => t.id === selectedTemplate)
      const suggestedName = `${template?.name?.toLowerCase().replace(/\s+/g, '-') || 'output'}-${new Date().toISOString().slice(0, 10)}.md`

      const result = await window.electronAPI.outputs.saveToFile(content, suggestedName)
      if (!result.success && result.error?.code !== 'VALIDATION_ERROR') {
        setError(result.error?.message || 'Failed to save file')
      }
    } catch (err) {
      console.error('Failed to save:', err)
    }
  }

  const getContextOptions = (): Array<{ id: string; label: string }> => {
    switch (contextType) {
      case 'meeting':
        return (meetings || []).map(m => ({ id: m.id, label: m.subject || 'Untitled' }))
      case 'project':
        return (projects || []).map(p => ({ id: p.id, label: p.name || 'Untitled' }))
      case 'contact':
        return (contacts || []).map(c => ({ id: c.id, label: c.name || 'Unknown' }))
      default:
        return []
    }
  }

  const getSelectedContextId = (): string => {
    switch (contextType) {
      case 'meeting':
        return selectedMeetingId
      case 'project':
        return selectedProjectId
      case 'contact':
        return selectedContactId
      default:
        return ''
    }
  }

  const setSelectedContextId = (id: string) => {
    switch (contextType) {
      case 'meeting':
        setSelectedMeetingId(id)
        break
      case 'project':
        setSelectedProjectId(id)
        break
      case 'contact':
        setSelectedContactId(id)
        break
    }
  }

  const canGenerate = selectedTemplate && getSelectedContextId()

  return (
    <div className="flex h-full">
      {/* Configuration Panel */}
      <div className="w-96 border-r flex flex-col">
        <div className="p-4 border-b">
          <h1 className="text-xl font-semibold">Actionables</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Things to do from your knowledge
          </p>
        </div>

        <div className="flex-1 overflow-auto p-4 space-y-6">
          {/* Template Selection */}
          <div>
            <label className="text-sm font-medium mb-3 block">Select Template</label>
            <div className="space-y-2">
              {TEMPLATES.map((template) => (
                <button
                  key={template.id}
                  onClick={() => setSelectedTemplate(template.id)}
                  className={cn(
                    'w-full text-left p-3 rounded-lg border transition-colors',
                    selectedTemplate === template.id
                      ? 'border-primary bg-primary/5'
                      : 'hover:bg-accent'
                  )}
                >
                  <div className="flex items-start gap-3">
                    <template.icon className={cn(
                      'h-5 w-5 mt-0.5',
                      selectedTemplate === template.id ? 'text-primary' : 'text-muted-foreground'
                    )} />
                    <div>
                      <div className="font-medium">{template.name}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {template.description}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Context Selection */}
          <div>
            <label className="text-sm font-medium mb-3 block">Select Context</label>
            <div className="space-y-3">
              {/* Context Type */}
              <Select value={contextType} onValueChange={(v) => setContextType(v as ContextType)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select context type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="meeting">Single Meeting</SelectItem>
                  <SelectItem value="project">Project (all meetings)</SelectItem>
                  <SelectItem value="contact">Contact (all meetings)</SelectItem>
                </SelectContent>
              </Select>

              {/* Context Value */}
              <Select value={getSelectedContextId()} onValueChange={setSelectedContextId}>
                <SelectTrigger>
                  <SelectValue placeholder={isLoading ? 'Loading...' : `Select a ${contextType}`} />
                </SelectTrigger>
                <SelectContent>
                  {isLoading ? (
                    <SelectItem value="_loading" disabled>Loading...</SelectItem>
                  ) : getContextOptions().length === 0 ? (
                    <SelectItem value="_empty" disabled>No {contextType}s available</SelectItem>
                  ) : (
                    getContextOptions().map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {option.label}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Generate Button */}
          <Button
            onClick={handleGenerate}
            disabled={!canGenerate || isGenerating}
            className="w-full"
          >
            {isGenerating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <FileText className="h-4 w-4 mr-2" />
                Create Actionable
              </>
            )}
          </Button>

          {/* Error Message */}
          {error && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
              <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>
      </div>

      {/* Output Panel */}
      <div className="flex-1 flex flex-col">
        {content ? (
          <>
            {/* Output Header */}
            <div className="p-4 border-b flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                Created successfully
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={handleCopy}>
                  {copied ? (
                    <>
                      <CheckCircle2 className="h-4 w-4 mr-1 text-green-500" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4 mr-1" />
                      Copy
                    </>
                  )}
                </Button>
                <Button variant="outline" size="sm" onClick={handleSave}>
                  <Download className="h-4 w-4 mr-1" />
                  Save
                </Button>
                <Button variant="ghost" size="sm" onClick={clear}>
                  Clear
                </Button>
              </div>
            </div>

            {/* Output Content */}
            <div className="flex-1 overflow-auto p-4">
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <pre className="whitespace-pre-wrap font-sans text-sm bg-muted/30 rounded-lg p-4">
                  {content}
                </pre>
              </div>
            </div>
          </>
        ) : isGenerating ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <Loader2 className="h-12 w-12 mx-auto mb-4 animate-spin text-primary" />
              <p className="text-muted-foreground">Creating your actionable...</p>
              <p className="text-xs text-muted-foreground mt-1">This may take a moment</p>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>Actionables will appear here based on your meetings and action items</p>
              <p className="text-xs mt-1">Select a template and context above to create AI-suggested tasks from your knowledge</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
