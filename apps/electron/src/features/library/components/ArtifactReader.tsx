/**
 * ArtifactReader Component
 *
 * Renders the content area for non-audio library rows that are backed by an
 * imported artifact (image, PDF, note, data file, etc.). It fetches the capture's
 * artifacts and the first artifact's full content, then renders a preview suited
 * to the artifact kind. Audio rows are never handled here — they stay in the
 * existing SourceReader transcript/player path.
 */

import { useState, useEffect, useMemo } from 'react'
import { FolderOpen, Sparkles, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { formatDateTime, formatBytes } from '@/lib/utils'
import type { UnifiedRecording } from '@/types/unified-recording'

/** Slim artifact summary returned by `artifacts:getForCapture`. */
interface ArtifactSummary {
  id: string
  knowledgeCaptureId: string | null
  kind: string
  mime: string | null
  size: number | null
  storagePath: string | null
  hasText: boolean
  metadata: Record<string, unknown> | null
  createdAt: string
  filename?: string
}

/** Full artifact content returned by `artifacts:getContent`. */
interface ArtifactContent {
  kind: string
  mime: string | null
  storagePath: string | null
  textContent: string | null
  blobBase64?: string
}

interface ArtifactReaderProps {
  recording: UnifiedRecording
  onAskAboutSource?: () => void
}

/** Normalise the artifact kind string for dispatching the right surface. */
function normaliseKind(kind: string | null | undefined): string {
  return (kind ?? '').toLowerCase().trim()
}

/**
 * Metadata may arrive as a parsed object or as a JSON string depending on the
 * IPC serialisation path. This helper reads a single key, returning undefined
 * when the key is missing or the metadata cannot be parsed.
 */
function getMetadataValue(
  metadata: Record<string, unknown> | string | null | undefined,
  key: string
): unknown {
  if (!metadata) return undefined
  let parsed: Record<string, unknown>
  if (typeof metadata === 'string') {
    try {
      parsed = JSON.parse(metadata) as Record<string, unknown>
    } catch {
      return undefined
    }
  } else {
    parsed = metadata as Record<string, unknown>
  }
  return parsed[key]
}

/** Format the artifact's added date; tolerate null/undefined. */
function formatAddedAt(createdAt: string | null | undefined): string {
  if (!createdAt) return 'Unknown'
  try {
    return formatDateTime(createdAt)
  } catch {
    return String(createdAt)
  }
}

/** Common "related data" card shown for every artifact kind. */
function RelatedData({
  artifact,
  recording,
}: {
  artifact: ArtifactSummary
  recording: UnifiedRecording
}) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
      <p className="text-xs font-medium text-muted-foreground">Related data</p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div>
          <p className="text-xs text-muted-foreground">Filename</p>
          <p className="truncate" title={recording.filename}>{recording.filename}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Kind</p>
          <Badge variant="neutral" className="capitalize">{artifact.kind}</Badge>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Size</p>
          <p>{formatBytes(artifact.size ?? 0)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Date added</p>
          <p>{formatAddedAt(artifact.createdAt)}</p>
        </div>
      </div>
    </div>
  )
}

/** Actions available for every artifact kind. */
function ArtifactActions({
  artifact,
  onAskAboutSource,
}: {
  artifact: ArtifactSummary
  onAskAboutSource?: () => void
}) {
  const handleOpenInFolder = () => {
    window.electronAPI?.artifacts?.openInFolder?.(artifact.id)
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {onAskAboutSource && (
        <Button
          variant="outline"
          size="sm"
          onClick={onAskAboutSource}
          className="gap-2"
          title="Ask the AI assistant about this source"
        >
          <Sparkles className="h-4 w-4" />
          Ask about this source
        </Button>
      )}
      <Button
        variant="outline"
        size="sm"
        onClick={handleOpenInFolder}
        className="gap-2"
        title="Reveal this artifact in its folder"
      >
        <FolderOpen className="h-4 w-4" />
        Open in folder
      </Button>
    </div>
  )
}

/** Image preview plus the PixelRAG vision description, if any. */
function ImageSurface({
  artifact,
  content,
}: {
  artifact: ArtifactSummary
  content: ArtifactContent | null
}) {
  const mime = content?.mime || artifact.mime || 'image/png'
  const src = content?.blobBase64 ? `data:${mime};base64,${content.blobBase64}` : undefined
  const description = getMetadataValue(artifact.metadata, 'description')

  return (
    <div className="space-y-4">
      {src ? (
        <img
          src={src}
          alt={artifact.filename || artifact.storagePath || 'Artifact preview'}
          className="max-h-[420px] object-contain mx-auto rounded-md"
        />
      ) : (
        <div
          className={
            'flex items-center justify-center h-48 rounded-md border ' +
            'border-border bg-muted/30 text-muted-foreground'
          }
        >
          <p className="text-sm">Image preview unavailable</p>
        </div>
      )}
      <div className="rounded-lg border p-3 space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
          <FileText className="h-3.5 w-3.5" aria-hidden="true" />
          Extracted information
        </p>
        <p className="text-sm">
          {typeof description === 'string' && description.trim()
            ? description
            : 'No description extracted.'}
        </p>
      </div>
    </div>
  )
}

