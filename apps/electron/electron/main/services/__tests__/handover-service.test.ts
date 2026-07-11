/**
 * @vitest-environment node
 *
 * Handover service tests (H9). Bundle assembly is exercised against a REAL temp
 * directory with injected DB readers (no database, no fs mocking) so the folder
 * contents — and the path-security behaviour (protected targets, symlinked
 * handover dirs, atomic reservation, opaque bundle ids) — are checked for real.
 * The agentic run is tested against a mock brain that honours the never-throw /
 * null contract.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync, symlinkSync, renameSync, realpathSync } from 'fs'

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
  validateTargetDir,
  revalidateBundleRecord,
  getRegisteredBundle,
  resetHandoverRegistry,
  slugify,
  runHandoverAgent,
  type HandoverDataDeps,
  type BundleRecord,
} from '../handover-service'

const FIXED = new Date('2026-07-11T09:30:00.000Z')
const at = (h: number, m: number, s: number) =>
  new Date(`2026-07-11T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.000Z`)

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

describe('slugify (untrusted transcript-derived titles)', () => {
  it('lowercases, hyphenates, and bounds length', () => {
    expect(slugify('Acme SDD Kickoff!')).toBe('acme-sdd-kickoff')
    expect(slugify('   ')).toBe('handover')
    expect(slugify('x'.repeat(80)).length).toBe(60)
  })

  it('strips path traversal and separators (adversarial titles)', () => {
    expect(slugify('../../etc/passwd')).toBe('etc-passwd')
    expect(slugify('..\\..\\windows\\system32')).toBe('windows-system32')
    expect(slugify('a/b\\c:d')).toBe('a-b-c-d')
    expect(slugify('....')).toBe('handover')
  })

  it('neutralizes reserved characters and device-name shapes', () => {
    expect(slugify('CON')).toBe('con') // always prefixed by the timestamp in a slug
    expect(slugify('a<b>|c?*"')).toBe('a-b-c')
    expect(slugify('%USERPROFILE%')).toBe('userprofile')
  })
})

describe('validateTargetDir', () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'handover-vt-'))
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('returns the canonical path for a valid directory', () => {
    expect(validateTargetDir(root).toLowerCase()).toBe(root.toLowerCase())
  })

  it('rejects a missing directory', () => {
    expect(() => validateTargetDir(join(root, 'nope'))).toThrow(/does not exist/i)
  })

  it('rejects a filesystem root', () => {
    const fsRoot = process.platform === 'win32' ? 'C:\\' : '/'
    expect(() => validateTargetDir(fsRoot)).toThrow(/filesystem root/i)
  })

  it('rejects protected OS locations (and children of them)', () => {
    // Point the "protected" env at our temp dir so the test is hermetic.
    const env = { SystemRoot: root } as NodeJS.ProcessEnv
    const child = join(root, 'child')
    mkdirSync(child)
    expect(() => validateTargetDir(root, [], env)).toThrow(/protected location/i)
    expect(() => validateTargetDir(child, [], env)).toThrow(/protected location/i)
  })

  it('rejects caller-supplied protected paths (app install / userData)', () => {
    expect(() => validateTargetDir(root, [root], {} as NodeJS.ProcessEnv)).toThrow(/protected location/i)
  })

  it('rejects the user-profile root itself (an agent must not get the whole profile)', () => {
    const env = (process.platform === 'win32' ? { USERPROFILE: root } : { HOME: root }) as NodeJS.ProcessEnv
    expect(() => validateTargetDir(root, [], env)).toThrow(/user profile/i)
  })

  it.runIf(process.platform === 'win32')('rejects a CASE-VARIANT spelling of the profile root (no case bypass)', () => {
    const env = { USERPROFILE: root } as NodeJS.ProcessEnv
    // Same directory, different casing — realpath + case-insensitive compare must catch it.
    const variant = root.toUpperCase()
    expect(() => validateTargetDir(variant, [], env)).toThrow(/user profile/i)
  })

  it('still allows a project folder INSIDE the profile (home\\projects\\x)', () => {
    const env = (process.platform === 'win32' ? { USERPROFILE: root } : { HOME: root }) as NodeJS.ProcessEnv
    const project = join(root, 'projects', 'x')
    mkdirSync(project, { recursive: true })
    expect(validateTargetDir(project, [], env).toLowerCase()).toBe(realpathSync(project).toLowerCase())
  })

  it('rejects a target that is an ANCESTOR of an app-sensitive path (userData)', () => {
    // root contains <root>/sub/userData → an agent cwd'd at root could reach it.
    const userData = join(root, 'sub', 'userData')
    mkdirSync(userData, { recursive: true })
    expect(() => validateTargetDir(root, [userData], {} as NodeJS.ProcessEnv)).toThrow(/contains a protected location/i)
  })

  it('rejects an ancestor of a protected path even when that path does not exist yet', () => {
    expect(() =>
      validateTargetDir(root, [join(root, 'future', 'userData')], {} as NodeJS.ProcessEnv)
    ).toThrow(/contains a protected location/i)
  })
})

describe('revalidateBundleRecord (TOCTOU guard)', () => {
  let root: string
  let target: string
  let bundleDir: string

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'handover-toctou-')))
    target = join(root, 'repo')
    bundleDir = join(target, 'handover', 'x')
    mkdirSync(bundleDir, { recursive: true })
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  const record = (): BundleRecord => ({ bundleDir, targetDir: target, createdAt: FIXED.toISOString() })

  it('passes for an intact bundle', () => {
    expect(revalidateBundleRecord(record())).toBeNull()
  })

  it('refuses when the target was renamed and replaced by a junction (swap attack)', () => {
    const elsewhere = join(root, 'elsewhere')
    // Recreate the expected inner structure at the junction destination so only
    // the canonical-path checks can catch the swap.
    mkdirSync(join(elsewhere, 'handover', 'x'), { recursive: true })
    renameSync(target, join(root, 'moved-aside'))
    symlinkSync(elsewhere, target, 'junction')

    expect(revalidateBundleRecord(record())).toMatch(/changed on disk|replaced by a link/i)
  })

  it('refuses when the handover component was replaced by a junction', () => {
    const elsewhere = join(root, 'elsewhere-h')
    mkdirSync(join(elsewhere, 'x'), { recursive: true })
    rmSync(join(target, 'handover'), { recursive: true, force: true })
    symlinkSync(elsewhere, join(target, 'handover'), 'junction')

    expect(revalidateBundleRecord(record())).toMatch(/changed on disk|replaced by a link/i)
  })

  it('refuses when the bundle dir no longer exists', () => {
    rmSync(bundleDir, { recursive: true, force: true })
    expect(revalidateBundleRecord(record())).toMatch(/no longer exists/i)
  })

  it('refuses a record whose bundle is not inside its target', () => {
    const outside = join(root, 'outside-bundle')
    mkdirSync(outside, { recursive: true })
    expect(
      revalidateBundleRecord({ bundleDir: outside, targetDir: target, createdAt: FIXED.toISOString() })
    ).toMatch(/no longer inside/i)
  })
})

describe('assembleHandoverBundle', () => {
  let root: string
  beforeEach(() => {
    resetHandoverRegistry()
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
    for (const f of ['transcript.md', 'summary.md', 'action-items.md', 'decisions.md', 'meeting.json']) {
      expect(existsSync(join(res.bundleDir, 'context', f))).toBe(true)
    }
    expect(readFileSync(join(res.bundleDir, 'context', 'transcript.md'), 'utf-8')).toContain('Full transcript body.')
    expect(readFileSync(join(res.bundleDir, 'context', 'decisions.md'), 'utf-8')).toContain('Decided to use TypeScript.')
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

  it('places the bundle under handover/<slug> in the CANONICAL target dir and registers an opaque id', () => {
    const res = assembleHandoverBundle({
      targetDir: root,
      handoverContent: 'x',
      source: { actionableId: 'act-1' },
      now: () => FIXED,
      data: makeDeps(),
    })
    expect(res.bundleDir.toLowerCase().startsWith(join(res.targetDir, 'handover').toLowerCase())).toBe(true)
    expect(res.bundleId).toMatch(/^[0-9a-f-]{36}$/)
    const record = getRegisteredBundle(res.bundleId)
    expect(record).toBeDefined()
    expect(record!.bundleDir).toBe(res.bundleDir)
    expect(record!.targetDir).toBe(res.targetDir)
  })

  it('reserves ATOMICALLY: same-second same-title bundles get distinct directories', () => {
    const opts = { targetDir: root, handoverContent: 'x', source: { actionableId: 'act-1' }, now: () => FIXED, data: makeDeps() }
    const a = assembleHandoverBundle(opts)
    const b = assembleHandoverBundle(opts)
    expect(a.bundleDir).not.toBe(b.bundleDir)
    expect(b.bundleDir).toMatch(/-[0-9a-f]{6}$/) // random-suffix retry, no overwrite
    expect(existsSync(a.handoverPath)).toBe(true)
    expect(existsSync(b.handoverPath)).toBe(true)
    expect(a.bundleId).not.toBe(b.bundleId)
  })

  it('rejects a protected target directory', () => {
    expect(() =>
      assembleHandoverBundle({
        targetDir: root,
        handoverContent: 'x',
        source: {},
        now: () => FIXED,
        data: makeDeps(),
        extraProtectedPaths: [root],
      })
    ).toThrow(/protected location/i)
  })

  it('rejects a symlinked/junction "handover" directory (no write-through escape)', () => {
    const outside = mkdtempSync(join(tmpdir(), 'handover-outside-'))
    try {
      // <target>/handover → junction to a directory OUTSIDE the target.
      symlinkSync(outside, join(root, 'handover'), 'junction')
      expect(() =>
        assembleHandoverBundle({
          targetDir: root,
          handoverContent: 'x',
          source: { actionableId: 'act-1' },
          now: () => FIXED,
          data: makeDeps(),
        })
      ).toThrow(/link or not a directory/i)
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
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
  let root: string
  let targetDir: string
  let bundleDir: string
  let record: BundleRecord
  const lookup = (id: string) => (id === 'bundle-1' ? record : undefined)

  beforeEach(() => {
    resetHandoverRegistry()
    // Registry records hold CANONICAL paths (realpath at creation) with the
    // bundle inside <target>/handover/<slug> — mirror that shape here so the
    // pre-run TOCTOU revalidation passes for the intact fixtures.
    root = realpathSync(mkdtempSync(join(tmpdir(), 'handover-run-')))
    targetDir = join(root, 'repo')
    bundleDir = join(targetDir, 'handover', 'x')
    mkdirSync(bundleDir, { recursive: true })
    record = { bundleDir, targetDir, createdAt: FIXED.toISOString() }
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  const mockBrain = (result: string | null) => ({
    id: 'claude-code' as const,
    label: 'Claude Code',
    capabilities: () => new Set(['generate', 'chat', 'agentic'] as any),
    authStatus: async () => ({ configured: true, method: 'cli-login' as const }),
    generate: vi.fn(async () => result),
    chat: vi.fn(async () => result),
  })

  it('runs the agent, writes RUN.log, and emits started+completed on success', async () => {
    const events: string[] = []
    const brain = mockBrain('Did the work.')
    const res = await runHandoverAgent({
      bundleId: 'bundle-1',
      now: () => at(9, 30, 0),
      resolveBrain: async () => brain as any,
      emit: (type) => events.push(type),
      lookupBundle: lookup,
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

  it('passes the validated targetDir as the generation cwd (agent runs in the repo)', async () => {
    const brain = mockBrain('ok')
    await runHandoverAgent({
      bundleId: 'bundle-1',
      resolveBrain: async () => brain as any,
      emit: () => {},
      lookupBundle: lookup,
    })
    expect(brain.generate).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ cwd: targetDir }))
  })

  it('refuses the run BEFORE generate() when the target was swapped for a junction after creation (TOCTOU)', async () => {
    // Create-time state is intact (record points at real dirs); now swap the
    // target: rename it aside and put a junction to another writable dir in its
    // place — the classic TOCTOU that would move the agent outside the boundary.
    const elsewhere = join(root, 'elsewhere')
    mkdirSync(join(elsewhere, 'handover', 'x'), { recursive: true })
    renameSync(targetDir, join(root, 'moved-aside'))
    symlinkSync(elsewhere, targetDir, 'junction')

    const events: string[] = []
    const brain = mockBrain('should not run')
    const res = await runHandoverAgent({
      bundleId: 'bundle-1',
      resolveBrain: async () => brain as any,
      emit: (type) => events.push(type),
      lookupBundle: lookup,
    })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/changed on disk|replaced by a link/i)
    expect(brain.generate).not.toHaveBeenCalled()
    expect(events).toEqual(['handover:run-failed'])
    // Nothing was written through the junction into the other directory.
    expect(existsSync(join(elsewhere, 'handover', 'x', 'RUN.log'))).toBe(false)
  })

  it('rejects a forged/unknown bundle id (never accepts renderer paths)', async () => {
    const events: string[] = []
    const brain = mockBrain('should not run')
    const res = await runHandoverAgent({
      bundleId: 'C:\\anywhere\\i\\want', // a path smuggled as an id resolves to nothing
      resolveBrain: async () => brain as any,
      emit: (type) => events.push(type),
      lookupBundle: lookup,
    })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/expired/i)
    expect(brain.generate).not.toHaveBeenCalled()
    expect(events).toEqual(['handover:run-failed'])
  })

  it('rejects a second concurrent run on the same bundle', async () => {
    let release!: (v: string | null) => void
    const gate = new Promise<string | null>((r) => (release = r))
    const brain = { ...mockBrain('x'), generate: vi.fn(() => gate) }

    const first = runHandoverAgent({
      bundleId: 'bundle-1',
      resolveBrain: async () => brain as any,
      emit: () => {},
      lookupBundle: lookup,
    })
    // Give the first run a tick to acquire the active-run slot.
    await new Promise((r) => setTimeout(r, 10))
    const second = await runHandoverAgent({
      bundleId: 'bundle-1',
      resolveBrain: async () => brain as any,
      emit: () => {},
      lookupBundle: lookup,
    })
    expect(second.ok).toBe(false)
    expect(second.error).toMatch(/already has an agent run in progress/i)

    release('done')
    const firstRes = await first
    expect(firstRes.ok).toBe(true)
    expect(brain.generate).toHaveBeenCalledTimes(1)
  })

  it('fails closed when the resolved brain is not agentic (no silent wrong-dir run)', async () => {
    const nonAgentic = { ...mockBrain('x'), capabilities: () => new Set(['generate', 'chat'] as any) }
    const res = await runHandoverAgent({
      bundleId: 'bundle-1',
      resolveBrain: async () => nonAgentic as any,
      emit: () => {},
      lookupBundle: lookup,
    })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/cannot run in a working directory/i)
    expect(nonAgentic.generate).not.toHaveBeenCalled()
  })

  it('treats a null generate() as a surfaced failure (never silence)', async () => {
    const events: string[] = []
    const res = await runHandoverAgent({
      bundleId: 'bundle-1',
      now: () => at(9, 30, 0),
      resolveBrain: async () => mockBrain(null) as any,
      emit: (type) => events.push(type),
      lookupBundle: lookup,
    })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/no output/i)
    expect(events).toEqual(['handover:run-started', 'handover:run-failed'])
    expect(readFileSync(join(bundleDir, 'RUN.log'), 'utf-8')).toContain('HANDOVER RUN FAILED')
  })

  it('fails cleanly when no agentic brain is available', async () => {
    const events: string[] = []
    const res = await runHandoverAgent({
      bundleId: 'bundle-1',
      now: () => at(9, 30, 0),
      resolveBrain: async () => null,
      emit: (type) => events.push(type),
      lookupBundle: lookup,
    })
    expect(res.ok).toBe(false)
    expect(res.brainId).toBe(null)
    expect(res.error).toMatch(/no agentic/i)
    expect(events).toEqual(['handover:run-failed'])
  })

  it('never rethrows even if generate() violates its contract and throws', async () => {
    const throwing = { ...mockBrain('x'), generate: async () => { throw new Error('boom') } }
    const res = await runHandoverAgent({
      bundleId: 'bundle-1',
      now: () => at(9, 30, 0),
      resolveBrain: async () => throwing as any,
      emit: () => {},
      lookupBundle: lookup,
    })
    expect(res.ok).toBe(false)
  })

  it('releases the active-run slot after a run finishes (a later run is allowed)', async () => {
    const brain = mockBrain('first')
    await runHandoverAgent({ bundleId: 'bundle-1', resolveBrain: async () => brain as any, emit: () => {}, lookupBundle: lookup })
    const again = await runHandoverAgent({ bundleId: 'bundle-1', resolveBrain: async () => brain as any, emit: () => {}, lookupBundle: lookup })
    expect(again.ok).toBe(true)
  })
})
