import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HiDockDataSource } from '../src/data-source.js'
import { createHiDockMcpServer } from '../src/mcp.js'

let client: Client | undefined

afterEach(async () => {
  await client?.close()
  client = undefined
})

describe('MCP protocol', () => {
  it('advertises and calls the five read-only tools', async () => {
    const dataSource = {
      search: vi.fn(() => []),
      recentMeetings: vi.fn(() => []),
      getTranscript: vi.fn(() => null),
      actions: vi.fn(() => []),
      decisions: vi.fn(() => []),
    } as unknown as HiDockDataSource
    const server = createHiDockMcpServer(dataSource)
    client = new Client({ name: 'test-client', version: '1.0.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])

    const listed = await client.listTools()
    expect(listed.tools.map((tool) => tool.name).sort()).toEqual([
      'hidock_actions',
      'hidock_decisions',
      'hidock_get_transcript',
      'hidock_recent_meetings',
      'hidock_search',
    ])
    expect(listed.tools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true)

    const result = await client.callTool({ name: 'hidock_recent_meetings', arguments: { limit: 5 } })
    expect(dataSource.recentMeetings).toHaveBeenCalledWith({ from: undefined, to: undefined, project: undefined, limit: 5 })
    expect(result.isError).not.toBe(true)
    await server.close()
  })
})
