// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { ConnectorContext } from '@hidock/connectors'
import { HiNotesConnector, hinotesDescriptor } from '../hinotes-connector'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function makeContext(folderPath: string): ConnectorContext {
  return {
    connectorId: 'hinotes',
    getConfig: () => ({ folderPath }),
    getSecret: () => null,
    setSecret: vi.fn(),
    setStatus: vi.fn(),
    log: vi.fn(),
  }
}

describe('HiNotes connector', () => {
  it('describes a zero-auth Markdown source', () => {
    expect(hinotesDescriptor.id).toBe('hinotes')
    expect(hinotesDescriptor.auth.kind).toBe('none')
    expect(hinotesDescriptor.capabilityKinds).toEqual(['sources'])
  })

  it('creates the export folder and connects without credentials', async () => {
    const root = mkdtempSync(join(tmpdir(), 'hinotes-connector-'))
    roots.push(root)
    const folder = join(root, 'nested', 'exports')
    const connector = new HiNotesConnector(makeContext(folder))

    await expect(connector.connect()).resolves.toMatchObject({ state: 'connected' })
    await expect(connector.capabilities.sources.listContainers()).resolves.toEqual([
      expect.objectContaining({ externalId: 'meetings', itemCount: 0 }),
    ])
  })

  it('emits Markdown files with stable note IDs and an incremental cursor', async () => {
    const root = mkdtempSync(join(tmpdir(), 'hinotes-connector-'))
    roots.push(root)
    const first = join(root, 'note-1.md')
    const second = join(root, 'note-2.md')
    writeFileSync(first, '# First meeting\n\nTranscript one')
    writeFileSync(second, '# Second meeting\n\nTranscript two')

    const connector = new HiNotesConnector(makeContext(root))
    await connector.connect()
    const container = (await connector.capabilities.sources.listContainers())[0]
    const initial = await connector.capabilities.sources.pull(container)

    expect(initial.items.map((item) => item.externalId).sort()).toEqual(['note-1', 'note-2'])
    expect(initial.items.map((item) => item.title).sort()).toEqual(['First meeting', 'Second meeting'])
    expect(initial.cursor).toBeTruthy()

    const unchanged = await connector.capabilities.sources.pull(container, initial.cursor)
    expect(unchanged.items).toEqual([])
  })

  it('ignores non-Markdown files', async () => {
    const root = mkdtempSync(join(tmpdir(), 'hinotes-connector-'))
    roots.push(root)
    writeFileSync(join(root, 'ignore.json'), '{}')
    const connector = new HiNotesConnector(makeContext(root))
    await connector.connect()
    const container = (await connector.capabilities.sources.listContainers())[0]
    const result = await connector.capabilities.sources.pull(container)
    expect(result.items).toEqual([])
  })
})
