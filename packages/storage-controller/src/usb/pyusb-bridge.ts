import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FileEntry, CardInfo, RawDeviceInfo } from '../core/types.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * Find the Python executable in the desktop app's virtual environment.
 * Falls back to system python if venv not found.
 */
function findPython(): string {
  // Walk up from this file to find the monorepo root
  let dir = __dirname
  for (let i = 0; i < 8; i++) {
    const venvPython = join(dir, 'apps', 'desktop', '.venv.win', 'Scripts', 'python.exe')
    if (existsSync(venvPython)) return venvPython
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return 'python'
}

/**
 * Find the pyusb-bridge.py script.
 */
function findBridgeScript(): string {
  // First check next to this compiled file
  const candidates = [
    join(__dirname, 'pyusb-bridge.py'),
    join(__dirname, '..', 'src', 'usb', 'pyusb-bridge.py'),
  ]
  // Walk up to find it in the package source
  let dir = __dirname
  for (let i = 0; i < 8; i++) {
    candidates.push(join(dir, 'packages', 'storage-controller', 'src', 'usb', 'pyusb-bridge.py'))
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  throw new Error('pyusb-bridge.py not found')
}

function runBridge(command: string, args: string[] = []): Promise<string> {
  const python = findPython()
  const script = findBridgeScript()

  return new Promise((resolve, reject) => {
    const proc = spawn(python, [script, command, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const chunks: Buffer[] = []
    const errChunks: Buffer[] = []
    proc.stdout.on('data', (d: Buffer) => chunks.push(d))
    proc.stderr.on('data', (d: Buffer) => errChunks.push(d))
    proc.on('close', (code) => {
      const stdout = Buffer.concat(chunks).toString('utf-8').trim()
      const stderr = Buffer.concat(errChunks).toString('utf-8').trim()
      if (code !== 0) {
        reject(new Error(`PyUSB bridge ${command} (exit ${code}): ${stderr || 'no output'}`))
        return
      }
      resolve(stdout)
    })
    proc.on('error', (err) => reject(new Error(`PyUSB bridge spawn error: ${err.message}`)))
  })
}

export async function pyusbInfo(): Promise<{ deviceInfo: RawDeviceInfo; cardInfo: CardInfo; fileCount: number } | null> {
  const raw = await runBridge('info')
  const data = JSON.parse(raw)
  if (data.error) return null

  return {
    deviceInfo: {
      versionCode: data.version,
      versionNumber: 0,
      serialNumber: data.serial || '',
      model: (data.model || 'unknown') as RawDeviceInfo['model'],
    },
    cardInfo: {
      used: data.usedMiB ?? 0,
      capacity: data.totalMiB ?? 0,
      free: data.freeMiB ?? 0,
      status: '0',
    },
    fileCount: data.fileCount ?? 0,
  }
}

export async function pyusbListFiles(): Promise<FileEntry[]> {
  const raw = await runBridge('list')
  const data = JSON.parse(raw)
  if (data.error) throw new Error(data.error)

  return data.map((e: Record<string, unknown>) => {
    const filename = e.filename as string
    const dt = parseDateFromFilename(filename)
    return {
      name: filename,
      createDate: dt ? dt.toISOString().slice(0, 10) : '',
      createTime: dt ? dt.toISOString().slice(11, 19) : '',
      time: dt,
      duration: e.duration as number,
      version: e.version as number,
      length: e.size as number,
      signature: e.signature as string,
    }
  })
}

export async function pyusbDownloadFile(filename: string): Promise<Buffer> {
  const python = findPython()
  const script = findBridgeScript()

  return new Promise((resolve, reject) => {
    const proc = spawn(python, [script, 'download', filename], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const chunks: Buffer[] = []
    const errChunks: Buffer[] = []
    proc.stdout.on('data', (d: Buffer) => chunks.push(d))
    proc.stderr.on('data', (d: Buffer) => errChunks.push(d))
    proc.on('close', (code) => {
      if (code !== 0) {
        const stderr = Buffer.concat(errChunks).toString('utf-8').trim()
        reject(new Error(`Download failed (exit ${code}): ${stderr}`))
        return
      }
      resolve(Buffer.concat(chunks))
    })
    proc.on('error', (err) => reject(new Error(`Download spawn error: ${err.message}`)))
  })
}

function parseDateFromFilename(filename: string): Date | null {
  // Format: 2026Mar27-170005-Rec42.hda
  const m = filename.match(/^(\d{4})(\w{3})(\d{2})-(\d{2})(\d{2})(\d{2})/)
  if (!m) return null
  const months: Record<string, number> = {
    Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
    Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
  }
  const month = months[m[2]]
  if (month === undefined) return null
  return new Date(+m[1], month, +m[3], +m[4], +m[5], +m[6])
}
