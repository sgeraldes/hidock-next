/**
 * RAG (Retrieval Augmented Generation) Service
 * Combines vector search with LLM to answer questions about meetings
 */

import { getVectorStore, SearchResult } from './vector-store'
import { getOllamaService, OllamaChatMessage } from './ollama'
import { getChatLLMService } from './chat-llm'
import { getEmbeddingsService } from './embeddings'
import { getDatabase, queryOne, queryAll, escapeLikePattern } from './database'
import { stripDiacritics } from './entity-normalize'
import type { BrainId } from './brains/types'
import { Result, success, error } from '../types/api'

interface ChatContext {
  meetingId?: string
  conversationHistory: OllamaChatMessage[]
}

interface RAGResponse {
  answer: string
  sources: Array<{
    content: string
    meetingId?: string
    subject?: string
    timestamp?: string
    score: number
    /** 'image' for a screenshot capture chunk; absent for meeting transcripts. */
    sourceType?: string
    /** knowledge_capture id backing a non-meeting source, for renderer linking. */
    captureId?: string
  }>
  error?: string
}

const SYSTEM_PROMPT = `You are a helpful meeting assistant that answers questions based on meeting transcripts.

Your capabilities:
- Summarize discussions and decisions from meetings
- Find action items and follow-ups mentioned in meetings
- Identify key topics and themes across meetings
- Answer specific questions about what was discussed

Guidelines:
- Only answer based on the meeting transcripts provided as context
- If the context doesn't contain relevant information, say so honestly
- Be concise but thorough
- Reference specific meetings when relevant
- If asked about something not in the transcripts, acknowledge the limitation

Context from meeting transcripts will be provided with each question.`

// B-CHAT-006: Token estimation and history trimming utilities
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export function trimHistoryByTokens(
  history: OllamaChatMessage[],
  maxTokens: number = 4096
): OllamaChatMessage[] {
  let totalTokens = 0
  const trimmed: OllamaChatMessage[] = []

  // Walk backwards through history, keeping most recent messages first
  for (let i = history.length - 1; i >= 0; i--) {
    const msgTokens = estimateTokens(history[i].content)
    if (totalTokens + msgTokens > maxTokens) break
    totalTokens += msgTokens
    trimmed.unshift(history[i])
  }

  return trimmed
}

// ---------------------------------------------------------------------------
// F4: Context-graph grounding
// ---------------------------------------------------------------------------

/**
 * Per-brain graph-fact token budget. Large-context cloud brains can absorb more
 * neighborhood facts; small local models are easily flooded, so they get fewer.
 * Expressed in the same estimated tokens as {@link trimHistoryByTokens} so graph
 * facts are trimmed within the overall token budget for the turn.
 */
const GRAPH_FACT_TOKEN_BUDGET: Partial<Record<BrainId, number>> = {
  'gemini-api': 1500,
  'gemini-cli': 1500,
  'claude-code': 1500,
  codex: 1000,
  kiro: 1000,
  ollama: 500,
}
const DEFAULT_GRAPH_FACT_TOKEN_BUDGET = 1000

/**
 * The graph-fact token budget for the brain that will actually serve this chat.
 * Source of truth: BrainRouter.resolvePrimaryChatBrainId('chat') — the router's
 * OWN primary-selection logic, so the budget always keys off the brain that
 * really answers (taskRouting.chat → defaultBrain → capability chain), never a
 * diverging config read. The helper is ASYNC — it must be awaited, or the key
 * would be a Promise and every call would silently get the default budget.
 * Lazy + defensive: the brains module pulls in electron, so any failure
 * degrades to the default budget.
 */
async function graphFactTokenBudget(): Promise<number> {
  try {
    const { getBrainRouter } = await import('./brains')
    const id: BrainId = await getBrainRouter().resolvePrimaryChatBrainId('chat')
    if (id) return GRAPH_FACT_TOKEN_BUDGET[id] ?? DEFAULT_GRAPH_FACT_TOKEN_BUDGET
  } catch {
    /* router unavailable — degrade to the default budget */
  }
  return DEFAULT_GRAPH_FACT_TOKEN_BUDGET
}

/**
 * Exact tokenized key: NFC-normalize, lowercase, and reduce every
 * non-letter/number run to a single space — diacritics are KEPT ('peña' stays
 * 'peña'). Matching on these keys is whole-token by construction — "ana" can
 * never match inside "banana", and punctuation adjacent to a name ("ping
 * Yara,") does not break the match.
 */
