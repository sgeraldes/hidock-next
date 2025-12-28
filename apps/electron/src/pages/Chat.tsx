import { useState, useEffect, useRef, useCallback } from 'react'
import { 
  Send, 
  Trash2, 
  Bot, 
  User, 
  AlertCircle, 
  CheckCircle2, 
  Database, 
  RefreshCw, 
  ChevronDown, 
  ChevronUp, 
  FileText,
  Plus,
  MessageSquare,
  History
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { cn, formatDateTime } from '@/lib/utils'
import type { Message, Conversation } from '@/types/knowledge'

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
  // Chat state
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  
  // UI state
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [initialLoading, setInitialLoading] = useState(true)
  const [initError, setInitError] = useState<string | null>(null)
  const [status, setStatus] = useState<RAGStatus | null>(null)
  const [sources, setSources] = useState<Map<string, Source[]>>(new Map())
  const [chunks, setChunks] = useState<VectorChunk[]>([])
  const [showChunks, setShowChunks] = useState(false)
  const [loadingChunks, setLoadingChunks] = useState(false)
  
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Initialize
  useEffect(() => {
    const initialize = async () => {
      setInitialLoading(true)
      setInitError(null)
      try {
        if (!window.electronAPI?.rag?.status) {
          throw new Error('Electron API not available. Please restart the application.')
        }
        
        await Promise.all([
          loadConversations(),
          checkRAGStatus()
        ])
      } catch (error) {
        console.error('Failed to initialize Chat:', error)
        setInitError(error instanceof Error ? error.message : 'Failed to initialize chat')
      } finally {
        setInitialLoading(false)
      }
    }
    initialize()
  }, [])

  // Auto-scroll to bottom
  useEffect(() => {
    scrollToBottom()
  }, [messages])

  // Load conversations
  const loadConversations = async () => {
    try {
      const history = await window.electronAPI.assistant.getConversations()
      setConversations(history)
      
      // If we have conversations and none active, select the first one
      if (history.length > 0 && !activeConversation) {
        handleSelectConversation(history[0])
      }
    } catch (error) {
      console.error('Failed to load conversations:', error)
    }
  }

  // Select conversation
  const handleSelectConversation = async (conv: Conversation) => {
    setActiveConversation(conv)
    try {
      const msgs = await window.electronAPI.assistant.getMessages(conv.id)
      setMessages(msgs)
      
      // Clear sources when switching conversation (or load them if we persist them)
      setSources(new Map())
    } catch (error) {
      console.error('Failed to load messages:', error)
    }
  }

  // Create new conversation
  const handleNewChat = async () => {
    try {
      const newConv = await window.electronAPI.assistant.createConversation('New Chat')
      setConversations(prev => [newConv, ...prev])
      handleSelectConversation(newConv)
    } catch (error) {
      console.error('Failed to create new chat:', error)
    }
  }

  // Delete conversation
  const handleDeleteConversation = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    if (!confirm('Are you sure you want to delete this conversation?')) return
    
    try {
      await window.electronAPI.assistant.deleteConversation(id)
      setConversations(prev => prev.filter(c => c.id !== id))
      if (activeConversation?.id === id) {
        setActiveConversation(null)
        setMessages([])
      }
    } catch (error) {
      console.error('Failed to delete conversation:', error)
    }
  }

  const checkRAGStatus = async () => {
    try {
      const result = await window.electronAPI.rag.status()
      if (result.success) {
        setStatus(result.data)
      } else {
        setStatus({ ollamaAvailable: false, documentCount: 0, meetingCount: 0, ready: false })
      }
    } catch (error) {
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

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || loading) return

    // Ensure we have a conversation
    let currentConv = activeConversation
    if (!currentConv) {
      try {
        currentConv = await window.electronAPI.assistant.createConversation(input.trim().slice(0, 30) + '...')
        setConversations(prev => [currentConv!, ...prev])
        setActiveConversation(currentConv)
      } catch (err) {
        console.error('Failed to create conversation for message:', err)
        return
      }
    }

    const userMessageContent = input.trim()
    setInput('')
    setLoading(true)

    try {
      // Add user message
      const userMsg = await window.electronAPI.assistant.addMessage(currentConv!.id, 'user', userMessageContent)
      setMessages((prev) => [...prev, userMsg])

      // Use the RAG service for response
      // Note: sessionId here should probably match conversationId for better context tracking in RAG service
      const response = await window.electronAPI.rag.chatLegacy(currentConv!.id, userMessageContent)

      if (response.error) {
        const errorMsg = await window.electronAPI.assistant.addMessage(currentConv!.id, 'assistant', response.error)
        setMessages((prev) => [...prev, errorMsg])
      } else {
        // Store sources for this message
        if (response.sources && response.sources.length > 0) {
          setSources((prev) => new Map(prev).set(userMsg.id, response.sources))
        }

        // Add assistant response
        const assistantMsg = await window.electronAPI.assistant.addMessage(
          currentConv!.id,
          'assistant',
          response.answer,
          JSON.stringify(response.sources || [])
        )
        setMessages((prev) => [...prev, assistantMsg])

        // Store sources
        if (response.sources && response.sources.length > 0) {
          setSources((prev) => new Map(prev).set(assistantMsg.id, response.sources))
        }
      }
      
      // Update updated_at in UI
      setConversations(prev => prev.map(c => 
        c.id === currentConv!.id ? { ...c, updatedAt: new Date().toISOString() } : c
      ).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()))

    } catch (error) {
      console.error('Chat error:', error)
      const errorMsg = await window.electronAPI.assistant.addMessage(
        currentConv!.id,
        'assistant',
        'Sorry, I encountered an error processing your request. Please make sure Ollama is running and try again.'
      )
      setMessages((prev) => [...prev, errorMsg])
    } finally {
      setLoading(false)
    }
  }, [input, loading, activeConversation])

  const getMessageSources = (message: Message): Source[] => {
    if (sources.has(message.id)) return sources.get(message.id)!
    if (message.sources) {
      try {
        return JSON.parse(message.sources)
      } catch {
        return []
      }
    }
    return []
  }

  if (initialLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-muted-foreground">Initializing Knowledge Assistant...</p>
        </div>
      </div>
    )
  }

  if (initError) {
    return (
      <div className="flex h-full items-center justify-center p-6">
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
    )
  }

  return (
    <div className="flex h-full bg-background">
      {/* Sidebar - Conversations History */}
      <aside className="w-64 border-r flex flex-col bg-muted/10">
        <div className="p-4 border-b">
          <Button onClick={handleNewChat} className="w-full gap-2" variant="default">
            <Plus className="h-4 w-4" />
            New Chat
          </Button>
        </div>
        <div className="flex-1 overflow-auto">
          <div className="p-2 space-y-1">
            <div className="px-2 py-2 text-xs font-semibold text-muted-foreground flex items-center gap-2">
              <History className="h-3 w-3" />
              HISTORY
            </div>
            {conversations.length === 0 ? (
              <p className="text-xs text-center text-muted-foreground py-4">No history yet</p>
            ) : (
              conversations.map((conv) => (
                <div
                  key={conv.id}
                  onClick={() => handleSelectConversation(conv)}
                  className={cn(
                    "w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center justify-between group cursor-pointer",
                    activeConversation?.id === conv.id 
                      ? "bg-primary text-primary-foreground" 
                      : "hover:bg-muted text-muted-foreground hover:text-foreground"
                  )}
                >
                  <div className="flex items-center gap-2 overflow-hidden">
                    <MessageSquare className={cn("h-4 w-4 flex-shrink-0", activeConversation?.id === conv.id ? "text-primary-foreground" : "text-muted-foreground")} />
                    <span className="truncate">{conv.title || 'Untitled'}</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                      "h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity",
                      activeConversation?.id === conv.id ? "text-primary-foreground hover:bg-primary-foreground/20" : "hover:text-destructive"
                    )}
                    onClick={(e) => handleDeleteConversation(e, conv.id)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))
            )}
          </div>
        </div>
      </aside>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="flex items-center justify-between border-b px-6 py-4 h-[85px]">
          <div>
            <h1 className="text-2xl font-bold">Knowledge Assistant</h1>
            <p className="text-sm text-muted-foreground truncate max-w-md">
              {activeConversation ? activeConversation.title : 'Knowledge-powered AI conversations'}
            </p>
          </div>
          <div className="flex items-center gap-4">
            {status && (
              <div className="flex items-center gap-2 text-xs">
                {status.ready ? (
                  <div className="flex items-center gap-1.5 text-green-600 dark:text-green-400 bg-green-500/10 px-2 py-1 rounded-full border border-green-500/20">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span>{status.documentCount} chunks indexed</span>
                  </div>
                ) : !status.ollamaAvailable ? (
                  <div className="flex items-center gap-1.5 text-yellow-600 dark:text-yellow-400 bg-yellow-500/10 px-2 py-1 rounded-full border border-yellow-500/20">
                    <AlertCircle className="h-3.5 w-3.5" />
                    <span>Ollama offline</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 text-yellow-600 dark:text-yellow-400 bg-yellow-500/10 px-2 py-1 rounded-full border border-yellow-500/20">
                    <Database className="h-3.5 w-3.5" />
                    <span>Empty knowledge base</span>
                  </div>
                )}
              </div>
            )}
            <Button
              variant={showChunks ? 'secondary' : 'outline'}
              size="sm"
              onClick={toggleChunksView}
              className="h-8"
            >
              <FileText className="h-4 w-4 mr-2" />
              Chunks
            </Button>
          </div>
        </header>

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
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pb-4">
                  {chunks.map((chunk) => (
                    <div
                      key={chunk.id}
                      className="p-3 bg-background rounded-lg border text-sm"
                    >
                      <div className="flex items-center gap-2 mb-2 text-xs text-muted-foreground">
                        <span className="px-1.5 py-0.5 bg-secondary rounded font-mono">
                          #{chunk.chunkIndex}
                        </span>
                        {chunk.subject && (
                          <span className="truncate font-medium">{chunk.subject}</span>
                        )}
                        <span className="ml-auto text-xs opacity-60">
                          {chunk.embeddingDimensions}d
                        </span>
                      </div>
                      <p className="text-xs line-clamp-3 text-muted-foreground italic">
                        "{chunk.content}"
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Messages List */}
        <div className="flex-1 overflow-auto p-6 scroll-smooth">
          <div className="max-w-3xl mx-auto space-y-6">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full py-12 text-center">
                <Bot className="h-16 w-12 text-muted-foreground/30 mb-4" />
                <h2 className="text-xl font-semibold mb-2">Knowledge Assistant</h2>
                <p className="text-muted-foreground max-w-sm mb-8">
                  I can answer questions based on your captured knowledge and recorded meetings.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-lg">
                  {[
                    'Summarize my recent meetings',
                    'What are my pending action items?',
                    'What did Mario say about the project?',
                    'Explain the API implementation'
                  ].map((suggestion) => (
                    <button
                      key={suggestion}
                      onClick={() => setInput(suggestion)}
                      className="p-4 text-sm bg-muted/50 rounded-xl hover:bg-muted border border-transparent hover:border-border transition-all text-left"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((message) => {
                const msgSources = getMessageSources(message)
                return (
                  <div
                    key={message.id}
                    className={cn('flex gap-4 group', message.role === 'user' && 'flex-row-reverse')}
                  >
                    <div
                      className={cn(
                        'flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center shadow-sm border',
                        message.role === 'user' ? 'bg-primary border-primary' : 'bg-background border-border'
                      )}
                    >
                      {message.role === 'user' ? (
                        <User className="h-5 w-5 text-primary-foreground" />
                      ) : (
                        <Bot className="h-5 w-5 text-foreground" />
                      )}
                    </div>
                    <div className={cn('flex flex-col gap-2 max-w-[80%]', message.role === 'user' && 'items-end')}>
                      <div
                        className={cn(
                          'p-4 rounded-2xl shadow-sm border',
                          message.role === 'user' 
                            ? 'bg-primary text-primary-foreground border-primary rounded-tr-none' 
                            : 'bg-background border-border rounded-tl-none'
                        )}
                      >
                        <p className="whitespace-pre-wrap leading-relaxed text-sm md:text-base">{message.content}</p>
                        <p
                          className={cn(
                            'text-[10px] mt-3 opacity-50',
                            message.role === 'user' ? 'text-primary-foreground' : 'text-muted-foreground'
                          )}
                        >
                          {formatDateTime(message.createdAt)}
                        </p>
                      </div>
                      
                      {/* Sources for AI responses */}
                      {message.role === 'assistant' && msgSources.length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-1">
                          {msgSources.slice(0, 3).map((source, idx) => (
                            <div
                              key={idx}
                              className="group/source relative"
                            >
                              <div className="flex items-center gap-1.5 text-[10px] px-2 py-1 bg-muted rounded-full border border-border/50 hover:bg-muted/80 cursor-default transition-colors">
                                <FileText className="h-3 w-3 text-muted-foreground" />
                                <span className="max-w-[120px] truncate">{source.subject || 'Reference'}</span>
                              </div>
                              {/* Source tooltip/popover logic can be added here */}
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
              <div className="flex gap-4">
                <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-background border border-border flex items-center justify-center shadow-sm">
                  <Bot className="h-5 w-5" />
                </div>
                <div className="p-4 rounded-2xl bg-muted/30 border border-border rounded-tl-none flex items-center gap-1.5 h-12">
                  <span className="w-1.5 h-1.5 bg-muted-foreground/40 rounded-full animate-bounce" />
                  <span
                    className="w-1.5 h-1.5 bg-muted-foreground/40 rounded-full animate-bounce"
                    style={{ animationDelay: '0.15s' }}
                  />
                  <span
                    className="w-1.5 h-1.5 bg-muted-foreground/40 rounded-full animate-bounce"
                    style={{ animationDelay: '0.3s' }}
                  />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} className="h-4" />
          </div>
        </div>

        {/* Input Form */}
        <div className="border-t p-6">
          <form onSubmit={handleSubmit} className="max-w-3xl mx-auto">
            <div className="relative flex items-center">
              <Input
                placeholder={
                  status?.ready
                    ? 'Ask me anything about your knowledge base...'
                    : 'Index meetings to enable AI conversations'
                }
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={loading}
                className="pr-12 py-6 rounded-2xl shadow-sm border-border bg-background focus-visible:ring-primary/20"
              />
              <Button 
                type="submit" 
                disabled={loading || !input.trim()}
                size="icon"
                className="absolute right-2 h-10 w-10 rounded-xl"
              >
                <Send className="h-5 w-5" />
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground text-center mt-3">
              I answer based on your meeting transcripts and documents.
            </p>
          </form>
        </div>
      </div>
    </div>
  )
}