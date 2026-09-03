/**
 * HiNotes export-folder connector.
 *
 * The existing macOS Shortcut owns HiNotes authentication and writes one
 * Markdown file per cloud note. This connector watches that durable hand-off
 * folder through the normal connector host, so imports use artifact-service
 * (copy, extraction, embeddings, provenance) rather than touching hidock.db.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'fs'
import { homedir } from 'os'
import { basename, join, resolve } from 'path'
import type {
  Connector,
  ConnectorContext,
  ConnectorDescriptor,
  ConnectorStatus,
  ConnectorStatusState,
  PullResult,
  SourceContainer,
  SourceItem,
} from '@hidock/connectors'

const DEFAULT_FOLDER = '~/HiDock/HiNotes Inbox'
const PAGE_SIZE = 100

const MEETINGS_CONTAINER: SourceContainer = {
  externalId: 'meetings',
  name: 'HiNotes meetings',
  kind: 'meetings',
}

interface FileCursor {
  mtimeMs: number
  name: string
}

interface ExportedFile {
  name: string
  path: string
  mtimeMs: number
}

function expandHome(input: string): string {
  const trimmed = input.trim()
  if (trimmed === '~') return homedir()
  if (trimmed.startsWith('~/')) return join(homedir(), trimmed.slice(2))
  return resolve(trimmed)
}

function parseCursor(value?: string): FileCursor {
  if (!value) return { mtimeMs: 0, name: '' }
  try {
    const parsed = JSON.parse(value) as Partial<FileCursor>
    return {
      mtimeMs: typeof parsed.mtimeMs === 'number' ? parsed.mtimeMs : 0,
      name: typeof parsed.name === 'string' ? parsed.name : '',
    }
  } catch {
    return { mtimeMs: 0, name: '' }
  }
}

function afterCursor(file: ExportedFile, cursor: FileCursor): boolean {
  return file.mtimeMs > cursor.mtimeMs || (file.mtimeMs === cursor.mtimeMs && file.name > cursor.name)
}

function markdownTitle(text: string, fallback: string): string {
  const match = text.match(/^#\s+(.+?)\s*$/m)
  return match?.[1]?.trim() || fallback
}

export const hinotesDescriptor: ConnectorDescriptor = {
  id: 'hinotes',
  displayName: 'HiNotes',
  description: 'Import summaries and speaker-labelled transcripts exported by the HiNotes Sync shortcut.',
  transport: 'native',
  setupOptional: true,
  auth: { kind: 'none' },
  configFields: [
    {
      key: 'folderPath',
      label: 'HiNotes export folder',
      type: 'text',
      required: true,
      advanced: true,
      default: DEFAULT_FOLDER,
      help: 'The HiNotes Sync shortcut writes Markdown meetings here. The default works with the bundled shortcut bridge.',
    },
  ],
  capabilityKinds: ['sources'],
}

export class HiNotesConnector implements Connector {
  readonly id: string
  readonly kind = 'native' as const
  readonly type = 'hinotes'
  readonly name = 'HiNotes'

  private state: ConnectorStatusState = 'disconnected'
  private message: string | undefined

  constructor(private readonly ctx: ConnectorContext) {
    this.id = ctx.connectorId
  }

  status(): ConnectorStatus {
    return { state: this.state, message: this.message }
  }

  private folderPath(): string {
    const configured = String(this.ctx.getConfig().folderPath ?? DEFAULT_FOLDER)
    return expandHome(configured || DEFAULT_FOLDER)
  }

  async connect(): Promise<ConnectorStatus> {
    try {
      mkdirSync(this.folderPath(), { recursive: true })
      this.state = 'connected'
      this.message = undefined
      this.ctx.setStatus({ state: 'connected', message: undefined })
    } catch (err) {
      this.state = 'error'
      this.message = err instanceof Error ? err.message : String(err)
      this.ctx.setStatus({ state: 'error', message: this.message })
    }
    return this.status()
  }

  async disconnect(): Promise<void> {
    this.state = 'disconnected'
    this.message = undefined
  }

  capabilities = {
    sources: {
      listContainers: async (): Promise<SourceContainer[]> => {
        const folder = this.folderPath()
        const itemCount = existsSync(folder)
          ? readdirSync(folder, { withFileTypes: true }).filter((entry) => entry.isFile() && /\.md$/i.test(entry.name)).length
          : 0
        return [{ ...MEETINGS_CONTAINER, itemCount }]
      },
      pull: (container: SourceContainer, since?: string) => this.pull(container, since),
    },
  }

  private async pull(container: SourceContainer, since?: string): Promise<PullResult> {
    if (container.externalId !== MEETINGS_CONTAINER.externalId) return { items: [], hasMore: false }

    const folder = this.folderPath()
    if (!existsSync(folder)) return { items: [], hasMore: false }

    const cursor = parseCursor(since)
    const files = readdirSync(folder, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.md$/i.test(entry.name))
      .map((entry): ExportedFile => {
        const path = join(folder, entry.name)
        return { name: entry.name, path, mtimeMs: statSync(path).mtimeMs }
      })
      .filter((file) => afterCursor(file, cursor))
      .sort((a, b) => a.mtimeMs - b.mtimeMs || a.name.localeCompare(b.name))

    const page = files.slice(0, PAGE_SIZE)
    const items: SourceItem[] = page.map((file) => {
      const text = readFileSync(file.path, 'utf-8')
      const externalId = basename(file.name, '.md')
      return {
        externalId,
        kind: 'md',
        mime: 'text/markdown',
        title: markdownTitle(text, externalId),
        text,
        createdAt: new Date(file.mtimeMs).toISOString(),
        metadata: { source: 'hinotes-shortcut', fileName: file.name },
      }
    })

    const last = page.at(-1)
    return {
      items,
      cursor: last ? JSON.stringify({ mtimeMs: last.mtimeMs, name: last.name }) : since,
      hasMore: files.length > page.length,
    }
  }
}

export function createHiNotesConnector(ctx: ConnectorContext): HiNotesConnector {
  return new HiNotesConnector(ctx)
}
