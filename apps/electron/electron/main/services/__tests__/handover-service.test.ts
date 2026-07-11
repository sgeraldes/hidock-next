/**
 * @vitest-environment node
 *
 * Handover service tests (H9). Bundle assembly is exercised against a REAL temp
 * directory with injected DB readers (no database, no fs mocking) so the folder
 * contents can be snapshot-checked. The agentic run is tested against a mock brain
 * that honours the never-throw / null contract.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs'

// All DB/brains/event-bus dependencies are INJECTED in these tests, so mock the
// modules to keep the suite hermetic (the real ones pull in electron `app`).
vi.mock('../database', () => ({
  getTranscriptByRecordingId: vi.fn(),
  getMeetingById: vi.fn(),
  getRecordingById: vi.fn(),
  queryOne: vi.fn(),
  queryAll: vi.fn(() => []),
}))
vi.mock('../brains', () => ({
  getBrainRouter: vi.fn(() => ({ resolve: vi.fn(async () => null) })),
  getBrainRegistry: vi.fn(() => ({ get: vi.fn(() => null) })),
}))
vi.mock('../event-bus', () => ({ getEventBus: vi.fn(() => ({ emitDomainEvent: vi.fn() })) }))
import { join } from 'path'
import { tmpdir } from 'os'
import {
  assembleHandoverBundle,
  resolveUniqueBundleDir,
  slugify,
  runHandoverAgent,
  type HandoverDataDeps,
} from '../handover-service'

const FIXED = new Date('2026-07-11T09:30:00.000Z')
const at = (h: number, m: number, s: number) => new Date(`2026-07-11T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.000Z`)

function makeDeps(over: Partial<HandoverDataDeps> = {}): HandoverDataDeps {
  return {
    getActionable: (id) => (id === 'act-1' ? { source_knowledge_id: 'kc-1' } : undefined),
    getKnowledgeCapture: (id) =>
      id === 'kc-1'
        ? { id: 'kc-1', title: 'Acme SDD kickoff', summary: 'Kickoff summary.', source_recording_id: 'rec-1', meeting_id: 'mtg-1' }
        : undefined,
    getRecording: (id) => (id === 'rec-1' ? { id: 'rec-1', filename: 'rec-1.wav', meeting_id: 'mtg-1', date_recorded: '2026-07-10' } : undefined),
    getTranscript: (id) =>
      id === 'rec-1'
        ? {
            full_text: 'Full transcript body.',
            summary: 'Transcript summary.',
            action_items: JSON.stringify([{ owner: 'Ana', task: 'Draft SDD', due: 'Fri' }, 'Ship the repo scaffold']),
            key_points: 'Decided to use TypeScript.',
          }
        : undefined,
    getMeeting: (id) => (id === 'mtg-1' ? { id: 'mtg-1', subject: 'Acme Kickoff', start_time: '2026-07-10T10:00:00Z', attendees: 'Ana; Bob' } : undefined),
    getActionablesForKnowledge: (kid) => (kid === 'kc-1' ? [{ title: 'Create the SDD', description: 'From the kickoff', status: 'pending' }] : []),
    ...over,
  }
}

describe('slugify', () => {
  it('lowercases, hyphenates, and bounds length', () => {
    expect(slugify('Acme SDD Kickoff!')).toBe('acme-sdd-kickoff')
    expect(slugify('   ')).toBe('handover')
    expect(slugify('x'.repeat(80)).length).toBe(60)
  })
})

describe('resolveUniqueBundleDir', () => {
  it('returns the base path when it does not exist', () => {
    expect(resolveUniqueBundleDir('/p', 'slug', () => false)).toBe(join('/p', 'slug'))
  })

  it('appends a numeric suffix on collision (idempotent slug collision)', () => {
    const taken = new Set([join('/p', 'slug'), join('/p', 'slug-2')])
    expect(resolveUniqueBundleDir('/p', 'slug', (x) => taken.has(x))).toBe(join('/p', 'slug-3'))
  })
})

describe('assembleHandoverBundle', () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'handover-test-'))
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('writes the full bundle layout with HANDOVER.md, README, context/, manifest', () => {
    const res = assembleHandoverBundle({
      targetDir: root,
      handoverContent: '# Follow-up\nDo the work.',
      source: { actionableId: 'act-1' },
      brain: { id: 'claude-code', label: 'Claude Code' },
      now: () => FIXED,
      data: makeDeps(),
    })

    expect(existsSync(res.handoverPath)).toBe(true)
    expect(readFileSync(res.handoverPath, 'utf-8')).toContain('Do the work.')
    expect(existsSync(join(res.bundleDir, 'README.md'))).toBe(true)
    expect(existsSync(join(res.bundleDir, 'manifest.json'))).toBe(true)
    // context files
    for (const f of ['transcript.md', 'summary.md', 'action-items.md', 'decisions.md', 'meeting.json']) {
      expect(existsSync(join(res.bundleDir, 'context', f))).toBe(true)
    }
    expect(readFileSync(join(res.bundleDir, 'context', 'transcript.md'), 'utf-8')).toContain('Full transcript body.')
    expect(readFileSync(join(res.bundleDir, 'context', 'decisions.md'), 'utf-8')).toContain('Decided to use TypeScript.')
    // action items: transcript items + detected actionables
    const ai = readFileSync(join(res.bundleDir, 'context', 'action-items.md'), 'utf-8')
    expect(ai).toContain('Draft SDD')
    expect(ai).toContain('Ship the repo scaffold')
    expect(ai).toContain('Create the SDD')
  })

  it('records source ids, brain, and the file list in the manifest', () => {
    const res = assembleHandoverBundle({
      targetDir: root,
      handoverContent: 'x',
      source: { actionableId: 'act-1' },
      brain: { id: 'codex', label: 'Codex' },
      now: () => FIXED,
      data: makeDeps(),
    })
    const manifest = JSON.parse(readFileSync(join(res.bundleDir, 'manifest.json'), 'utf-8'))
    expect(manifest.brain).toEqual({ id: 'codex', label: 'Codex' })
    expect(manifest.source).toEqual({
      actionableId: 'act-1',
      knowledgeCaptureId: 'kc-1',
      meetingId: 'mtg-1',
      recordingIds: ['rec-1'],
    })
    expect(manifest.generatedAt).toBe(FIXED.toISOString())
    expect(manifest.files).toContain('HANDOVER.md')
    expect(manifest.files).toContain('manifest.json')
    expect(manifest.files).toContain('context/meeting.json')
    expect(manifest.slug).toMatch(/^2026-07-11-\d{6}-acme-sdd-kickoff$/)
  })

  it('places the bundle under handover/<slug> in the target dir', () => {
    const res = assembleHandoverBundle({
      targetDir: root,
      handoverContent: 'x',
      source: { actionableId: 'act-1' },
      now: () => FIXED,
      data: makeDeps(),
    })
    expect(res.bundleDir.startsWith(join(root, 'handover'))).toBe(true)
  })

  it('gives a fresh directory on a same-second slug collision (idempotent)', () => {
    const opts = { targetDir: root, handoverContent: 'x', source: { actionableId: 'act-1' }, now: () => FIXED, data: makeDeps() }
    const a = assembleHandoverBundle(opts)
    const b = assembleHandoverBundle(opts)
    expect(a.bundleDir).not.toBe(b.bundleDir)
    expect(b.bundleDir).toMatch(/-2$/)
    expect(existsSync(a.handoverPath)).toBe(true)
    expect(existsSync(b.handoverPath)).toBe(true)
  })

  it('degrades gracefully when the source has no transcript/meeting', () => {
    const res = assembleHandoverBundle({
      targetDir: root,
      handoverContent: 'x',
      source: { recordingId: 'unknown-rec' },
      now: () => FIXED,
      data: makeDeps(),
    })
    expect(readFileSync(join(res.bundleDir, 'context', 'transcript.md'), 'utf-8')).toContain('No transcript available.')
    expect(readFileSync(join(res.bundleDir, 'context', 'action-items.md'), 'utf-8')).toContain('None recorded.')
  })
})

describe('runHandoverAgent', () => {
  let bundleDir: string
  beforeEach(() => {
    bundleDir = mkdtempSync(join(tmpdir(), 'handover-run-'))
  })
  afterEach(() => {
    rmSync(bundleDir, { recursive: true, force: true })
  })

  const mockBrain = (result: string | null) => ({
    id: 'claude-code' as const,
    label: 'Claude Code',
    capabilities: () => new Set(['generate', 'chat', 'agentic'] as any),
    authStatus: async () => ({ configured: true, method: 'cli-login' as const }),
    generate: async () => result,
    chat: async () => result,
  })

  it('runs the agent, writes RUN.log, and emits started+completed on success', async () => {
    const events: string[] = []
    const res = await runHandoverAgent({
      bundleDir,
      targetDir: bundleDir,
      now: () => at(9, 30, 0),
      resolveBrain: async () => mockBrain('Did the work.') as any,
      emit: (type) => events.push(type),
    })
    expect(res.ok).toBe(true)
    expect(res.brainId).toBe('claude-code')
    expect(res.finalResponse).toBe('Did the work.')
    expect(events).toEqual(['handover:run-started', 'handover:run-completed'])
    const log = readFileSync(join(bundleDir, 'RUN.log'), 'utf-8')
    expect(log).toContain('HANDOVER RUN STARTED')
    expect(log).toContain('Did the work.')
    expect(log).toContain('HANDOVER RUN COMPLETED')
  })

  it('treats a null generate() as a surfaced failure (never silence)', async () => {
    const events: string[] = []
    const res = await runHandoverAgent({
      bundleDir,
      targetDir: bundleDir,
      now: () => at(9, 30, 0),
      resolveBrain: async () => mockBrain(null) as any,
      emit: (type) => events.push(type),
    })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/no output/i)
    expect(events).toEqual(['handover:run-started', 'handover:run-failed'])
    expect(readFileSync(join(bundleDir, 'RUN.log'), 'utf-8')).toContain('HANDOVER RUN FAILED')
  })

  it('fails cleanly when no agentic brain is available', async () => {
    const events: string[] = []
    const res = await runHandoverAgent({
      bundleDir,
      targetDir: bundleDir,
      now: () => at(9, 30, 0),
      resolveBrain: async () => null,
      emit: (type) => events.push(type),
    })
    expect(res.ok).toBe(false)
    expect(res.brainId).toBe(null)
    expect(res.error).toMatch(/no agentic/i)
    expect(events).toEqual(['handover:run-failed'])
  })

  it('never rethrows even if generate() violates its contract and throws', async () => {
    const throwing = { ...mockBrain('x'), generate: async () => { throw new Error('boom') } }
    const res = await runHandoverAgent({
      bundleDir,
      targetDir: bundleDir,
      now: () => at(9, 30, 0),
      resolveBrain: async () => throwing as any,
      emit: () => {},
    })
    expect(res.ok).toBe(false)
  })
})
