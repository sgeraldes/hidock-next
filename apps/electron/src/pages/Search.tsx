import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search as SearchIcon, FileText, Mic } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { formatDateTime } from '@/lib/utils'
import type { Transcript } from '@/types'

export function Search() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Transcript[]>([])
  const [searching, setSearching] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!query.trim()) return

    setSearching(true)
    setHasSearched(true)

    try {
      const transcripts = await window.electronAPI.transcripts.search(query)
      setResults(transcripts)
    } catch (error) {
      console.error('Search failed:', error)
      setResults([])
    } finally {
      setSearching(false)
    }
  }

  const highlightMatch = (text: string, query: string): React.ReactNode => {
    if (!query.trim()) return text

    const parts = text.split(new RegExp(`(${query})`, 'gi'))
    return parts.map((part, i) =>
      part.toLowerCase() === query.toLowerCase() ? (
        <mark key={i} className="bg-yellow-200 dark:bg-yellow-800">
          {part}
        </mark>
      ) : (
        part
      )
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="border-b px-6 py-4">
        <h1 className="text-2xl font-bold">Search Transcripts</h1>
        <p className="text-sm text-muted-foreground">
          Search across all your meeting transcripts
        </p>
      </header>

      {/* Search Form */}
      <div className="p-6 border-b">
        <form onSubmit={handleSearch} className="max-w-2xl mx-auto flex gap-2">
          <div className="relative flex-1">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search for keywords, topics, or phrases..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <Button type="submit" disabled={searching || !query.trim()}>
            {searching ? 'Searching...' : 'Search'}
          </Button>
        </form>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-2xl mx-auto">
          {!hasSearched ? (
            <div className="text-center py-12">
              <SearchIcon className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h2 className="text-lg font-medium">Search your meetings</h2>
              <p className="text-muted-foreground mt-1">
                Find specific topics, decisions, or mentions across all transcripts
              </p>
            </div>
          ) : results.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h2 className="text-lg font-medium">No results found</h2>
              <p className="text-muted-foreground mt-1">
                Try different keywords or check your spelling
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Found {results.length} result{results.length !== 1 && 's'}
              </p>

              {results.map((transcript) => (
                <Card key={transcript.id} className="p-4 hover:bg-accent/50 transition-colors">
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-secondary flex items-center justify-center">
                      <Mic className="h-5 w-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-medium truncate">
                          Recording {transcript.recording_id.slice(0, 8)}
                        </p>
                        <span className="text-xs text-muted-foreground flex-shrink-0">
                          {formatDateTime(transcript.created_at)}
                        </span>
                      </div>

                      {transcript.summary && (
                        <p className="text-sm mt-1 line-clamp-2">
                          {highlightMatch(transcript.summary, query)}
                        </p>
                      )}

                      <p className="text-sm text-muted-foreground mt-2 line-clamp-3">
                        {highlightMatch(
                          transcript.full_text.slice(0, 300) +
                            (transcript.full_text.length > 300 ? '...' : ''),
                          query
                        )}
                      </p>

                      {transcript.topics && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {JSON.parse(transcript.topics)
                            .slice(0, 5)
                            .map((topic: string, i: number) => (
                              <span
                                key={i}
                                className="px-2 py-0.5 text-xs bg-secondary rounded-full"
                              >
                                {topic}
                              </span>
                            ))}
                        </div>
                      )}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
