import { useState, useEffect } from 'react'
import { Check, Search, BookOpen, Clock } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { formatDateTime } from '@/lib/utils'
import type { KnowledgeCapture } from '@/types/knowledge'
import { cn } from '@/lib/utils'

interface ContextPickerProps {
  onSelect: (id: string) => void
  selectedIds: string[]
  className?: string
}

export function ContextPicker({ onSelect, selectedIds, className }: ContextPickerProps) {
  const [knowledge, setKnowledge] = useState<KnowledgeCapture[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    const loadKnowledge = async () => {
      try {
        const data = await window.electronAPI.knowledge.getAll({ limit: 50 })
        setKnowledge(data)
      } catch (error) {
        console.error('Failed to load knowledge for picker:', error)
      } finally {
        setLoading(false)
      }
    }
    loadKnowledge()
  }, [])

  const filteredKnowledge = knowledge.filter(k => 
    k.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    k.summary?.toLowerCase().includes(searchQuery.toLowerCase())
  )

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search knowledge..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9 h-9"
        />
      </div>

      <div className="h-[300px] overflow-auto pr-2 space-y-1 custom-scrollbar">
        {loading ? (
          <p className="text-center text-sm text-muted-foreground py-8">Loading knowledge...</p>
        ) : filteredKnowledge.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-8">No results found</p>
        ) : (
          filteredKnowledge.map((item) => {
            const isSelected = selectedIds.includes(item.id)
            return (
              <button
                key={item.id}
                onClick={() => onSelect(item.id)}
                className={cn(
                  "w-full text-left p-3 rounded-lg border transition-all flex items-start gap-3 group",
                  isSelected 
                    ? "bg-primary/5 border-primary ring-1 ring-primary/20" 
                    : "hover:bg-muted border-transparent"
                )}
              >
                <div className={cn(
                  "flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center border",
                  isSelected ? "bg-primary border-primary text-primary-foreground" : "bg-background border-border text-muted-foreground"
                )}>
                  {isSelected ? <Check className="h-4 w-4" /> : <BookOpen className="h-4 w-4" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{item.title}</p>
                  <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    <span>{formatDateTime(item.capturedAt)}</span>
                  </div>
                </div>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}