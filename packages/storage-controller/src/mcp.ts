#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { StorageController } from './core/storage-controller.js'

const controller = new StorageController()

function text(value: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] }
}

export async function startMcpServer(): Promise<void> {
  const server = new McpServer({
    name: 'hidock-storage',
    version: '0.1.0'
  })

  server.registerTool(
    'list_recordings',
    {
      title: 'List Recordings',
      description:
        'List all recordings from HiDock device and local cache. Returns filename, date, duration, size, and source (device/local/both).',
      inputSchema: {
        from: z.string().optional().describe('Filter from date (ISO format, e.g. 2025-05-01)'),
        to: z.string().optional().describe('Filter to date (ISO format, e.g. 2025-05-13)'),
        refresh: z.boolean().optional().describe('Force USB re-scan, ignoring cache')
      }
    },
    async (args) => {
      if (args.refresh) {
        try {
          await controller.connect()
          await controller.refresh()
        } catch { /* continue with cached data */ }
      }
      const filters: { from?: Date; to?: Date } = {}
      if (args.from) filters.from = new Date(args.from)
      if (args.to) filters.to = new Date(args.to)
      const recordings = await controller.list(filters)
      return text(recordings)
    }
  )

  server.registerTool(
    'search_recordings',
    {
      title: 'Search Recordings',
      description: 'Find recordings by date or find the recording closest to a specific time.',
      inputSchema: {
        date: z.string().optional().describe('ISO date — returns all recordings from that day'),
        around: z
          .string()
          .optional()
          .describe('ISO datetime — returns the single recording closest to that time')
      }
    },
    async (args) => {
      const query: { date?: Date; around?: string } = {}
      if (args.date) query.date = new Date(args.date)
      if (args.around) query.around = args.around
      const results = await controller.search(query)
      return text(results)
    }
  )

  server.registerTool(
    'get_recording',
    {
      title: 'Get Recording',
      description: 'Get metadata for a specific recording by filename.',
      inputSchema: {
        filename: z
          .string()
          .describe('The recording filename (e.g. 2025May13-160405-Rec59.hda)')
      }
    },
    async (args) => {
      const recording = await controller.get(args.filename)
      if (!recording) return text({ error: `Recording not found: ${args.filename}` })
      return text(recording)
    }
  )

  server.registerTool(
    'download_recording',
    {
      title: 'Download Recording',
      description:
        'Download a recording from the HiDock device to local disk. Returns the file path. Files are saved as .wav (HDA files are standard WAV format).',
      inputSchema: {
        filename: z.string().describe('The recording filename to download'),
        outputDir: z
          .string()
          .optional()
          .describe('Output directory (defaults to ~/.hidock/recordings/)')
      }
    },
    async (args) => {
      try {
        if (!controller.isConnected()) await controller.connect()
        const path = await controller.download(args.filename, args.outputDir)
        return text({ success: true, path })
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Download failed'
        return text({ success: false, error: message })
      }
    }
  )

  server.registerTool(
    'get_storage_info',
    {
      title: 'Get Storage Info',
      description:
        'Get device storage information: free/used/total space in MiB, file count, and connection status.',
      inputSchema: {}
    },
    async () => {
      if (!controller.isConnected()) {
        try { await controller.connect() } catch { /* continue */ }
      }
      const info = await controller.info()
      return text(info)
    }
  )

  server.registerTool(
    'get_device_status',
    {
      title: 'Get Device Status',
      description:
        'Get device connection status, model name, firmware version, and serial number.',
      inputSchema: {}
    },
    async () => {
      if (!controller.isConnected()) {
        try { await controller.connect() } catch { /* continue */ }
      }
      const status = await controller.status()
      return text(status)
    }
  )

  const transport = new StdioServerTransport()
  await server.connect(transport)
}

const isDirectRun = process.argv[1]?.endsWith('mcp.js') || process.argv[1]?.endsWith('mcp')
if (isDirectRun) {
  startMcpServer().catch((err) => {
    console.error('MCP server failed to start:', err)
    process.exit(1)
  })
}
