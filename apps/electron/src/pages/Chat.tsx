import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import {
  Send,
  Plus,
  Trash2,
  FileText,
  X,
  MessageSquare,
  RefreshCw,
  AlertCircle,
  History,
  CheckCircle2,
  Database,
  Layers,
  BookOpen,
  Bot,
  User,
  FileAudio,
  Square,
  RotateCcw,
  Search,
  Download,
  GripVertical
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { toast } from '@/components/ui/toaster'
import { ContextPicker } from '@/components/ContextPicker'
import { cn, getRelativeTime } from '@/lib/utils'
import type { Message, Conversation, KnowledgeCapture } from '@/types/knowledge'

const MAX_INPUT_LENGTH = 4000

// Chat UI constants
const CHAT_SIDEBAR = {
  DEFAULT_WIDTH: 256,  // 16rem
  MIN_WIDTH: 200,      // 12.5rem
  MAX_WIDTH: 500       // 31.25rem
} as const

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
  // Hooks
  const location = useLocation()
  const navigate = useNavigate()

  // Chat state
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [contextIds, setContextIds] = useState<string[]>([])
  const [contextItems, setContextItems] = useState<KnowledgeCapture[]>([])

  // AUD3-004: Generation counter to prevent stale async results when rapidly switching conversations
  const conversationLoadIdRef = useRef(0)

  // Recording context state (from Library navigation)
  const [contextRecording, setContextRecording] = useState<KnowledgeCapture | null>(null)
  const [contextLoading, setContextLoading] = useState(false)
  const [contextError, setContextError] = useState<string | null>(null)

  // UI state
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [failedMessageIds, setFailedMessageIds] = useState<Set<string>>(new Set())
  const [initialLoading, setInitialLoading] = useState(true)
  const [initError, setInitError] = useState<string | null>(null)
  const [status, setStatus] = useState<RAGStatus | null>(null)

  // C-CHAT: Search within conversation
  const [searchQuery, setSearchQuery] = useState('')

  // C-CHAT: Resizable sidebar
  const [sidebarWidth, setSidebarWidth] = useState<number>(CHAT_SIDEBAR.DEFAULT_WIDTH)
  const [isResizing, setIsResizing] = useState(false)
  const isResizingRef = useRef(false)
  const rafRef = useRef<number>()
  const [sources, setSources] = useState<Map<string, Source[]>>(new Map())
  const [chunks, setChunks] = useState<VectorChunk[]>([])
  const [showChunks, setShowChunks] = useState(false)
  const [loadingChunks, setLoadingChunks] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)

  // B-CHAT-003: AlertDialog state for delete confirmation
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

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

  // Load recording context
  const loadRecordingContext = useCallback(async (contextId: string) => {
    setContextLoading(true)
    setContextError(null)
    try {
      // Validate knowledge capture exists
      const capture = await window.electronAPI.knowledge.getById(contextId)
      if (!capture) {
        setContextError('Recording not found')
        return
      }
      setContextRecording(capture)

      // Auto-create or select conversation for this context
      if (!activeConversation) {
        const newConv = await window.electronAPI.assistant.createConversation(
          capture.title || 'Chat about recording'
        )
        setConversations(prev => [newConv, ...prev])
        setActiveConversation(newConv)

        // Attach context to the new conversation
        await window.electronAPI.assistant.addContext(newConv.id, contextId)
        setContextIds([contextId])
        setContextItems([capture])
      } else {
        // Attach to existing conversation
        if (!contextIds.includes(contextId)) {
          await window.electronAPI.assistant.addContext(activeConversation.id, contextId)
          setContextIds(prev => [...prev, contextId])
          setContextItems(prev => [...prev, capture])
        }
      }
    } catch (error) {
      setContextError('Failed to load recording context')
      console.error('Context loading failed:', error)
    } finally {
      setContextLoading(false)
    }
  }, [activeConversation, contextIds])

  // Load recording context from navigation state
  useEffect(() => {
    const state = location.state as { contextId?: string; initialQuery?: string } | null
    if (state?.contextId) {
      loadRecordingContext(state.contextId)
    }
    if (state?.initialQuery) {
      setInput(state.initialQuery)
    }
  }, [location.state, loadRecordingContext])

  // AUD3-001: Auto-scroll only when a new message is added, not on filter changes.
  // Tracking messages.length prevents scroll-to-bottom when the user filters messages.
  const prevMessageCountRef = useRef(messages.length)
  useEffect(() => {
    if (messages.length > prevMessageCountRef.current) {
      // New message added - scroll to bottom
      scrollToBottom()
    }
    prevMessageCountRef.current = messages.length
  }, [messages.length])

  // Auto-focus input on mount and when active conversation changes
  useEffect(() => {
    if (!initialLoading && !initError) {
      // Small delay to let the DOM settle after state updates
      const timer = setTimeout(() => inputRef.current?.focus(), 50)
      return () => clearTimeout(timer)
    }
    return undefined
  }, [initialLoading, initError, activeConversation])

  // Clear recording context
  // PESSIMISTIC UPDATE: Server-first approach - only update store on success
  const clearRecordingContext = async () => {
    if (contextRecording && activeConversation) {
      try {
        // Step 1: Remove context on server FIRST
        await window.electronAPI.assistant.removeContext(
          activeConversation.id,
          contextRecording.id
        )

        // Step 2: Update store ONLY on success
        setContextIds(prev => prev.filter(id => id !== contextRecording.id))
        setContextItems(prev => prev.filter(item => item.id !== contextRecording.id))
      } catch (error) {
        console.error('Failed to remove context:', error)
        // B-CHAT-003: Use toast instead of browser alert
        toast.error('Failed to remove context', 'Please try again.')
        // Don't clear UI if server operation failed
        return
      }
    }
    // Clear UI state only after successful server operation (or if no context to remove)
    setContextRecording(null)
    setContextError(null)
  }

  // Load conversations
  const loadConversations = async () => {
    try {
      const history = await window.electronAPI.assistant.getConversations()
      // Sort by most recently updated first
      const sorted = [...history].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      )
      setConversations(sorted)

      // If we have conversations and none active, select the first one
      if (sorted.length > 0 && !activeConversation) {
        handleSelectConversation(sorted[0])
      }
    } catch (error) {
      console.error('Failed to load conversations:', error)
    }
  }

  // B-CHAT-001: Validate conversation exists before setting active
  // B-CHAT-004: Use knowledge:getByIds for efficient context loading
  // AUD3-004: Use generation counter to discard stale async results from rapid switching
  const handleSelectConversation = async (conv: Conversation) => {
    const loadId = ++conversationLoadIdRef.current
    setActiveConversation(conv)
    setMessages([]) // Clear immediately to avoid showing stale messages
    setContextIds([])
    setContextItems([])
    setSources(new Map())

    try {
      const [msgsResult, ctxIds] = await Promise.all([
        window.electronAPI.assistant.getMessages(conv.id),
        window.electronAPI.assistant.getContext(conv.id)
      ])

      // AUD3-004: Discard result if a newer conversation was selected while loading
      if (conversationLoadIdRef.current !== loadId) return

      // B-CHAT-001: Check if getMessages returned an error (invalid conversation)
      if (msgsResult && typeof msgsResult === 'object' && 'error' in msgsResult && !Array.isArray(msgsResult)) {
        toast.error('Conversation not found', 'This conversation may have been deleted.')
        setActiveConversation(null)
        setMessages([])
        setContextIds([])
        setContextItems([])
        // Refresh the conversation list
        const freshConversations = await window.electronAPI.assistant.getConversations()
        setConversations(freshConversations)
        return
      }

      const msgs = Array.isArray(msgsResult) ? msgsResult : []
      setMessages(msgs)
      setContextIds(ctxIds)

      // B-CHAT-004: Use getByIds for efficient context metadata loading
      if (ctxIds.length > 0) {
        const items = await window.electronAPI.knowledge.getByIds(ctxIds)
        // AUD3-004: Discard if stale after second async call
        if (conversationLoadIdRef.current !== loadId) return
        setContextItems(items)
      } else {
        setContextItems([])
      }
    } catch (error) {
      // AUD3-004: Discard error handling if a newer conversation was selected
      if (conversationLoadIdRef.current !== loadId) return
      console.error('Failed to load conversation details:', error)
      toast.error('Failed to load conversation', 'Could not load conversation details.')
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
      toast.error('Failed to create chat', 'Could not create a new conversation.')
    }
  }

  // B-CHAT-003: Open delete confirmation dialog instead of browser confirm
  const handleDeleteClick = (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    setDeleteTargetId(id)
    setDeleteDialogOpen(true)
  }

  // Delete conversation (called from AlertDialog confirmation)
  // PESSIMISTIC UPDATE: Server-first approach - only update store on success
  const handleConfirmDelete = async () => {
    if (!deleteTargetId) return

    const id = deleteTargetId
    setDeleteDialogOpen(false)
    setDeleteTargetId(null)

    try {
      // Step 1: Delete on server FIRST
      await window.electronAPI.assistant.deleteConversation(id)

      // Step 2: Update store ONLY on success
      setConversations(prev => prev.filter(c => c.id !== id))
      if (activeConversation?.id === id) {
        setActiveConversation(null)
        setMessages([])
        setContextIds([])
        setContextItems([])
      }
      toast.success('Conversation deleted')
    } catch (error) {
      console.error('Failed to delete conversation:', error)
      // B-CHAT-003: Use toast instead of browser alert
      toast.error('Failed to delete conversation', 'Please try again.')
    }
  }

  // Context management
  // PESSIMISTIC UPDATE: Server-first approach - only update store on success
  const handleToggleContext = async (id: string) => {
    if (!activeConversation) return

    const isAttached = contextIds.includes(id)
    try {
      if (isAttached) {
        // Step 1: Remove context on server FIRST
        await window.electronAPI.assistant.removeContext(activeConversation.id, id)

        // Step 2: Update store ONLY on success
        setContextIds(prev => prev.filter(ctxId => ctxId !== id))
        setContextItems(prev => prev.filter(item => item.id !== id))
      } else {
        // Step 1: Add context on server FIRST
        await window.electronAPI.assistant.addContext(activeConversation.id, id)

        // Step 2: Fetch metadata BEFORE updating store
        const item = await window.electronAPI.knowledge.getById(id)

        // Step 3: Update store ONLY after both operations succeed
        setContextIds(prev => [...prev, id])
        if (item) setContextItems(prev => [...prev, item])
      }
    } catch (error) {
      console.error('Failed to toggle context:', error)
      // B-CHAT-003: Use toast instead of browser alert
      toast.error(
        `Failed to ${isAttached ? 'remove' : 'add'} context`,
        'Please try again.'
      )
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

  // C-CHAT: Filter messages by search query (memoized for performance)
  const filteredMessages = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return query
      ? messages.filter(msg => msg.content.toLowerCase().includes(query))
      : messages
  }, [searchQuery, messages])

  // C-CHAT: Export conversation to markdown
  const handleExportConversation = useCallback(async () => {
    if (!activeConversation || messages.length === 0) {
      toast.error('No conversation to export')
      return
    }

    const sanitizeFilename = (name: string): string =>
      name.replace(/[/\\:*?"<>|]/g, '_').trim()

    const markdown = [
      `# ${activeConversation.title || 'Untitled Conversation'}`,
      ``,
      `**Date:** ${new Date(activeConversation.createdAt).toLocaleDateString()}`,
      `**Messages:** ${messages.length}`,
      ``,
      `---`,
      ``,
      ...messages.map(msg => {
        const role = msg.role === 'user' ? '**You:**' : '**Assistant:**'
        const timestamp = new Date(msg.createdAt).toLocaleString()
        return `### ${role} _(${timestamp})_\n\n${msg.content}\n`
      })
    ].join('\n')

    const filename = sanitizeFilename(activeConversation.title || 'conversation') + '.md'

    try {
      const result = await window.electronAPI.outputs.saveToFile(markdown, filename)
      if (result.success) {
        toast.success('Conversation exported', result.data)
      } else {
        toast.error('Export failed', result.error || 'Unknown error')
      }
    } catch (error) {
      console.error('Export error:', error)
      toast.error('Export failed', 'Could not save file')
    }
  }, [activeConversation, messages])

  // C-CHAT: Sidebar resize handlers (throttled with RAF for performance)
  const handleMouseDown = useCallback(() => {
    setIsResizing(true)
    isResizingRef.current = true
  }, [])

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizingRef.current) return

    // Throttle with requestAnimationFrame (~60fps)
    if (rafRef.current) return

    rafRef.current = requestAnimationFrame(() => {
      const newWidth = Math.max(
        CHAT_SIDEBAR.MIN_WIDTH,
        Math.min(CHAT_SIDEBAR.MAX_WIDTH, e.clientX)
      )
      setSidebarWidth(newWidth)
      rafRef.current = undefined
    })
  }, [])

  const handleMouseUp = useCallback(() => {
    setIsResizing(false)
    isResizingRef.current = false
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = undefined
    }
  }, [])

  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizing, handleMouseMove, handleMouseUp])

  // Sync ref when state changes
  useEffect(() => {
    isResizingRef.current = isResizing
  }, [isResizing])

  // B-CHAT-005: Cancel in-flight RAG request
  const handleCancelRequest = useCallback(async () => {
    if (!activeConversation) return
    try {
      await window.electronAPI.rag.cancel(activeConversation.id)
      setLoading(false)
      setIsProcessing(false)
      toast.info('Request cancelled')
    } catch (error) {
      console.error('Failed to cancel request:', error)
    }
  }, [activeConversation])

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()

    // Race condition protection: prevent concurrent submissions
    if (isProcessing) return

    // Empty message validation
    if (!input.trim()) return

    setIsProcessing(true)
    setLoading(true)

    try {
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

      // Start processing message
      // Add user message
      const userMsg = await window.electronAPI.assistant.addMessage(currentConv!.id, 'user', userMessageContent)
      setMessages((prev) => [...prev, userMsg])

      // Use the RAG service for response
      // Pre-process context for RAG if needed, or pass conversationId
      const response = await window.electronAPI.rag.chatLegacy(currentConv!.id, userMessageContent)

      if (response.error) {
        const errorMsg = await window.electronAPI.assistant.addMessage(currentConv!.id, 'assistant', response.error)
        setMessages((prev) => [...prev, errorMsg])
        setFailedMessageIds(prev => new Set(prev).add(errorMsg.id))
      } else {
        // Add assistant response
        const assistantMsg = await window.electronAPI.assistant.addMessage(
          currentConv!.id,
          'assistant',
          response.answer,
          JSON.stringify(response.sources || [])
        )
        setMessages((prev) => [...prev, assistantMsg])

        // Store sources for assistant message only
        if (response.sources && response.sources.length > 0) {
          setSources((prev) => new Map(prev).set(assistantMsg.id, response.sources))
        }
      }

      // Auto-generate title if the conversation still has the default name
      if (currentConv!.title === 'New Chat' || currentConv!.title === 'New Conversation') {
        const autoTitle = userMessageContent.slice(0, 40) + (userMessageContent.length > 40 ? '...' : '')
        try {
          await window.electronAPI.assistant.updateConversationTitle(currentConv!.id, autoTitle)
          setActiveConversation(prev => prev ? { ...prev, title: autoTitle } : prev)
          setConversations(prev => prev.map(c =>
            c.id === currentConv!.id ? { ...c, title: autoTitle } : c
          ))
        } catch {
          // Title update is best-effort; don't block the chat flow
        }
      }

      // Update updated_at in UI
      setConversations(prev => prev.map(c =>
        c.id === currentConv!.id ? { ...c, updatedAt: new Date().toISOString() } : c
      ).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()))

    } catch (error) {
      console.error('Chat error:', error)
      // Use activeConversation since currentConv may be out of scope
      if (activeConversation) {
        const errorMsg = await window.electronAPI.assistant.addMessage(
          activeConversation.id,
          'assistant',
          'Sorry, I encountered an error processing your request. Please make sure Ollama is running and try again.'
        )
        setMessages((prev) => [...prev, errorMsg])
        setFailedMessageIds(prev => new Set(prev).add(errorMsg.id))
      }
    } finally {
      setLoading(false)
      setIsProcessing(false)
    }
  }, [input, isProcessing, activeConversation])

  // Retry a failed message: find the preceding user message and re-submit it
  const handleRetry = useCallback(async (failedMsgId: string) => {
    if (isProcessing || !activeConversation) return

    // Find the failed message index and the preceding user message
    const failedIdx = messages.findIndex(m => m.id === failedMsgId)
    if (failedIdx < 0) return

    // Look backwards for the user message that triggered this error
    let userMessage: Message | null = null
    for (let i = failedIdx - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        userMessage = messages[i]
        break
      }
    }

    if (!userMessage) {
      toast.error('Cannot retry', 'Could not find the original message to retry.')
      return
    }

    // Remove the failed assistant message from UI
    setMessages(prev => prev.filter(m => m.id !== failedMsgId))
    setFailedMessageIds(prev => {
      const next = new Set(prev)
      next.delete(failedMsgId)
      return next
    })

    // Trim stale user message + partial assistant response from RAG session history
    // so the retry doesn't send duplicate/error context to the LLM
    try {
      await window.electronAPI.rag.removeLastMessages(activeConversation.id, 2)
    } catch {
      // If trim fails, fall back to clearing the whole session
      await window.electronAPI.rag.clearSession(activeConversation.id)
    }

    // Re-submit the user's original message
    setIsProcessing(true)
    setLoading(true)

    try {
      const response = await window.electronAPI.rag.chatLegacy(
        activeConversation.id,
        userMessage.content
      )

      if (response.error) {
        const errorMsg = await window.electronAPI.assistant.addMessage(
          activeConversation.id, 'assistant', response.error
        )
        setMessages(prev => [...prev, errorMsg])
        setFailedMessageIds(prev => new Set(prev).add(errorMsg.id))
      } else {
        const assistantMsg = await window.electronAPI.assistant.addMessage(
          activeConversation.id, 'assistant', response.answer,
          JSON.stringify(response.sources || [])
        )
        setMessages(prev => [...prev, assistantMsg])

        if (response.sources && response.sources.length > 0) {
          setSources(prev => new Map(prev).set(assistantMsg.id, response.sources))
        }
      }
    } catch (error) {
      console.error('Retry error:', error)
      const errorMsg = await window.electronAPI.assistant.addMessage(
        activeConversation.id, 'assistant',
        'Retry failed. Please check your connection and try again.'
      )
      setMessages(prev => [...prev, errorMsg])
      setFailedMessageIds(prev => new Set(prev).add(errorMsg.id))
    } finally {
      setLoading(false)
      setIsProcessing(false)
    }
  }, [isProcessing, activeConversation, messages])

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
      {/* B-CHAT-003: Radix AlertDialog for delete confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Conversation</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this conversation? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Sidebar - Conversations History (C-CHAT: Resizable) */}
      <aside
        className="border-r flex flex-col bg-muted/10 relative"
        style={{ width: `${sidebarWidth}px` }}
      >
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
                  <div className="flex flex-col gap-0.5 overflow-hidden flex-1">
                    <div className="flex items-center gap-2 overflow-hidden">
                      <MessageSquare className={cn("h-4 w-4 flex-shrink-0", activeConversation?.id === conv.id ? "text-primary-foreground" : "text-muted-foreground")} />
                      <span className="truncate">{conv.title || 'Untitled'}</span>
                    </div>
                    <span className={cn(
                      "text-[10px] pl-6",
                      activeConversation?.id === conv.id ? "text-primary-foreground/60" : "text-muted-foreground/60"
                    )}>
                      {getRelativeTime(conv.updatedAt)}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                      "h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0",
                      activeConversation?.id === conv.id ? "text-primary-foreground hover:bg-primary-foreground/20" : "hover:text-destructive"
                    )}
                    onClick={(e) => handleDeleteClick(e, conv.id)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* C-CHAT: Resize handle */}
        <div
          className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/50 active:bg-primary"
          onMouseDown={handleMouseDown}
        >
          <div className="absolute right-0 top-1/2 -translate-y-1/2 -translate-x-1/2">
            <GripVertical className="h-4 w-4 text-muted-foreground" />
          </div>
        </div>
      </aside>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="flex items-center justify-between border-b px-6 py-4 h-[85px]">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold">Knowledge Assistant</h1>
            <p className="text-sm text-muted-foreground truncate">
              {activeConversation ? activeConversation.title : 'Knowledge-powered AI conversations'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* C-CHAT: Search within conversation */}
            {activeConversation && messages.length > 0 && (
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="Search messages..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8 w-48"
                />
              </div>
            )}

            {/* C-CHAT: Export conversation */}
            {activeConversation && messages.length > 0 && (
              <Button
                variant="outline"
                size="icon"
                onClick={handleExportConversation}
                title="Export conversation"
              >
                <Download className="h-4 w-4" />
              </Button>
            )}
          </div>
          <div className="flex items-center gap-4">
            {status && (
              <div className="flex items-center gap-2 text-xs">
                {status.ready ? (
                  <div className="hidden sm:flex items-center gap-1.5 text-green-600 dark:text-green-400 bg-green-500/10 px-2 py-1 rounded-full border border-green-500/20">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span>{status.documentCount} chunks indexed</span>
                  </div>
                ) : !status.ollamaAvailable ? (
                  <div className="hidden sm:flex items-center gap-1.5 text-yellow-600 dark:text-yellow-400 bg-yellow-500/10 px-2 py-1 rounded-full border border-yellow-500/20">
                    <AlertCircle className="h-3.5 w-3.5" />
                    <span>Ollama offline</span>
                  </div>
                ) : (
                  <div className="hidden sm:flex items-center gap-1.5 text-yellow-600 dark:text-yellow-400 bg-yellow-500/10 px-2 py-1 rounded-full border border-yellow-500/20">
                    <Database className="h-3.5 w-3.5" />
                    <span>Empty knowledge base</span>
                  </div>
                )}
              </div>
            )}

            {/* Context Picker */}
            <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2 h-8" disabled={!activeConversation} title="Add Context">
                  <Layers className="h-4 w-4" />
                  <span className="hidden md:inline">Context</span>
                  {contextIds.length > 0 && (
                    <span className="bg-primary text-primary-foreground rounded-full w-4 h-4 flex items-center justify-center text-[10px]">
                      {contextIds.length}
                    </span>
                  )}
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                  <DialogTitle>Select Knowledge Context</DialogTitle>
                </DialogHeader>
                <ContextPicker
                  onSelect={handleToggleContext}
                  selectedIds={contextIds}
                />
              </DialogContent>
            </Dialog>

            <Button
              variant={showChunks ? 'secondary' : 'outline'}
              size="sm"
              onClick={toggleChunksView}
              className="h-8 gap-2"
            >
              <FileText className="h-4 w-4" />
              <span className="hidden md:inline">Chunks</span>
            </Button>
          </div>
        </header>

        {/* Recording Context Loading */}
        {contextLoading && (
          <div className="px-4 py-2 bg-muted/30 border-b flex items-center gap-2">
            <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Loading recording context...</span>
          </div>
        )}

        {/* Recording Context Banner */}
        {contextRecording && !contextLoading && (
          <div className="px-4 py-2 bg-primary/10 border-b flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileAudio className="h-4 w-4 text-primary" />
              <span className="text-sm">
                Chatting about: <strong>{contextRecording.title || 'Recording'}</strong>
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate('/library', { state: { selectedId: contextRecording.id } })}
              >
                View Recording
              </Button>
              <Button variant="ghost" size="sm" onClick={clearRecordingContext}>
                Clear context
              </Button>
            </div>
          </div>
        )}

        {/* Context Error Banner */}
        {contextError && (
          <div className="px-4 py-2 bg-destructive/10 border-b flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-destructive" />
              <span className="text-sm text-destructive">{contextError}</span>
            </div>
            <Button variant="ghost" size="sm" onClick={() => navigate('/library')}>
              Return to Library
            </Button>
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

        {/* Attached Context Bar */}
        {contextItems.length > 0 && (
          <div className="bg-muted/30 border-b px-6 py-2 flex flex-wrap gap-2 items-center">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mr-1">Context:</span>
            {contextItems.map(item => (
              <div key={item.id} className="flex items-center gap-1.5 bg-background border rounded-full pl-2 pr-1 py-0.5 text-[10px] shadow-sm animate-in fade-in zoom-in duration-200">
                <BookOpen className="h-3 w-3 text-primary" />
                <span className="max-w-[150px] truncate">{item.title}</span>
                <button
                  onClick={() => handleToggleContext(item.id)}
                  className="hover:bg-muted rounded-full p-0.5 transition-colors"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
            <button
              onClick={async () => {
                if (activeConversation) {
                  try {
                    await Promise.all(
                      contextIds.map(id =>
                        window.electronAPI.assistant.removeContext(activeConversation.id, id)
                      )
                    )
                    // ONLY clear state after successful API calls
                    setContextIds([])
                    setContextItems([])
                  } catch (error) {
                    console.error('Failed to clear all context:', error)
                    // B-CHAT-003: Use toast instead of browser alert
                    toast.error('Failed to clear all context', 'Please try again.')
                  }
                }
              }}
              className="text-[10px] text-muted-foreground hover:text-foreground underline underline-offset-2 ml-auto"
            >
              Clear all
            </button>
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
              filteredMessages.map((message) => {
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
                            : 'bg-background border-border rounded-tl-none',
                          failedMessageIds.has(message.id) && 'border-destructive/50 bg-destructive/5'
                        )}
                      >
                        {message.role === 'assistant' ? (
                          <div className="prose prose-sm max-w-none dark:prose-invert leading-relaxed text-sm md:text-base">
                            <ReactMarkdown>{message.content}</ReactMarkdown>
                          </div>
                        ) : (
                          <p className="whitespace-pre-wrap leading-relaxed text-sm md:text-base">{message.content}</p>
                        )}
                        <p
                          className={cn(
                            'text-[10px] mt-3 opacity-50',
                            message.role === 'user' ? 'text-primary-foreground' : 'text-muted-foreground'
                          )}
                          title={new Date(message.createdAt).toLocaleString()}
                        >
                          {getRelativeTime(message.createdAt)}
                        </p>
                      </div>

                      {/* Retry button for failed messages */}
                      {failedMessageIds.has(message.id) && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleRetry(message.id)}
                          disabled={isProcessing}
                          className="h-7 gap-1.5 text-xs text-destructive hover:text-destructive border-destructive/30"
                        >
                          <RotateCcw className="h-3 w-3" />
                          Retry
                        </Button>
                      )}

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
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })
            )}
            {/* B-CHAT-005: Loading indicator with cancel button */}
            {loading && (
              <div className="flex gap-4">
                <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-background border border-border flex items-center justify-center shadow-sm">
                  <Bot className="h-5 w-5" />
                </div>
                <div className="flex items-center gap-3">
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
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleCancelRequest}
                    className="h-8 gap-1.5 text-muted-foreground hover:text-foreground"
                    title="Cancel request"
                  >
                    <Square className="h-3.5 w-3.5" />
                    <span className="text-xs">Cancel</span>
                  </Button>
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
                ref={inputRef}
                placeholder={
                  status?.ready
                    ? 'Ask me anything about your knowledge base...'
                    : 'Index meetings to enable AI conversations'
                }
                value={input}
                onChange={(e) => {
                  if (e.target.value.length <= MAX_INPUT_LENGTH) {
                    setInput(e.target.value)
                  }
                }}
                maxLength={MAX_INPUT_LENGTH}
                disabled={isProcessing}
                className="pr-12 py-6 rounded-2xl shadow-sm border-border bg-background focus-visible:ring-primary/20"
              />
              <Button
                type="submit"
                disabled={isProcessing || !input.trim()}
                size="icon"
                className="absolute right-2 h-10 w-10 rounded-xl"
              >
                <Send className="h-5 w-5" />
              </Button>
            </div>
            <div className="flex items-center justify-between mt-3 px-1">
              <p className="text-[10px] text-muted-foreground">
                I answer based on your meeting transcripts and documents.
              </p>
              <p className={cn(
                'text-[10px] tabular-nums',
                input.length > MAX_INPUT_LENGTH * 0.9
                  ? 'text-destructive'
                  : 'text-muted-foreground'
              )}>
                {input.length}/{MAX_INPUT_LENGTH}
              </p>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

export default Chat
