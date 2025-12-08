import { useState, useEffect, useRef, useCallback } from 'react'
import { Send, Trash2, Bot, User, AlertCircle, CheckCircle2, Database, RefreshCw, ChevronDown, ChevronUp, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { cn, formatDateTime } from '@/lib/utils'
import type { ChatMessage } from '@/types'

interface VectorChunk {
  id: string
  content: string
  meetingId?: string
  recordingId?: string
  chunkIndex: number
  subject?: string
  timestamp?: string
  embeddingDimensions: number
}

interface RAGStatus {
  ollamaAvailable: boolean
  documentCount: number
  meetingCount: number
  ready: boolean
}

interface Source {
  content: string
  meetingId?: string
  subject?: string
  timestamp?: string
  score: number
}

export function Chat() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [initialLoading, setInitialLoading] = useState(true)
  const [initError, setInitError] = useState<string | null>(null)
  const [status, setStatus] = useState<RAGStatus | null>(null)
  const [sessionId] = useState(() => `session_${Date.now()}`)
  const [sources, setSources] = useState<Map<string, Source[]>>(new Map())
  const [chunks, setChunks] = useState<VectorChunk[]>([])
  const [showChunks, setShowChunks] = useState(false)
  const [loadingChunks, setLoadingChunks] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const initialize = async () => {
      setInitialLoading(true)
      setInitError(null)
      try {
        // Check if electronAPI is available
        if (!window.electronAPI?.rag?.status || !window.electronAPI?.chat?.getHistory) {
          throw new Error('Electron API not available. Please restart the application.')
        }
        await Promise.all([loadChatHistory(), checkRAGStatus()])
      } catch (error) {
        console.error('Failed to initialize Chat:', error)
        setInitError(error instanceof Error ? error.message : 'Failed to initialize chat')
      } finally {
        setInitialLoading(false)
      }
    }
    initialize()
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const checkRAGStatus = async () => {
    try {
      const ragStatus = await window.electronAPI.rag.status()
      setStatus(ragStatus)
    } catch (error) {
      console.error('Failed to check RAG status:', error)
      setStatus({ ollamaAvailable: false, documentCount: 0, meetingCount: 0, ready: false })
    }
  }

  const loadChunks = async () => {
    setLoadingChunks(true)
    try {
      const data = await window.electronAPI.rag.getChunks()
      setChunks(data)
    } catch (error) {
      console.error('Failed to load chunks:', error)
    } finally {
      setLoadingChunks(false)
    }
  }

  const toggleChunksView = () => {
    const newShowChunks = !showChunks
    setShowChunks(newShowChunks)
    if (newShowChunks && chunks.length === 0) {
      loadChunks()
    }
  }

  const loadChatHistory = async () => {
    try {
      const history = await window.electronAPI.chat.getHistory(50)
      setMessages(history)
    } catch (error) {
      console.error('Failed to load chat history:', error)
    }
  }

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || loading) return

    const userMessage = input.trim()
    setInput('')
    setLoading(true)

    // Add user message to UI
    const userMsg = await window.electronAPI.chat.addMessage('user', userMessage)
    setMessages((prev) => [...prev, userMsg])

    try {
      // Use the RAG service for response
      const response = await window.electronAPI.rag.chat(sessionId, userMessage)

      if (response.error) {
        const errorMsg = await window.electronAPI.chat.addMessage('assistant', response.error)
        setMessages((prev) => [...prev, errorMsg])
      } else {
        // Store sources for this message
        if (response.sources.length > 0) {
          setSources((prev) => new Map(prev).set(userMsg.id, response.sources))
        }

        // Add assistant response
        const assistantMsg = await window.electronAPI.chat.addMessage(
          'assistant',
          response.answer,
          JSON.stringify(response.sources)
        )
        setMessages((prev) => [...prev, assistantMsg])

        // Store sources for assistant message too
        if (response.sources.length > 0) {
          setSources((prev) => new Map(prev).set(assistantMsg.id, response.sources))
        }
      }
    } catch (error) {
      console.error('Chat error:', error)
      const errorMsg = await window.electronAPI.chat.addMessage(
        'assistant',
        'Sorry, I encountered an error processing your request. Please make sure Ollama is running and try again.'
      )
      setMessages((prev) => [...prev, errorMsg])
    } finally {
      setLoading(false)
    }
  }, [input, loading, sessionId])

  const handleClearHistory = async () => {
    if (confirm('Are you sure you want to clear chat history?')) {
      await window.electronAPI.chat.clearHistory()
      await window.electronAPI.rag.clearSession(sessionId)
      setMessages([])
      setSources(new Map())
    }
  }

  const getMessageSources = (messageId: string): Source[] => {
    return sources.get(messageId) || []
  }

  // Show loading state during initialization
  if (initialLoading) {
    return (
      <div className="flex flex-col h-full">
        <header className="flex items-center justify-between border-b px-6 py-4">
          <div>
            <h1 className="text-2xl font-bold">Meeting Assistant</h1>
            <p className="text-sm text-muted-foreground">Ask questions about your meetings</p>
          </div>
        </header>
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="text-muted-foreground">Initializing chat...</p>
          </div>
        </div>
      </div>
    )
  }

  // Show error state if initialization failed
  if (initError) {
    return (
      <div className="flex flex-col h-full">
        <header className="flex items-center justify-between border-b px-6 py-4">
          <div>
            <h1 className="text-2xl font-bold">Meeting Assistant</h1>
            <p className="text-sm text-muted-foreground">Ask questions about your meetings</p>
          </div>
        </header>
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4 max-w-md text-center">
            <AlertCircle className="h-12 w-12 text-destructive" />
            <h2 className="text-lg font-medium">Failed to Initialize</h2>
            <p className="text-muted-foreground">{initError}</p>
            <Button onClick={() => window.location.reload()}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Reload Page
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between border-b px-6 py-4">
        <div>
          <h1 className="text-2xl font-bold">Meeting Assistant</h1>
          <p className="text-sm text-muted-foreground">Ask questions about your meetings</p>
        </div>
        <div className="flex items-center gap-4">
          {/* Status indicator */}
          {status && (
            <div className="flex items-center gap-2 text-sm">
              {status.ready ? (
                <>
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  <span className="text-muted-foreground">
                    {status.documentCount} chunks from {status.meetingCount} meetings
                  </span>
                </>
              ) : !status.ollamaAvailable ? (
                <>
                  <AlertCircle className="h-4 w-4 text-yellow-500" />
                  <span className="text-muted-foreground">Ollama not running</span>
                </>
              ) : (
                <>
                  <Database className="h-4 w-4 text-yellow-500" />
                  <span className="text-muted-foreground">No transcripts indexed</span>
                </>
              )}
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={checkRAGStatus}>
                <RefreshCw className="h-3 w-3" />
              </Button>
            </div>
          )}
          <Button
            variant={showChunks ? 'secondary' : 'outline'}
            size="sm"
            onClick={toggleChunksView}
          >
            <FileText className="h-4 w-4 mr-2" />
            Chunks
            {showChunks ? <ChevronUp className="h-3 w-3 ml-1" /> : <ChevronDown className="h-3 w-3 ml-1" />}
          </Button>
          <Button variant="outline" size="sm" onClick={handleClearHistory}>
            <Trash2 className="h-4 w-4 mr-2" />
            Clear
          </Button>
        </div>
      </header>

      {/* Status Banner */}
      {status && !status.ready && (
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border-b border-yellow-200 dark:border-yellow-800 px-6 py-3">
          <div className="flex items-center gap-2 text-sm text-yellow-800 dark:text-yellow-200">
            <AlertCircle className="h-4 w-4" />
            {!status.ollamaAvailable ? (
              <span>
                Ollama is not running. Start Ollama with{' '}
                <code className="bg-yellow-100 dark:bg-yellow-800 px-1 rounded">ollama serve</code> to enable AI
                chat.
              </span>
            ) : (
              <span>
                No meeting transcripts indexed yet. Record meetings with your HiDock device to start chatting.
              </span>
            )}
          </div>
        </div>
      )}

      {/* Chunks Viewer Panel */}
      {showChunks && (
        <div className="border-b bg-muted/30 max-h-80 overflow-auto">
          <div className="px-6 py-3">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-medium text-sm">Indexed Chunks ({chunks.length})</h3>
              <Button variant="ghost" size="sm" onClick={loadChunks} disabled={loadingChunks}>
                <RefreshCw className={cn('h-3 w-3 mr-1', loadingChunks && 'animate-spin')} />
                Refresh
              </Button>
            </div>
            {loadingChunks ? (
              <div className="flex items-center justify-center py-8">
                <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : chunks.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                No chunks indexed yet. Transcribe recordings to populate the knowledge base.
              </div>
            ) : (
              <div className="space-y-2">
                {chunks.map((chunk) => (
                  <div
                    key={chunk.id}
                    className="p-3 bg-background rounded-lg border text-sm"
                  >
                    <div className="flex items-center gap-2 mb-2 text-xs text-muted-foreground">
                      <span className="px-1.5 py-0.5 bg-secondary rounded">
                        Chunk #{chunk.chunkIndex}
                      </span>
                      {chunk.subject && (
                        <span className="truncate">{chunk.subject}</span>
                      )}
                      {chunk.timestamp && (
                        <span>{new Date(chunk.timestamp).toLocaleDateString()}</span>
                      )}
                      <span className="ml-auto text-xs opacity-60">
                        {chunk.embeddingDimensions}d embedding
                      </span>
                    </div>
                    <p className="text-xs line-clamp-3 text-muted-foreground">
                      {chunk.content}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-3xl mx-auto space-y-4">
          {messages.length === 0 ? (
            <div className="text-center py-12">
              <Bot className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h2 className="text-lg font-medium">No conversations yet</h2>
              <p className="text-muted-foreground mt-1">
                Ask me about your meetings, decisions, or action items
              </p>
              <div className="mt-6 space-y-2">
                <p className="text-sm text-muted-foreground">Try asking:</p>
                <div className="flex flex-wrap justify-center gap-2">
                  {[
                    'What happened in my meetings this week?',
                    'What action items do I have?',
                    'Summarize the project discussion'
                  ].map((suggestion) => (
                    <button
                      key={suggestion}
                      onClick={() => setInput(suggestion)}
                      className="px-3 py-1.5 text-sm bg-secondary rounded-full hover:bg-secondary/80 transition-colors"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            messages.map((message) => {
              const messageSources = getMessageSources(message.id)
              return (
                <div
                  key={message.id}
                  className={cn('flex gap-3', message.role === 'user' && 'flex-row-reverse')}
                >
                  <div
                    className={cn(
                      'flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center',
                      message.role === 'user' ? 'bg-primary' : 'bg-secondary'
                    )}
                  >
                    {message.role === 'user' ? (
                      <User className="h-4 w-4 text-primary-foreground" />
                    ) : (
                      <Bot className="h-4 w-4" />
                    )}
                  </div>
                  <div className={cn('max-w-[80%]', message.role === 'user' && 'text-right')}>
                    <Card
                      className={cn('p-4', message.role === 'user' && 'bg-primary text-primary-foreground')}
                    >
                      <p className="whitespace-pre-wrap">{message.content}</p>
                      <p
                        className={cn(
                          'text-xs mt-2',
                          message.role === 'user' ? 'text-primary-foreground/70' : 'text-muted-foreground'
                        )}
                      >
                        {formatDateTime(message.created_at)}
                      </p>
                    </Card>
                    {/* Sources */}
                    {message.role === 'assistant' && messageSources.length > 0 && (
                      <div className="mt-2 space-y-1">
                        <p className="text-xs text-muted-foreground">Sources:</p>
                        {messageSources.slice(0, 3).map((source, idx) => (
                          <div
                            key={idx}
                            className="text-xs p-2 bg-secondary/50 rounded border border-border/50"
                          >
                            {source.subject && (
                              <span className="font-medium">{source.subject}</span>
                            )}
                            {source.timestamp && (
                              <span className="text-muted-foreground ml-2">
                                {new Date(source.timestamp).toLocaleDateString()}
                              </span>
                            )}
                            <p className="text-muted-foreground mt-1 line-clamp-2">
                              {source.content}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )
            })
          )}
          {loading && (
            <div className="flex gap-3">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-secondary flex items-center justify-center">
                <Bot className="h-4 w-4" />
              </div>
              <Card className="p-4">
                <div className="flex gap-1">
                  <span className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" />
                  <span
                    className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce"
                    style={{ animationDelay: '0.1s' }}
                  />
                  <span
                    className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce"
                    style={{ animationDelay: '0.2s' }}
                  />
                </div>
              </Card>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input */}
      <div className="border-t p-4">
        <form onSubmit={handleSubmit} className="max-w-3xl mx-auto flex gap-2">
          <Input
            placeholder={
              status?.ready
                ? 'Ask about your meetings...'
                : 'Start Ollama and record meetings to enable chat...'
            }
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={loading}
            className="flex-1"
          />
          <Button type="submit" disabled={loading || !input.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </div>
    </div>
  )
}
