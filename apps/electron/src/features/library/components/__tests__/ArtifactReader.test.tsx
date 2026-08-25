/**
 * Tests for ArtifactReader.
 *
 * Verifies per-kind artifact surfaces (image, PDF, note/text) and graceful
 * fallbacks for unknown/empty captures. The component fetches artifacts via the
 * existing IPC bridge, so the tests mock `window.electronAPI.artifacts`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { ArtifactReader } from '../ArtifactReader'
import type { UnifiedRecording } from '@/types/unified-recording'

interface MockArtifactSummary {
  id: string
  kind: string
  mime: string | null
  size: number
  storagePath: string | null
  hasText: boolean
  metadata: Record<string, unknown> | string | null
  createdAt: string
  filename?: string
}

function makeRecording(overrides: Partial<UnifiedRecording> = {}): UnifiedRecording {
  return {
    id: 'cap-1',
    filename: 'artifact.png',
    size: 1024,
    dateRecorded: new Date('2024-01-15T10:00:00Z'),
    transcriptionStatus: 'none',
    location: 'local-only',
    localPath: '/tmp/artifact.png',
    syncStatus: 'synced',
    ...overrides,
  } as UnifiedRecording
}

const mockGetForCapture = vi.fn()
const mockGetContent = vi.fn()
const mockOpenInFolder = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  mockGetForCapture.mockResolvedValue({ success: true, data: [] })
  mockGetContent.mockResolvedValue({ success: true, data: null })
  mockOpenInFolder.mockResolvedValue({ success: true })

  Object.defineProperty(window, 'electronAPI', {
    value: {
      artifacts: {
        getForCapture: mockGetForCapture,
        getContent: mockGetContent,
        openInFolder: mockOpenInFolder,
      },
    },
    writable: true,
    configurable: true,
  })
})

async function waitForArtifact() {
  await waitFor(() => expect(screen.queryByText(/loading artifact/i)).not.toBeInTheDocument())
}

describe('ArtifactReader', () => {
  it('renders an image preview with a data URL and shows the vision description', async () => {
    const artifact: MockArtifactSummary = {
      id: 'art-img-1',
      kind: 'image',
      mime: 'image/png',
      size: 2048,
      storagePath: '/store/art-img-1.png',
      hasText: false,
      metadata: { description: 'A hand-drawn architecture diagram.' },
      createdAt: '2024-01-15T10:00:00Z',
      filename: 'diagram.png',
    }
    mockGetForCapture.mockResolvedValue({ success: true, data: [artifact] })
    mockGetContent.mockResolvedValue({
      success: true,
      data: {
        kind: 'image',
        mime: 'image/png',
        storagePath: '/store/art-img-1.png',
        textContent: null,
        blobBase64: 'aGVsbG8=',
      },
    })

    const onAsk = vi.fn()
    render(<ArtifactReader recording={makeRecording({ filename: 'diagram.png' })} onAskAboutSource={onAsk} />)
    await waitForArtifact()

    const img = screen.getByRole('img')
    expect(img).toHaveAttribute('src', expect.stringContaining('data:image/png;base64,aGVsbG8='))
    expect(screen.getByText('A hand-drawn architecture diagram.')).toBeInTheDocument()
    expect(screen.getByText('diagram.png')).toBeInTheDocument()
    expect(screen.getByText('2 KB')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /ask about this source/i }))
    expect(onAsk).toHaveBeenCalledOnce()
  })

  it('renders a PDF iframe and shows extracted text', async () => {
    const artifact: MockArtifactSummary = {
      id: 'art-pdf-1',
      kind: 'pdf',
      mime: 'application/pdf',
      size: 8192,
      storagePath: '/store/report.pdf',
      hasText: true,
      metadata: { pageCount: 3 },
      createdAt: '2024-01-15T10:00:00Z',
      filename: 'report.pdf',
    }
    mockGetForCapture.mockResolvedValue({ success: true, data: [artifact] })
    mockGetContent.mockResolvedValue({
      success: true,
      data: {
        kind: 'pdf',
        mime: 'application/pdf',
        storagePath: '/store/report.pdf',
        textContent: 'Quarterly report summary.',
        blobBase64: 'cGRmYmxvYg==',
      },
    })

    const { container } = render(<ArtifactReader recording={makeRecording({ filename: 'report.pdf' })} />)
    await waitForArtifact()

    const iframe = container.querySelector('iframe')
    expect(iframe).toBeInTheDocument()
    // Chromium blocks data: URLs in iframes — the preview must use a blob: URL.
    expect(iframe).toHaveAttribute('src', expect.stringMatching(/^blob:/))
    expect(container.querySelector('pre')?.textContent).toContain('Quarterly report summary.')
    expect(screen.getByText('3 pages')).toBeInTheDocument()
  })

  it('renders note/markdown/text content in a scrollable pre block', async () => {
    const artifact: MockArtifactSummary = {
      id: 'art-note-1',
      kind: 'md',
      mime: 'text/markdown',
      size: 256,
      storagePath: '/store/notes.md',
      hasText: true,
      metadata: null,
      createdAt: '2024-01-15T10:00:00Z',
      filename: 'notes.md',
    }
    mockGetForCapture.mockResolvedValue({ success: true, data: [artifact] })
    mockGetContent.mockResolvedValue({
      success: true,
      data: {
        kind: 'md',
        mime: 'text/markdown',
        storagePath: '/store/notes.md',
        textContent: '# Meeting notes\n\n- Action item one',
      },
    })

    render(<ArtifactReader recording={makeRecording({ filename: 'notes.md' })} />)
    await waitForArtifact()

    expect(screen.getByText(/Meeting notes/)).toBeInTheDocument()
    expect(screen.getByText(/Action item one/)).toBeInTheDocument()
  })

  it('shows a graceful fallback for an unknown kind', async () => {
    const artifact: MockArtifactSummary = {
      id: 'art-unk-1',
      kind: 'docx',
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      size: 5120,
      storagePath: '/store/thing.docx',
      hasText: false,
      metadata: null,
      createdAt: '2024-01-15T10:00:00Z',
      filename: 'thing.docx',
    }
    mockGetForCapture.mockResolvedValue({ success: true, data: [artifact] })

    render(<ArtifactReader recording={makeRecording({ filename: 'thing.docx' })} />)
    await waitForArtifact()

    expect(screen.getByText('Preview not available for this file type')).toBeInTheDocument()
    expect(screen.getByText('thing.docx')).toBeInTheDocument()
  })

  it('shows an empty-state fallback when no artifacts are returned', async () => {
    mockGetForCapture.mockResolvedValue({ success: true, data: [] })

    render(<ArtifactReader recording={makeRecording({ filename: 'empty.txt' })} />)
    await waitForArtifact()

    expect(screen.getByText('No artifact found for this capture')).toBeInTheDocument()
  })

  it('opens the artifact folder when the open-in-folder action is clicked', async () => {
    const artifact: MockArtifactSummary = {
      id: 'art-img-2',
      kind: 'image',
      mime: 'image/png',
      size: 1024,
      storagePath: '/store/art-img-2.png',
      hasText: false,
      metadata: null,
      createdAt: '2024-01-15T10:00:00Z',
      filename: 'photo.png',
    }
    mockGetForCapture.mockResolvedValue({ success: true, data: [artifact] })
    mockGetContent.mockResolvedValue({ success: true, data: { kind: 'image', blobBase64: 'aGVsbG8=' } })

    render(<ArtifactReader recording={makeRecording({ filename: 'photo.png' })} />)
    await waitForArtifact()

    fireEvent.click(screen.getByRole('button', { name: /open in folder/i }))
    await waitFor(() => expect(mockOpenInFolder).toHaveBeenCalledWith('art-img-2'))
  })
})
