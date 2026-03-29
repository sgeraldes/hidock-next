import { Command } from 'commander'
import { StorageController } from './core/storage-controller.js'
import { FileCache } from './cache/file-cache.js'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { Recording } from './core/types.js'

const program = new Command()

program
  .name('hidock')
  .description('HiDock USB storage controller — access recordings from CLI')
  .version('0.1.0')

program
  .command('list')
  .description('List all recordings')
  .option('--from <date>', 'Filter from date (ISO format)')
  .option('--to <date>', 'Filter to date (ISO format)')
  .option('--refresh', 'Force USB re-scan (ignore cache)')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    const ctrl = new StorageController()
    await ctrl.connect() // auto-connect if device available

    if (opts.refresh && ctrl.isConnected()) {
      await ctrl.refresh()
    }

    const filters: { from?: Date; to?: Date } = {}
    if (opts.from) filters.from = new Date(opts.from)
    if (opts.to) filters.to = new Date(opts.to)

    const recordings = await ctrl.list(filters)

    if (opts.json) {
      console.log(JSON.stringify(recordings, null, 2))
    } else {
      printRecordingsTable(recordings)
    }

    await ctrl.disconnect()
  })

program
  .command('search')
  .description('Search recordings by date')
  .option('--date <date>', 'All recordings from this date (ISO)')
  .option('--around <datetime>', 'Recording closest to this datetime (ISO)')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    const ctrl = new StorageController()
    await ctrl.connect() // auto-connect if device available
    const query: { date?: Date; around?: string } = {}
    if (opts.date) query.date = new Date(opts.date)
    if (opts.around) query.around = opts.around

    const results = await ctrl.search(query)

    if (opts.json) {
      console.log(JSON.stringify(results, null, 2))
    } else {
      printRecordingsTable(results)
    }

    await ctrl.disconnect()
  })

program
  .command('download [filename]')
  .description('Download recording(s) from device')
  .option('-o, --output <dir>', 'Output directory')
  .option('--all', 'Download all recordings')
  .option('--json', 'Output as JSON')
  .action(async (filename, opts) => {
    const ctrl = new StorageController()
    const connected = await ctrl.connect()

    if (!connected && !filename) {
      console.error('No HiDock device found.')
      process.exit(1)
    }

    if (opts.all) {
      console.log('Downloading all recordings...')
      const paths = await ctrl.downloadAll(opts.output, (n, total) => {
        process.stdout.write(`\r  ${n}/${total} files`)
      })
      console.log('')
      if (opts.json) {
        console.log(JSON.stringify(paths, null, 2))
      } else {
        console.log(`Downloaded ${paths.length} files.`)
      }
    } else if (filename) {
      const path = await ctrl.download(filename, opts.output)
      if (opts.json) {
        console.log(JSON.stringify({ path }, null, 2))
      } else {
        console.log(`Downloaded: ${path}`)
      }
    } else {
      console.error('Provide a filename or use --all')
      process.exit(1)
    }

    await ctrl.disconnect()
  })

program
  .command('info')
  .description('Show device storage info')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    const ctrl = new StorageController()
    await ctrl.connect()
    const info = await ctrl.info()

    if (opts.json) {
      console.log(JSON.stringify(info, null, 2))
    } else {
      if (!info.deviceConnected) {
        console.log('Device: not connected')
      } else {
        console.log(`Storage: ${info.usedMiB} MiB used / ${info.totalMiB} MiB total (${info.freeMiB} MiB free)`)
        console.log(`Files:   ${info.fileCount}`)
      }
    }

    await ctrl.disconnect()
  })

program
  .command('status')
  .description('Show device connection status')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    const ctrl = new StorageController()
    await ctrl.connect()
    const st = await ctrl.status()

    if (opts.json) {
      console.log(JSON.stringify(st, null, 2))
    } else {
      console.log(`Connected:  ${st.connected}`)
      console.log(`Model:      ${st.model}`)
      console.log(`Serial:     ${st.serialNumber ?? 'N/A'}`)
      console.log(`Firmware:   ${st.firmwareVersion ?? 'N/A'}`)
    }

    await ctrl.disconnect()
  })

const cacheCmd = program.command('cache').description('Cache management')

cacheCmd
  .command('clear')
  .description('Clear the file list cache')
  .action(() => {
    const cache = new FileCache(join(homedir(), '.hidock', 'cache'))
    cache.clearAll()
    console.log('Cache cleared.')
  })

cacheCmd
  .command('path')
  .description('Print cache directory path')
  .action(() => {
    console.log(join(homedir(), '.hidock', 'cache'))
  })

program
  .command('mcp')
  .description('Start MCP server (stdio transport)')
  .action(async () => {
    const { startMcpServer } = await import('./mcp.js')
    await startMcpServer()
  })

program.parse()

function printRecordingsTable(recordings: Recording[]): void {
  if (recordings.length === 0) {
    console.log('No recordings found.')
    return
  }
  console.log(`${'Filename'.padEnd(40)} ${'Date'.padEnd(20)} ${'Duration'.padEnd(10)} ${'Size'.padEnd(12)} Source`)
  console.log('-'.repeat(95))
  for (const r of recordings) {
    const date = r.date ? r.date.toISOString().replace('T', ' ').substring(0, 19) : 'unknown'
    const duration = formatDuration(r.duration)
    const size = formatSize(r.size)
    console.log(`${r.filename.padEnd(40)} ${date.padEnd(20)} ${duration.padEnd(10)} ${size.padEnd(12)} ${r.source}`)
  }
  console.log(`\n${recordings.length} recording(s)`)
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
