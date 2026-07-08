/**
 * Entity-Type Registry (Layer 0 — C0 foundation)
 *
 * Code-registered (NOT database) definitions for every artifact format the
 * library understands. Each type declares how to store, extract text from, and
 * chunk its blobs; connectors (Layer 2) can only deliver formats registered
 * here. See CONNECTORS.md.
 *
 * The audio/transcript legacy path is intentionally NOT folded in this round —
 * that refactor is a documented follow-up.
 */

import { extname } from 'path'
import { readFileSync } from 'fs'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { chunkText } from './vector-store'
import { getConfig } from './config'

/** Result of a type's text extraction: the plain text plus optional metadata. */
export interface ArtifactExtraction {
  text: string
  metadata?: Record<string, unknown>
}

/**
 * One registered entity type. `extractText` receives the on-disk path and an
 * optional pre-read buffer (the service reads the file once for hashing and
 * passes it through to avoid a second read).
 */
export interface ArtifactTypeDefinition {
  kind: string
  mimes: string[]
  exts: string[]
  extractText: (filePath: string, buffer?: Buffer) => Promise<ArtifactExtraction>
  /** Chunking strategy — defaults to the transcript chunker used by the vector store. */
  chunk: (text: string) => string[]
  /** Optional post-processing enrichment (queued/budgeted in later rounds). */
  enrich?: (extraction: ArtifactExtraction) => Promise<ArtifactExtraction>
}

/**
 * Typed extraction failure. `code` distinguishes a deliberate "feature not
 * available" (e.g. PDF with no parser installed) from a genuine runtime error,
 * so the service can note it on the artifact instead of aborting the import.
 */
export class ArtifactExtractionError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'ArtifactExtractionError'
    this.code = code
  }
}

const registry = new Map<string, ArtifactTypeDefinition>()

export function registerArtifactType(def: ArtifactTypeDefinition): void {
  registry.set(def.kind, def)
}

export function getArtifactType(kind: string): ArtifactTypeDefinition | undefined {
  return registry.get(kind)
}

export function listArtifactTypes(): ArtifactTypeDefinition[] {
  return Array.from(registry.values())
}

/**
 * Resolve a registered type from either a file path/extension or a MIME string.
 * MIME is tried first (exact match), then the file extension.
 */
export function resolveType(filePathOrMime: string): ArtifactTypeDefinition | undefined {
  const input = filePathOrMime.trim().toLowerCase()

  // MIME match first (e.g. "image/png", "application/pdf")
  for (const def of registry.values()) {
    if (def.mimes.includes(input)) return def
  }

  // Fall back to file extension
  const ext = extname(input).replace(/^\./, '')
  if (ext) {
    for (const def of registry.values()) {
      if (def.exts.includes(ext)) return def
    }
  }

  return undefined
}

// ---------------------------------------------------------------------------
// Built-in type registrations
// ---------------------------------------------------------------------------

function readText(filePath: string, buffer?: Buffer): string {
  return (buffer ?? readFileSync(filePath)).toString('utf-8')
}

/** Flatten a parsed JSON value into `dot.path: value` lines for embedding-friendly text. */
function flattenJson(value: unknown, prefix = '', out: string[] = []): string[] {
  if (value === null || typeof value !== 'object') {
    out.push(`${prefix || '(root)'}: ${String(value)}`)
    return out
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => flattenJson(item, prefix ? `${prefix}[${i}]` : `[${i}]`, out))
    return out
  }
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    flattenJson(val, prefix ? `${prefix}.${key}` : key, out)
  }
  return out
}

registerArtifactType({
  kind: 'md',
  mimes: ['text/markdown'],
  exts: ['md', 'markdown'],
  chunk: chunkText,
  extractText: async (filePath, buffer) => ({ text: readText(filePath, buffer) })
})

registerArtifactType({
  kind: 'txt',
  mimes: ['text/plain'],
  exts: ['txt', 'text', 'log'],
  chunk: chunkText,
  extractText: async (filePath, buffer) => ({ text: readText(filePath, buffer) })
})

registerArtifactType({
  kind: 'json',
  mimes: ['application/json'],
  exts: ['json'],
  chunk: chunkText,
  extractText: async (filePath, buffer) => {
    const raw = readText(filePath, buffer)
    try {
      const parsed = JSON.parse(raw)
      const flattened = flattenJson(parsed).join('\n')
      return { text: flattened, metadata: { jsonValid: true } }
    } catch (e) {
      // Not valid JSON — index the raw source so it's still searchable.
      return { text: raw, metadata: { jsonValid: false, parseError: e instanceof Error ? e.message : String(e) } }
    }
  }
})

registerArtifactType({
  kind: 'pdf',
  mimes: ['application/pdf'],
  exts: ['pdf'],
  chunk: chunkText,
  extractText: async () => {
    // No PDF parser is installed (pdf-parse / pdfjs-dist absent from package.json).
    // Per C0 constraints we do NOT auto-install; import still stores the file and
    // records this NOT_AVAILABLE note on the artifact. C1 wires a real extractor.
    throw new ArtifactExtractionError(
      'NOT_AVAILABLE',
      'PDF text extraction requires pdf-parse or pdfjs-dist, which are not installed. The file was imported without extracted text.'
    )
  }
})

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml'
}

registerArtifactType({
  kind: 'image',
  mimes: ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'],
  exts: ['png', 'jpg', 'jpeg', 'webp', 'svg'],
  chunk: chunkText,
  extractText: async (filePath, buffer) => {
    const apiKey = getConfig().transcription.geminiApiKey
    if (!apiKey) {
      // Skip gracefully — no vision model configured.
      return { text: '', metadata: { description: null, note: 'image description skipped (no Gemini key)' } }
    }

    const ext = extname(filePath).replace(/^\./, '').toLowerCase()
    const mimeType = IMAGE_MIME_BY_EXT[ext] ?? 'image/png'
    const data = (buffer ?? readFileSync(filePath)).toString('base64')

    try {
      const genAI = new GoogleGenerativeAI(apiKey)
      const model = genAI.getGenerativeModel({ model: getConfig().transcription.geminiModel || 'gemini-3.5-flash' })
      const result = await model.generateContent({
        contents: [
          {
            role: 'user',
            parts: [
              {
                text:
                  'Describe this image in detail for a searchable knowledge library. ' +
                  'Return JSON: {"description": string, "tags": string[]}. ' +
                  'Tags are concise keywords (objects, text, people, chart types, colors).'
              },
              { inlineData: { mimeType, data } }
            ]
          }
        ],
        generationConfig: {
          maxOutputTokens: 1024,
          responseMimeType: 'application/json',
          thinkingConfig: { thinkingBudget: 0 }
        } as never
      })

      const responseText = result.response.text()
      let description = responseText
      let tags: string[] = []
      const jsonMatch = responseText.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]) as { description?: string; tags?: string[] }
          if (typeof parsed.description === 'string') description = parsed.description
          if (Array.isArray(parsed.tags)) tags = parsed.tags.filter((t) => typeof t === 'string')
        } catch {
          /* fall back to raw text as the description */
        }
      }

      const text = [description, tags.length ? `Tags: ${tags.join(', ')}` : ''].filter(Boolean).join('\n')
      return { text, metadata: { description, tags, source: 'gemini-vision', mimeType } }
    } catch (e) {
      // Vision call failed — import proceeds without a description.
      return {
        text: '',
        metadata: { description: null, source: 'gemini-vision', error: e instanceof Error ? e.message : String(e) }
      }
    }
  }
})