/** PDF preview in Chromium's built-in viewer plus collapsible extracted text. */
function PdfSurface({
  artifact,
  content,
}: {
  artifact: ArtifactSummary
  content: ArtifactContent | null
}) {
  // Chromium blocks data: URLs in iframes (top-level navigation restriction) —
  // the preview renders blank. A same-origin blob: URL is the supported path.
  const src = useMemo(() => {
    if (!content?.blobBase64) return undefined
    const bytes = Uint8Array.from(atob(content.blobBase64), (c) => c.charCodeAt(0))
    return URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
  }, [content?.blobBase64])
  useEffect(() => {
    return () => {
      if (src) URL.revokeObjectURL(src)
    }
  }, [src])
  const pageCount = getMetadataValue(artifact.metadata, 'pageCount')

  return (
    <div className="space-y-4">
      {src ? (
        <iframe
          src={src}
          className="w-full h-[480px] rounded-md border border-border"
          title={artifact.filename || artifact.storagePath || 'PDF preview'}
        />
      ) : (
        <div
          className={
            'flex items-center justify-center h-48 rounded-md border ' +
            'border-border bg-muted/30 text-muted-foreground'
          }
        >
          <p className="text-sm">PDF preview unavailable</p>
        </div>
      )}
      {content?.textContent && (
        <details className="rounded-md border border-border bg-background">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium hover:bg-muted/50">
            Extracted text
          </summary>
          <div className="max-h-64 overflow-y-auto border-t border-border p-3">
            <pre className="whitespace-pre-wrap text-sm font-sans">{content.textContent}</pre>
          </div>
        </details>
      )}
      {typeof pageCount === 'number' && pageCount > 0 && (
        <p className="text-xs text-muted-foreground">
          {pageCount} page{pageCount === 1 ? '' : 's'}
        </p>
      )}
    </div>
  )
}

/** Plain-text surface for notes, markdown, json, csv, and similar text kinds. */
function TextSurface({ content }: { content: ArtifactContent | null }) {
  return (
    <div className="space-y-3">
      <div className="max-h-[480px] overflow-y-auto rounded-md border border-border p-3 bg-muted/30">
        <pre className="whitespace-pre-wrap font-mono text-sm">
          {content?.textContent || 'No extracted text available.'}
        </pre>
      </div>
    </div>
  )
}

/** Graceful fallback when we cannot render a preview for the kind. */
function FallbackSurface({ kind }: { kind: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-6 text-center text-muted-foreground">
      <p className="text-sm font-medium">Preview not available for this file type</p>
      {kind && <p className="text-xs mt-1 capitalize">{kind}</p>}
    </div>
  )
}

/** Empty-state fallback when no artifacts are linked to the capture. */
function EmptySurface() {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-6 text-center text-muted-foreground">
      <p className="text-sm font-medium">No artifact found for this capture</p>
      <p className="text-xs mt-1">The capture may not have finished importing.</p>
    </div>
  )
}

export function ArtifactReader({ recording, onAskAboutSource }: ArtifactReaderProps) {
  const [artifacts, setArtifacts] = useState<ArtifactSummary[]>([])
  const [content, setContent] = useState<ArtifactContent | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setArtifacts([])
    setContent(null)

    async function load() {
      try {
        const api = window.electronAPI?.artifacts
        if (typeof api?.getForCapture !== 'function') {
          if (!cancelled) setLoading(false)
          return
        }

        const listRes = await api.getForCapture(recording.id)
        const list = (listRes?.success ? (listRes.data as ArtifactSummary[]) : []) ?? []
        if (cancelled) return
        setArtifacts(list)

        const primary = list[0]
        if (!primary) {
          if (!cancelled) setLoading(false)
          return
        }

        const getContent = api.getContent
        if (typeof getContent !== 'function') {
          if (!cancelled) setLoading(false)
          return
        }

        const contentRes = await getContent(primary.id)
        if (cancelled) return
        setContent(contentRes?.success ? (contentRes.data as ArtifactContent) : null)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load artifact')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [recording.id])

  if (loading) {
    return (
      <div className="text-center text-muted-foreground py-8">
        <p className="text-sm">Loading artifact…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      </div>
    )
  }

  const artifact = artifacts[0]
  if (!artifact) {
    return <EmptySurface />
  }

  const kind = normaliseKind(artifact.kind)
  const isTextKind = ['note', 'txt', 'md', 'json', 'data'].includes(kind)

  return (
    <div className="space-y-4">
      {kind === 'image' && <ImageSurface artifact={artifact} content={content} />}
      {kind === 'pdf' && <PdfSurface artifact={artifact} content={content} />}
      {isTextKind && <TextSurface content={content} />}
      {!['image', 'pdf'].includes(kind) && !isTextKind && <FallbackSurface kind={kind} />}

      <RelatedData artifact={artifact} recording={recording} />
      <ArtifactActions artifact={artifact} onAskAboutSource={onAskAboutSource} />
    </div>
  )
}
