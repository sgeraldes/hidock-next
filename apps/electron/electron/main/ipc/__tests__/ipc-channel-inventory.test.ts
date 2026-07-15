/**
 * Registrar-inventory completeness (Track I, Review-2 [HIGH]).
 *
 * Statically enumerates EVERY `ipcMain.handle(...)` / `gatedHandle(...)` channel
 * registered anywhere in the main process and asserts each one is classified —
 * owned by a feature (gated) or explicitly declared core (never gated). Any new
 * channel that is neither maps to `unclassified` and FAILS this test, so a future
 * feature-owned channel (e.g. another `recordings:` transcription trigger) can no
 * longer silently pass through the gate.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join, resolve } from 'path'
import { classifyChannel } from '../../../../src/shared/feature-registry'

const HERE = dirname(fileURLToPath(import.meta.url))
// __tests__ → ipc → main
const MAIN_DIR = resolve(HERE, '..', '..')

/** All *.ts source files under the main process (excluding tests + declarations). */
function collectSourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue
      out.push(...collectSourceFiles(p))
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      out.push(p)
    }
  }
  return out
}

/**
 * Extract every registered IPC channel literal. Covers multi-line `.handle(`
 * calls (the channel may sit on the next line) and the `gatedHandle(ipcMain, 'x')`
 * helper. Only strings shaped like a namespaced channel (`prefix:suffix`) count,
 * which excludes any unrelated `.handle(` call.
 */
function extractChannels(source: string): string[] {
  const channels: string[] = []
  const patterns = [
    /\.handle\(\s*(["'`])([^"'`]+)\1/g,
    /gatedHandle\(\s*[A-Za-z_$][\w$]*\s*,\s*(["'`])([^"'`]+)\1/g,
  ]
  for (const re of patterns) {
    let m: RegExpExecArray | null
    while ((m = re.exec(source))) {
      const ch = m[2]
      if (/^[a-zA-Z][\w-]*:/.test(ch)) channels.push(ch)
    }
  }
  return channels
}

const ALL_CHANNELS: string[] = (() => {
  const set = new Set<string>()
  for (const file of collectSourceFiles(MAIN_DIR)) {
    for (const ch of extractChannels(readFileSync(file, 'utf8'))) set.add(ch)
  }
  return [...set].sort()
})()

describe('IPC channel registrar inventory', () => {
  it('discovers the full channel surface (scan sanity guard)', () => {
    // Guards against a broken scan silently passing with zero channels.
    expect(ALL_CHANNELS.length).toBeGreaterThan(250)
  })

  it('classifies EVERY registered channel (no channel slips through unclassified)', () => {
    const unclassified = ALL_CHANNELS.filter((ch) => classifyChannel(ch).kind === 'unclassified')
    expect(
      unclassified,
      `Unclassified IPC channels — map each to a feature (FEATURES[*].ipcNamespaces) ` +
        `or declare it core (CORE_CHANNEL_PREFIXES / CORE_CHANNELS) in ` +
        `src/shared/feature-registry.ts:\n${unclassified.join('\n')}`
    ).toEqual([])
  })

  it('gates the transcription triggers that previously slipped through (regression)', () => {
    for (const ch of [
      'recordings:transcribe',
      'recordings:addToQueue',
      'recordings:processQueue',
      'recordings:reprocessWith',
      'recordings:startTranscriptionProcessor',
    ]) {
      // Present in the live inventory…
      expect(ALL_CHANNELS, ch).toContain(ch)
      // …and owned by transcription (gated), not core.
      expect(classifyChannel(ch), ch).toEqual({ kind: 'feature', feature: 'transcription' })
    }
  })

  it('keeps shared Library reads on recordings: classified as core (not over-gated)', () => {
    for (const ch of ['recordings:getAll', 'recordings:delete', 'recordings:getTranscript']) {
      expect(classifyChannel(ch), ch).toEqual({ kind: 'core' })
    }
  })
})
