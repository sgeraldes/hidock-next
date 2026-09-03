#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { openReadonlyDatabase, resolveDatabasePath } from './database.js'
import { HidockRepository } from './repository.js'

const db = openReadonlyDatabase()
const repository = new HidockRepository(db)
const server = new McpServer(
  { name: 'hidock-next', version: '0.1.0' },
  { instructions: 'Read-only access to eligible HiDock Next meetings. Use search before transcript retrieval when the capture ID is unknown.' }
)
const dates = { from: z.string().date().optional(), to: z.string().date().optional(), limit: z.number().int().min(1).max(100).optional() }
const output = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }], structuredContent: { result: value } })
const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }

server.registerTool('hidock_recent_meetings', { description: 'List eligible recent HiDock meetings. Read-only.', inputSchema: dates, annotations: readOnly }, (args) => output(repository.recentMeetings(args)))
server.registerTool('hidock_search', { description: 'Search eligible meeting titles, summaries and transcripts. Read-only.', inputSchema: { query: z.string().min(1), ...dates }, annotations: readOnly }, ({ query, ...filter }) => output(repository.search(query, filter)))
server.registerTool('hidock_get_transcript', { description: 'Get an eligible capture transcript and its analysis. Read-only.', inputSchema: { captureId: z.string().min(1) }, annotations: readOnly }, ({ captureId }) => output(repository.transcript(captureId)))
server.registerTool('hidock_actions', { description: 'List eligible extracted action items. Read-only.', inputSchema: { ...dates, status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']).optional() }, annotations: readOnly }, (args) => output(repository.actions(args)))
server.registerTool('hidock_decisions', { description: 'List eligible extracted decisions. Read-only.', inputSchema: dates, annotations: readOnly }, (args) => output(repository.decisions(args)))

process.on('SIGINT', () => { db.close(); process.exit(0) })
process.on('SIGTERM', () => { db.close(); process.exit(0) })

await server.connect(new StdioServerTransport())
console.error(`HiDock MCP connected read-only to ${resolveDatabasePath()}`)
