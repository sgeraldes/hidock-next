import { Search } from 'lucide-react'
import { Input } from '../ui/input'
import { cn } from '../../lib/utils'

interface TranscriptSearchProps {
  value: string
  onChange: (value: string) => void
  className?: string
}

export function TranscriptSearch({ value, onChange, className }: TranscriptSearchProps) {
  return (
    <div className={cn('relative', className)}>
      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
      <Input
        type="search"
        placeholder="Search transcript..."
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="pl-8 h-8 text-xs"
      />
    </div>
  )
}
