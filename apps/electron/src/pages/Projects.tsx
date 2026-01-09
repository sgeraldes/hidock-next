import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Folder,
  Search,
  Plus,
  RefreshCw,
  Clock,
  Trash2,
  Archive,
  CheckCircle2,
  FileText,
  Bot,
  Users
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import type { Project } from '@/types/knowledge'
import { cn } from '@/lib/utils'

export function Projects() {
  const _navigate = useNavigate()
  void _navigate // Reserved for project detail navigation
  const [projects, setProjects] = useState<Project[]>([])
  const [activeProject, setActiveConversation] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'active' | 'archived' | 'all'>('active')

  const loadProjects = async () => {
    setLoading(true)
    try {
      const result = await window.electronAPI.projects.getAll({ search: searchQuery })
      if (result.success) {
        const mapped = result.data.projects.map((p: any) => ({
          ...p,
          status: p.status || 'active',
          createdAt: p.created_at || p.createdAt || new Date().toISOString()
        }))
        setProjects(mapped)
      }
    } catch (error) {
      console.error('Failed to load projects:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadProjects()
  }, [searchQuery])

  const filteredProjects = useMemo(() => {
    return projects.filter(p => {
      if (statusFilter !== 'all' && p.status !== statusFilter) return false
      return true
    })
  }, [projects, statusFilter])

  const handleCreateProject = async () => {
    const name = prompt('Enter project name:')
    if (!name) return
    
    try {
      const result = await window.electronAPI.projects.create({ name })
      if (result.success) {
        const p = result.data as any
        const mapped = {
          ...p,
          status: p.status || 'active',
          createdAt: p.created_at || p.createdAt || new Date().toISOString()
        }
        setProjects(prev => [mapped, ...prev])
        setActiveConversation(mapped)
      }
    } catch (error) {
      console.error('Failed to create project:', error)
    }
  }

  return (
    <div className="flex h-full bg-background">
      {/* Sidebar - Projects List */}
      <aside className="w-80 border-r flex flex-col bg-muted/10">
        <div className="p-4 border-b space-y-4">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold">Projects</h1>
            <Button onClick={handleCreateProject} size="sm" className="h-8 gap-1">
              <Plus className="h-4 w-4" />
              New
            </Button>
          </div>
          
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search projects..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-9"
            />
          </div>

          <div className="flex gap-1 p-1 bg-muted rounded-lg">
            {['active', 'archived'].map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s as any)}
                className={cn(
                  "flex-1 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all",
                  statusFilter === s ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-auto p-2">
          {loading && projects.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filteredProjects.length === 0 ? (
            <p className="text-center text-xs text-muted-foreground py-12">No {statusFilter} projects</p>
          ) : (
            <div className="space-y-1">
              {filteredProjects.map((project) => (
                <div
                  key={project.id}
                  onClick={() => setActiveConversation(project)}
                  className={cn(
                    "w-full text-left p-3 rounded-xl transition-all cursor-pointer group",
                    activeProject?.id === project.id 
                      ? "bg-primary text-primary-foreground shadow-md" 
                      : "hover:bg-muted text-muted-foreground hover:text-foreground"
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div className={cn(
                      "w-10 h-10 rounded-xl flex items-center justify-center border shadow-sm",
                      activeProject?.id === project.id ? "bg-primary-foreground/10 border-primary-foreground/20" : "bg-background border-border"
                    )}>
                      <Folder className={cn("h-5 w-5", activeProject?.id === project.id ? "text-primary-foreground" : "text-muted-foreground")} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold truncate">{project.name}</p>
                      <div className="flex items-center gap-2 mt-1 text-[10px] opacity-70">
                        <Clock className="h-3 w-3" />
                        <span>{new Date(project.createdAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>

      {/* Main Detail Area */}
      <main className="flex-1 flex flex-col min-w-0">
        {activeProject ? (
          <div className="flex flex-col h-full overflow-hidden animate-in fade-in slide-in-from-right-2 duration-300">
            {/* Header */}
            <header className="border-b px-8 py-6 h-[120px] flex items-center justify-between">
              <div className="flex items-center gap-4 min-w-0">
                <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center shadow-inner">
                  <Folder className="h-7 w-7 text-primary" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-2xl font-bold truncate">{activeProject.name}</h2>
                  <div className="flex items-center gap-3 mt-1">
                    <span className={cn(
                      "px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border",
                      activeProject.status === 'active' ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" : "bg-slate-500/10 text-slate-600 border-slate-500/20"
                    )}>
                      {activeProject.status}
                    </span>
                    <span className="text-xs text-muted-foreground">Created {new Date(activeProject.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="h-9 gap-2">
                  <Archive className="h-4 w-4" />
                  {activeProject.status === 'active' ? 'Archive' : 'Activate'}
                </Button>
                <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-destructive">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </header>

            {/* Content */}
            <div className="flex-1 overflow-auto p-8">
              <div className="max-w-4xl mx-auto space-y-8">
                {/* Stats Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <Card className="bg-muted/5">
                    <CardContent className="pt-6">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Knowledge</p>
                        <FileText className="h-4 w-4 text-primary" />
                      </div>
                      <p className="text-2xl font-bold mt-2">12 Items</p>
                    </CardContent>
                  </Card>
                  <Card className="bg-muted/5">
                    <CardContent className="pt-6">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">People</p>
                        <Users className="h-4 w-4 text-primary" />
                      </div>
                      <p className="text-2xl font-bold mt-2">5 Involved</p>
                    </CardContent>
                  </Card>
                  <Card className="bg-muted/5">
                    <CardContent className="pt-6">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Actions</p>
                        <CheckCircle2 className="h-4 w-4 text-primary" />
                      </div>
                      <p className="text-2xl font-bold mt-2">8 Pending</p>
                    </CardContent>
                  </Card>
                </div>

                {/* Description */}
                <div className="space-y-3">
                  <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Description</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground bg-muted/20 p-4 rounded-xl border italic">
                    {activeProject.description || "No description provided for this project."}
                  </p>
                </div>

                {/* AI Suggestions */}
                <Card className="border-primary/20 bg-primary/5">
                  <CardContent className="p-6">
                    <div className="flex items-center gap-2 mb-4">
                      <Bot className="h-5 w-5 text-primary" />
                      <h3 className="font-bold text-sm uppercase tracking-wider">AI Project Insight</h3>
                    </div>
                    <p className="text-sm leading-relaxed">
                      Based on the 12 knowledge items in this project, the recurring theme is **"Amazon Connect Integration Strategy"**. Dani has been the primary driver of technical decisions.
                    </p>
                    <div className="mt-4 flex gap-2">
                      <Button size="sm" variant="outline" className="h-8 text-xs bg-background">Generate Status Report</Button>
                      <Button size="sm" variant="outline" className="h-8 text-xs bg-background">Summarize Decisions</Button>
                    </div>
                  </CardContent>
                </Card>

                {/* Placeholder for tabs content */}
                <div className="pt-4 text-center py-20 border-2 border-dashed rounded-3xl opacity-30">
                  <Folder className="h-12 w-12 mx-auto mb-4" />
                  <p className="text-sm">Knowledge Timeline and Related People visualization will appear here.</p>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground p-8">
            <div className="w-20 h-20 rounded-3xl bg-muted/20 flex items-center justify-center mb-6">
              <Folder className="h-10 w-10 opacity-20" />
            </div>
            <h2 className="text-xl font-bold text-foreground mb-2">Select a Project</h2>
            <p className="text-sm max-w-xs text-center leading-relaxed">
              Choose a project from the sidebar to view aggregated knowledge, people, and AI insights.
            </p>
            <Button onClick={handleCreateProject} variant="outline" className="mt-8 gap-2">
              <Plus className="h-4 w-4" />
              Create New Project
            </Button>
          </div>
        )}
      </main>
    </div>
  )
}