function tokenizedExactKey(text: string): string {
  return (text || '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Hard cap on the n-gram window, whatever the longest indexed label is. */
const MAX_ENTITY_TOKENS_CAP = 8
/** Minimum key length considered an entity mention (guards "Al"/"Jo"). */
const MIN_ENTITY_KEY = 3

/** A candidate mention: the accent-folded lookup key + the exact spelling. */
interface CandidateGram {
  folded: string
  exact: string
}

/**
 * Candidate entity keys in a message: every 1..maxTokens-token n-gram of the
 * tokenized message, carried in BOTH forms — accent-folded (the index lookup
 * key) and exact (to disambiguate fold collisions like Peña vs Pena). Bounded
 * by the message length (not by the size of the graph/alias corpus), so entity
 * detection is O(message) lookups.
 */
function candidateNgrams(message: string, maxTokens: number): CandidateGram[] {
  const tokens = tokenizedExactKey(message).split(' ').filter(Boolean)
  const seen = new Set<string>()
  const grams: CandidateGram[] = []
  for (let i = 0; i < tokens.length; i++) {
    let exact = ''
    for (let n = 0; n < maxTokens && i + n < tokens.length; n++) {
      exact = exact ? `${exact} ${tokens[i + n]}` : tokens[i + n]
      if (exact.length < MIN_ENTITY_KEY) continue
      if (seen.has(exact)) continue
      seen.add(exact)
      grams.push({ folded: stripDiacritics(exact), exact })
    }
  }
  return grams
}

/**
 * Index entries under one accent-folded key, grouped by EXACT spelling — so a
 * fold collision (Peña and Pena are different people but share the folded key
 * 'pena') is visible at match time instead of silently injecting both.
 */
interface EntityIndexEntry {
  exact: string
  ids: string[]
}

/**
 * Prebuilt lookup index for entity detection: accent-folded person/project node
 * labels → node ids and (non-rejected) contact-alias spellings → contact ids,
 * grouped by exact spelling under each folded key. Built once and cached — NOT
 * rebuilt per message — so each chat turn costs O(message n-grams) map lookups
 * instead of an O(nodes + aliases) scan on the main process. `maxLabelTokens`
 * is the longest indexed name in tokens (capped) — the n-gram window is derived
 * from it, so a 6-token project name is still matchable.
 */
interface EntityDetectionIndex {
  builtAt: number
  labelToNodes: Map<string, EntityIndexEntry[]>
  aliasToContacts: Map<string, EntityIndexEntry[]>
  maxLabelTokens: number
}

let entityIndex: EntityDetectionIndex | null = null
let entityIndexInvalidationWired = false
/** TTL safety net: covers mutations that arrive without a wired domain event. */
const ENTITY_INDEX_TTL_MS = 30_000

/** Test/maintenance hook: drop the cached entity-detection index. */
export function resetEntityDetectionIndex(): void {
  entityIndex = null
}

/**
 * Invalidate the cached index when entities change:
 *  - entity:contact-changed — contact renames/merges (graph-sync's node surgery
 *    on this event is synchronous, so a rebuild after it sees the new graph);
 *  - graph:ingested — emitted by graph-sync AFTER a debounced transcript ingest
 *    COMMITS. (Deliberately NOT entity:transcript-ready: that fires ~60s BEFORE
 *    the graph actually changes, so invalidating on it re-caches the old graph.)
 * Best-effort and lazy (event-bus pulls in electron); the TTL above covers
 * anything unwired.
 */
function wireEntityIndexInvalidation(): void {
  if (entityIndexInvalidationWired) return
  entityIndexInvalidationWired = true
  import('./event-bus')
    .then(({ getEventBus }) => {
      const bus = getEventBus()
      for (const type of ['entity:contact-changed', 'graph:ingested']) {
        bus.onDomainEvent(type, () => {
          entityIndex = null
        })
      }
    })
    .catch(() => {
      /* TTL fallback covers invalidation */
    })
}

/** Add one spelling→ids mapping to a folded-key bucket, grouped by exact form. */
function addIndexEntry(map: Map<string, EntityIndexEntry[]>, exact: string, id: string): void {
  const folded = stripDiacritics(exact)
  const entries = map.get(folded)
  if (!entries) {
    map.set(folded, [{ exact, ids: [id] }])
    return
  }
  const entry = entries.find((e) => e.exact === exact)
  if (entry) entry.ids.push(id)
  else entries.push({ exact, ids: [id] })
}

function getEntityDetectionIndex(
  kg: typeof import('./knowledge-graph-service')
): EntityDetectionIndex {
  wireEntityIndexInvalidation()
  if (entityIndex && Date.now() - entityIndex.builtAt < ENTITY_INDEX_TTL_MS) {
    return entityIndex
  }

  let maxLabelTokens = 1
  const trackTokens = (exact: string): void => {
    const count = exact.split(' ').length
    if (count > maxLabelTokens) maxLabelTokens = Math.min(count, MAX_ENTITY_TOKENS_CAP)
  }

  const labelToNodes = new Map<string, EntityIndexEntry[]>()
  try {
    for (const n of [...kg.queryListNodes('person'), ...kg.queryListNodes('project')]) {
      const exact = tokenizedExactKey(n.label || '')
      if (exact.length < MIN_ENTITY_KEY) continue
      addIndexEntry(labelToNodes, exact, n.id)
      trackTokens(exact)
    }
  } catch (e) {
    console.warn('[RAG] graph label index skipped:', e)
  }

  const aliasToContacts = new Map<string, EntityIndexEntry[]>()
  try {
    const aliases = queryAll<{ alias: string; contact_id: string; source: string | null }>(
      'SELECT alias, contact_id, source FROM contact_aliases'
    )
    for (const a of aliases) {
      if (a.source === 'rejected') continue
      const exact = tokenizedExactKey(a.alias || '')
      if (exact.length < MIN_ENTITY_KEY) continue
      addIndexEntry(aliasToContacts, exact, a.contact_id)
      trackTokens(exact)
    }
  } catch (e) {
    console.warn('[RAG] alias index skipped:', e)
  }

  entityIndex = { builtAt: Date.now(), labelToNodes, aliasToContacts, maxLabelTokens }
  return entityIndex
}

/**
 * Resolve one folded-key bucket against the mention's exact spelling. A single
 * spelling in the bucket → that entry (this IS the accent-fold tier: "Yaravi"
 * finds "Yaraví"). Multiple distinct spellings (fold collision — Peña vs Pena
 * are different people) → prefer the entry whose exact spelling matches the
 * message; with no exact match the mention is AMBIGUOUS and nothing is injected
 * (never silently both).
 */
function pickEntryIds(entries: EntityIndexEntry[] | undefined, exactGram: string): string[] {
  if (!entries || entries.length === 0) return []
  if (entries.length === 1) return entries[0].ids
  const exactHit = entries.find((e) => e.exact === exactGram)
  return exactHit ? exactHit.ids : []
}

/**
 * Graph node ids named in `message` under the entity-resolver's normalization
 * tiers (NO LLM call):
 *   • accent/diacritic-folded person/project node labels (question "Yaravi" → node "Yaraví")
 *   • accent-folded known contact-alias spellings → that contact's graph node
 * Matching is whole-token n-gram lookup against the cached index — bounded by
 * the message, not the corpus — with fold-collision ambiguity resolved by exact
 * spelling (see {@link pickEntryIds}). Dedup is handled by the caller. Fully
 * defensive: any store/DB failure yields [].
 */
function detectNormalizedEntities(
  message: string,
  kg: typeof import('./knowledge-graph-service')
): string[] {
  const ids: string[] = []
  const index = getEntityDetectionIndex(kg)
  const grams = candidateNgrams(message, index.maxLabelTokens)

  for (const gram of grams) {
    ids.push(...pickEntryIds(index.labelToNodes.get(gram.folded), gram.exact))

    for (const contactId of pickEntryIds(index.aliasToContacts.get(gram.folded), gram.exact)) {
      try {
        const nodeId = kg.resolveEntityToNodeId(contactId)
        if (nodeId) ids.push(nodeId)
      } catch (e) {
        console.warn('[RAG] alias contact→node resolve skipped:', e)
      }
    }
  }
  return ids
}

/**
 * F4 — Context-graph grounding for the assistant.
 *
 * Collects compact neighborhood facts for the entities a question is about so the
 * LLM walks graph edges, not just vector chunks. Beyond the original literal
 * substring match it adds two entity-resolver-style tiers (accent-fold + alias,
 * see {@link detectNormalizedEntities}) and, when the chat is scoped to a meeting,
 * that meeting's own neighborhood. Facts are trimmed to a per-brain token budget so
 * a small local model isn't flooded (see {@link graphFactTokenBudget}).
 *
 * Fully lazy/defensive: the knowledge-graph service pulls in the ingest/LLM stack,
 * so it is imported here and every failure degrades to "no graph facts".
 */
export async function buildGraphContext(
  message: string,
  meetingFilter?: string
): Promise<string[]> {
  const parts: string[] = []
  try {
    const kg = await import('./knowledge-graph-service')
    const budget = await graphFactTokenBudget()
    const seenEntities = new Set<string>()
    let usedTokens = 0

    // ARF-2 / P1 — compute the exclusion context ONCE per query and thread it
    // through every neighborhoodFacts call. Facts sourced solely from
    // soft-deleted / personal / value-excluded recordings never ground the
    // assistant; and if the exclusion lookup FAILED (exclusion.failClosed), the
    // context suppresses ALL recording-attributed facts (fail closed) rather
    // than leaking them on a transient DB error.
    const exclusion = kg.getGroundingExclusionSet()

    const addFacts = (entityId: string | null | undefined, hops = 1): void => {
      if (!entityId || seenEntities.has(entityId)) return
      seenEntities.add(entityId)
      const facts = kg.neighborhoodFacts(entityId, hops, 20, exclusion)
      if (!facts) return
      const cost = estimateTokens(facts)
      if (usedTokens + cost > budget) return // per-brain graph budget spent
      usedTokens += cost
      parts.push(facts)
    }

    // Tier 1 — literal mention (original behaviour).
    const literal = kg.findMentionedEntity(message)
    if (literal) addFacts(literal.id)

    // Tier 2 — accent/alias-aware detection (resolver normalization tiers).
    for (const id of detectNormalizedEntities(message, kg)) addFacts(id)

    // Tier 3 — meeting in scope → resolve the app meeting id to its GRAPH NODE
    // id first (the graph is keyed by node ids; the meeting id lives in node
    // props), then inject that node's neighborhood. Resolving here also keeps
    // the dedup set in one id space (node ids). Skip cleanly when the meeting
    // has no graph node yet.
    if (meetingFilter) {
      try {
        addFacts(kg.resolveEntityToNodeId(meetingFilter))
      } catch (e) {
        console.warn('[RAG] meeting graph grounding skipped:', e)
      }
    }
  } catch (e) {
    console.warn('[RAG] Context Graph grounding skipped:', e)
  }
  return parts
}

// B-CHAT-002: LRU session cache with max size eviction
const MAX_SESSIONS = 50

class LRUSessionCache {
  private cache: Map<string, ChatContext> = new Map()
  private accessOrder: string[] = [] // Most recently accessed at end

  get(sessionId: string): ChatContext | undefined {
    const context = this.cache.get(sessionId)
    if (context) {
      // Move to end (most recently used)
      this.accessOrder = this.accessOrder.filter(id => id !== sessionId)
      this.accessOrder.push(sessionId)
    }
    return context
  }

  set(sessionId: string, context: ChatContext): void {
    // If already exists, just update
    if (this.cache.has(sessionId)) {
      this.cache.set(sessionId, context)
      this.accessOrder = this.accessOrder.filter(id => id !== sessionId)
      this.accessOrder.push(sessionId)
      return
    }

    // Evict LRU entries if at capacity
    while (this.cache.size >= MAX_SESSIONS && this.accessOrder.length > 0) {
      const lruKey = this.accessOrder.shift()!
      this.cache.delete(lruKey)
      console.log(`[RAG] LRU evicted session: ${lruKey}`)
    }

    this.cache.set(sessionId, context)
    this.accessOrder.push(sessionId)
  }

  delete(sessionId: string): boolean {
    this.accessOrder = this.accessOrder.filter(id => id !== sessionId)
    return this.cache.delete(sessionId)
  }

  get size(): number {
    return this.cache.size
  }
}

class RAGService {
  private contexts: LRUSessionCache = new LRUSessionCache()
  // B-CHAT-005: Active AbortControllers for cancellable requests
  private activeControllers: Map<string, AbortController> = new Map()

  async isReady(): Promise<{ ready: boolean; reason?: string }> {
    const vectorStore = getVectorStore()

    const chatStatus = await getChatLLMService().getStatus()
    if (chatStatus.backend === 'none') {
      return {
        ready: false,
        reason: 'No chat backend available. Add a Gemini API key in Settings or start Ollama.'
      }
    }

    const docCount = vectorStore.getDocumentCount()
    if (docCount === 0) {
      return {
        ready: false,
        reason: 'No meeting transcripts indexed yet. Record some meetings first.'
      }
    }

    return { ready: true }
  }

  async initialize(): Promise<boolean> {
    const ollama = getOllamaService()
    const vectorStore = getVectorStore()

    // Check if Ollama is available
    const available = await ollama.isAvailable()
    if (!available) {
      console.log('Ollama not available, RAG service will be limited')
      return false
    }

    // Ensure required models are available
    const models = await ollama.ensureModels()
    if (!models.embedding || !models.chat) {
      console.log('Required Ollama models not available')
      return false
    }

    // Initialize vector store
    await vectorStore.initialize()

    console.log('RAG service initialized')
    return true
  }

  async chat(
    sessionId: string,
    message: string,
    meetingFilter?: string
  ): Promise<RAGResponse> {
    const vectorStore = getVectorStore()

    // Validate that sessionId corresponds to a valid conversation
    try {
      const conversation = queryOne<any>('SELECT id FROM conversations WHERE id = ?', [sessionId])
      if (!conversation) {
        console.error(`RAG chat: Invalid conversation ID ${sessionId}`)
        return {
          answer: '',
          sources: [],
          error: 'Invalid conversation ID. Please create a new conversation.'
        }
      }
    } catch (error) {
      console.error('RAG chat: Failed to validate conversation:', error)
      return {
        answer: '',
        sources: [],
        error: 'Failed to validate conversation. Please try again.'
      }
    }

    // B-CHAT-005: Create AbortController for this request
    // Cancel any existing in-flight request for this session
    const existingController = this.activeControllers.get(sessionId)
    if (existingController) {
      existingController.abort()
    }
    const controller = new AbortController()
    this.activeControllers.set(sessionId, controller)

    // Get or create session context (LRU cache)
    let context = this.contexts.get(sessionId)
    if (!context) {
      context = { conversationHistory: [] }
      this.contexts.set(sessionId, context)
    }

    // Apply meeting filter if specified
    if (meetingFilter) {
      context.meetingId = meetingFilter
    }

    // Search for relevant context
    let searchResults: SearchResult[]
    if (context.meetingId) {
      // Search within specific meeting
      const docs = await vectorStore.searchByMeeting(context.meetingId)
      const queryEmbedding = await getEmbeddingsService().generateEmbedding(message)
      if (queryEmbedding) {
        // Re-rank by actual query relevance using cosine similarity
        searchResults = docs.map((doc) => {
          let score = 0.5 // Default if embedding comparison fails
          if (doc.embedding && doc.embedding.length === queryEmbedding.length) {
            let dotProduct = 0, normA = 0, normB = 0
            for (let i = 0; i < queryEmbedding.length; i++) {
              dotProduct += queryEmbedding[i] * doc.embedding[i]
              normA += queryEmbedding[i] * queryEmbedding[i]
              normB += doc.embedding[i] * doc.embedding[i]
            }
            const denominator = Math.sqrt(normA) * Math.sqrt(normB)
            score = denominator === 0 ? 0 : dotProduct / denominator
          }
          return { document: doc, score }
        })
        // Sort by actual relevance
        searchResults.sort((a, b) => b.score - a.score)
      } else {
        searchResults = docs.map((doc) => ({ document: doc, score: 0.5 }))
      }
      searchResults = searchResults.slice(0, 5)
    } else {
      // Global search
      searchResults = await vectorStore.search(message, 5)
    }

    // --- Added: Fetch explicit conversation context ---
    const pinnedContextParts: string[] = []
    try {
      const db = getDatabase()
      if (db) {
        // Get knowledge captures attached to this conversation
        const contextRes = db.exec('SELECT knowledge_capture_id FROM conversation_context WHERE conversation_id = ?', [sessionId])
        if (contextRes && contextRes.length > 0 && contextRes[0].values && contextRes[0].values.length > 0) {
          const kcIds = contextRes[0].values.map(v => v[0] as string)
          for (const id of kcIds) {
            // Fetch the full transcript for each pinned knowledge capture
            const transcriptRes = db.exec(`
              SELECT t.full_text, k.title 
              FROM transcripts t
              JOIN knowledge_captures k ON k.source_recording_id = t.recording_id
              WHERE k.id = ?
            `, [id])
            
            if (transcriptRes && transcriptRes.length > 0 && transcriptRes[0].values && transcriptRes[0].values.length > 0) {
              const [text, title] = transcriptRes[0].values[0] as [string, string]
              pinnedContextParts.push(`[PINNED CONTEXT: ${title}]\n${text}`)
            }
          }
        }
      }
    } catch (error) {
      console.error('Failed to fetch pinned context:', error)
    }
    // ------------------------------------------------

    // Build context from search results
    const contextParts: string[] = []
    const sources: RAGResponse['sources'] = []

    for (const result of searchResults) {
      if (result.score < 0.3) continue // Skip low-relevance results

      const { document: doc, score } = result

      const dateInfo = doc.metadata.timestamp
        ? ` (${new Date(doc.metadata.timestamp).toLocaleDateString()})`
        : ''

      // F5 (PixelRAG): an image capture surfaces as a Screenshot excerpt (its
      // description is the chunk's subject) and carries the capture id so the
      // renderer can cite/link the source image. Everything else stays a meeting.
      if (doc.metadata.sourceType === 'image') {
        const desc = doc.metadata.subject || 'Screenshot'
        contextParts.push(`[Screenshot: ${desc}${dateInfo}]\n${doc.content}`)
        sources.push({
          content: doc.content.substring(0, 200) + (doc.content.length > 200 ? '...' : ''),
          subject: doc.metadata.subject,
          timestamp: doc.metadata.timestamp,
          score,
          sourceType: 'image',
          captureId: doc.metadata.captureId
        })
        continue
      }

      const meetingInfo = doc.metadata.subject
        ? `Meeting: ${doc.metadata.subject}`
        : doc.metadata.meetingId
          ? `Meeting ID: ${doc.metadata.meetingId}`
          : 'Unknown meeting'

      contextParts.push(`[${meetingInfo}${dateInfo}]\n${doc.content}`)
      sources.push({
        content: doc.content.substring(0, 200) + (doc.content.length > 200 ? '...' : ''),
        meetingId: doc.metadata.meetingId,
        subject: doc.metadata.subject,
        timestamp: doc.metadata.timestamp,
        score
      })
    }

    // Ground with Context Graph facts (F4): the assistant walks graph edges, not
    // just vector chunks, for entities named in the question — including under
    // accent/alias spellings (resolver normalization tiers) — and, when the chat
    // is scoped to a meeting, that meeting's neighborhood. Trimmed to a per-brain
    // token budget. Loaded lazily inside buildGraphContext so RAG's static import
    // graph stays free of the ingest/LLM stack.
    const graphContextParts = await buildGraphContext(message, context.meetingId)

    // Combine pinned context, graph facts, and search results
    const allContextParts = [...pinnedContextParts, ...graphContextParts, ...contextParts]

    // Prepare messages
    const contextText =
      allContextParts.length > 0
        ? `Here are relevant excerpts from meeting transcripts and pinned knowledge base items:\n\n${allContextParts.join('\n\n---\n\n')}`
        : 'No relevant meeting transcripts found for this query.'

    const userMessage = `Context:\n${contextText}\n\nQuestion: ${message}`

    // B-CHAT-006: Build messages for LLM with token-aware trimming
    const trimmedHistory = trimHistoryByTokens(context.conversationHistory, 4096)
    const messages: OllamaChatMessage[] = [
      ...trimmedHistory,
      { role: 'user', content: userMessage }
    ]

    // Add raw message to conversation history (after building messages to avoid duplicate)
    context.conversationHistory.push({ role: 'user', content: message })

    // B-CHAT-005: Generate response with abort signal support.
    // Gemini-first (config.chat.geminiModel) with Ollama fallback — see chat-llm.ts.
    const answer = await getChatLLMService().generate(messages, {
      systemPrompt: SYSTEM_PROMPT,
      temperature: 0.7,
      maxTokens: 1024,
      signal: controller.signal
    })

    if (!answer) {
      // A null answer means the chat brain chain failed (no cloud key, CLI not
      // logged in, rate-limited, or offline). Name the brain that TERMINALLY
      // failed — getLastChatFailure() records the last brain the router actually
      // tried (primary OR fallback), so a Gemini-throw → Ollama-null chain blames
      // Ollama, not Gemini. No re-resolution (re-resolving names the primary).
      // Null failure info (user abort, or nothing enabled/configured) keeps the
      // generic message. Fully defensive — must never mask the original failure.
      let brainLabel = ''
      try {
        const { getBrainRouter, getBrainRegistry } = await import('./brains')
        const failure = getBrainRouter().getLastChatFailure()
        if (failure) brainLabel = getBrainRegistry().get(failure.brainId)?.label ?? failure.brainId
      } catch {
        /* keep the generic message */
      }
      return {
        answer: '',
        sources: [],
        error: brainLabel
          ? `Failed to generate a response with ${brainLabel}. Check that it is configured and reachable, then try again.`
          : 'Failed to generate response. Please try again.'
      }
    }

    // Add assistant response to history
    context.conversationHistory.push({ role: 'assistant', content: answer })

    // B-CHAT-006: Token-aware history pruning replaces simple slice
    // Keep the history manageable but let trimHistoryByTokens do the real work at query time
    if (context.conversationHistory.length > 40) {
      context.conversationHistory = context.conversationHistory.slice(-20)
    }

    // B-CHAT-005: Clean up controller after successful completion
    this.activeControllers.delete(sessionId)

    return { answer, sources }
  }

  async summarizeMeeting(meetingId: string): Promise<string | null> {
    const vectorStore = getVectorStore()

    // Get all chunks for this meeting
    const docs = await vectorStore.searchByMeeting(meetingId)
    if (docs.length === 0) {
      return null
    }

    // Combine chunks
    const transcript = docs.map((d) => d.content).join('\n\n')

    // Get meeting info
    const db = getDatabase()
    const meetingRows = db.exec('SELECT subject FROM meetings WHERE id = ?', [meetingId])
    const subject = meetingRows[0]?.values[0]?.[0] as string | undefined

    const prompt = `Please provide a concise summary of this meeting${subject ? ` about "${subject}"` : ''}. Include:
1. Main topics discussed
2. Key decisions made
3. Action items (if any)
4. Important points or conclusions

Meeting transcript:
${transcript.substring(0, 8000)}` // Limit context size

    return getChatLLMService().generateText(prompt)
  }

  async findActionItems(meetingId?: string): Promise<string | null> {
    const vectorStore = getVectorStore()

    let docs
    if (meetingId) {
      docs = await vectorStore.searchByMeeting(meetingId)
    } else {
      // Search for action item related content across all meetings
      const results = await vectorStore.search(
        'action items tasks to-do follow up assigned responsibility deadline',
        10
      )
      docs = results.map((r) => r.document)
    }

    if (docs.length === 0) {
      return 'No meeting transcripts found.'
    }

    const transcript = docs.map((d) => d.content).join('\n\n')

    const prompt = `Extract all action items, tasks, and follow-ups from these meeting transcripts. For each item include:
- What needs to be done
- Who is responsible (if mentioned)
- Deadline (if mentioned)

Format as a numbered list.

Meeting transcripts:
${transcript.substring(0, 8000)}`

    return getChatLLMService().generateText(prompt)
  }

  /**
   * Remove the last N messages from a session's conversation history.
   * Used during retry to strip the failed user message and any partial assistant response
   * without losing all prior context.
   */
  removeLastMessages(sessionId: string, count: number): number {
    const context = this.contexts.get(sessionId)
    if (!context || count <= 0) return 0

    const toRemove = Math.min(count, context.conversationHistory.length)
    context.conversationHistory.splice(-toRemove)
    return toRemove
  }

  clearSession(sessionId: string): void {
    this.contexts.delete(sessionId)
    // Also cancel any in-flight request for this session
    const controller = this.activeControllers.get(sessionId)
    if (controller) {
      controller.abort()
      this.activeControllers.delete(sessionId)
    }
  }

  // B-CHAT-005: Cancel in-flight RAG request for a session
  cancelRequest(sessionId: string): boolean {
    const controller = this.activeControllers.get(sessionId)
    if (controller) {
      controller.abort()
      this.activeControllers.delete(sessionId)
      return true
    }
    return false
  }

  getStats(): {
    documentCount: number
    meetingCount: number
    sessionCount: number
  } {
    const vectorStore = getVectorStore()
    return {
      documentCount: vectorStore.getDocumentCount(),
      meetingCount: vectorStore.getMeetingCount(),
      sessionCount: this.contexts.size
    }
  }

  /**
   * Perform a global search across all entities.
   * B-EXP-003: Multi-term LIKE search with ranking by match count
   * (FTS5 is NOT available in sql.js WASM, so we use improved multi-term LIKE).
   */
  async globalSearch(query: string, limit = 5): Promise<Result<{
    knowledge: any[]
    people: any[]
    projects: any[]
  }>> {
    try {
      const db = getDatabase()

      // B-EXP-003: Multi-term LIKE search with ranking
      // B-CHAT-007: Explicit columns instead of SELECT *
      const terms = query.trim().split(/\s+/).filter((t) => t.length > 0)

      if (terms.length === 0) {
        return success({ knowledge: [], people: [], projects: [] })
      }

      // For single-term queries, use simpler approach
      if (terms.length === 1) {
        const escaped = escapeLikePattern(terms[0])
        const likeQuery = `%${escaped}%`

        const knowledgeRows = db.exec(`
          SELECT id, title, summary, captured_at FROM knowledge_captures
          WHERE title LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\'
          LIMIT ?
        `, [likeQuery, likeQuery, limit])

        const knowledge = knowledgeRows.length > 0 ? knowledgeRows[0].values.map(v => ({
          id: v[0],
          title: v[1],
          summary: v[2],
          capturedAt: v[3]
        })) : []

        const peopleRows = db.exec(`
          SELECT id, name, email, type FROM contacts
          WHERE name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' OR company LIKE ? ESCAPE '\\' OR role LIKE ? ESCAPE '\\'
          LIMIT ?
        `, [likeQuery, likeQuery, likeQuery, likeQuery, limit])

        const people = peopleRows.length > 0 ? peopleRows[0].values.map(v => ({
          id: v[0],
          name: v[1],
          email: v[2],
          type: v[3]
        })) : []

        const projectRows = db.exec(`
          SELECT id, name, description, status FROM projects
          WHERE name LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\'
          LIMIT ?
        `, [likeQuery, likeQuery, limit])

        const projects = projectRows.length > 0 ? projectRows[0].values.map(v => ({
          id: v[0],
          name: v[1],
          status: v[3]
        })) : []

        return success({ knowledge, people, projects })
      }

      // Multi-term search: match ANY term, rank by how many terms matched
      const buildMultiTermQuery = (
        table: string,
        columns: string[],
        selectCols: string,
        limitVal: number
      ): { sql: string; params: (string | number)[] } => {
        const params: (string | number)[] = []
        const termClauses: string[] = []
        const matchCountParts: string[] = []

        for (const term of terms) {
          const escaped = escapeLikePattern(term)
          const likeVal = `%${escaped}%`

          const colClauses = columns.map((col) => {
            params.push(likeVal)
            return `${col} LIKE ? ESCAPE '\\'`
          })
          termClauses.push(`(${colClauses.join(' OR ')})`)

          const countExpr = columns.map((col) => {
            params.push(likeVal)
            return `CASE WHEN ${col} LIKE ? ESCAPE '\\' THEN 1 ELSE 0 END`
          })
          matchCountParts.push(`MAX(${countExpr.join(', ')})`)
        }

        const whereClause = termClauses.join(' OR ')
        const rankExpr = `(${matchCountParts.join(' + ')})`

        const sql = `SELECT ${selectCols}, ${rankExpr} AS match_rank FROM ${table} WHERE ${whereClause} ORDER BY match_rank DESC LIMIT ?`
        params.push(limitVal)
        return { sql, params }
      }

      // 1. Search knowledge captures with explicit columns + multi-term ranking
      const kq = buildMultiTermQuery('knowledge_captures', ['title', 'summary'], 'id, title, summary, captured_at', limit)
      const knowledgeRows = db.exec(kq.sql, kq.params)
      const knowledge = knowledgeRows.length > 0 ? knowledgeRows[0].values.map(v => ({
        id: v[0],
        title: v[1],
        summary: v[2],
        capturedAt: v[3]
      })) : []

      // 2. Search people with explicit columns + multi-term ranking
      const pq = buildMultiTermQuery('contacts', ['name', 'email', 'company', 'role'], 'id, name, email, type', limit)
      const peopleRows = db.exec(pq.sql, pq.params)
      const people = peopleRows.length > 0 ? peopleRows[0].values.map(v => ({
        id: v[0],
        name: v[1],
        email: v[2],
        type: v[3]
      })) : []

      // 3. Search projects with explicit columns + multi-term ranking
      const prq = buildMultiTermQuery('projects', ['name', 'description'], 'id, name, description, status', limit)
      const projectRows = db.exec(prq.sql, prq.params)
      const projects = projectRows.length > 0 ? projectRows[0].values.map(v => ({
        id: v[0],
        name: v[1],
        status: v[3]
      })) : []

      return success({ knowledge, people, projects })
    } catch (err) {
      console.error('RAGService:globalSearch error:', err)
      return error('DATABASE_ERROR', 'Global search failed', err)
    }
  }
}

// Singleton instance
let ragInstance: RAGService | null = null

export function getRAGService(): RAGService {
  if (!ragInstance) {
    ragInstance = new RAGService()
  }
  return ragInstance
}

export function resetRAGService(): void {
  ragInstance = null
}

export { RAGService }
export type { RAGResponse, ChatContext }
