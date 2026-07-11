/**
 * GenerateOptions.cwd contract — the four AGENTIC adapters (Claude Code, Codex,
 * Gemini CLI, Kiro CLI) must pass a caller-supplied working directory through to
 * the spawned child process (runCli → spawn options.cwd). This is what makes the
 * handover's in-app run actually operate in the validated target repo instead of
 * Electron's cwd (H9 review fix, HIGH). Fake spawn only — no real processes.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi } from 'vitest'

// Stub the Gemini key resolver so GeminiCliBrain doesn't pull config/SDK imports.
vi.mock('../gemini-api-brain', () => ({ resolveGeminiApiKey: () => '' }))

import { ClaudeCodeBrain } from '../claude-code-brain'
import { CodexBrain } from '../codex-brain'
import { GeminiCliBrain } from '../gemini-cli-brain'
import { KiroCliBrain } from '../kiro-cli-brain'
import type { SpawnFn } from '../cli-runner'
import { makeFakeSpawn } from './fake-spawn'

const asSpawn = (fn: unknown) => fn as SpawnFn
const MSGS = [{ role: 'user' as const, content: 'do the work' }]
const CWD = 'C:\\target\\repo'

function spawnedCwds(calls: { options: unknown }[]): (string | undefined)[] {
  return calls.map((c) => (c.options as { cwd?: string } | undefined)?.cwd)
}

describe('agentic adapters pass GenerateOptions.cwd to the child process', () => {
  it('ClaudeCodeBrain', async () => {
    const fake = makeFakeSpawn({ stdout: 'done', code: 0 })
    const brain = new ClaudeCodeBrain({ spawn: asSpawn(fake.fn), env: {} })
    const res = await brain.generate(MSGS, { cwd: CWD })
    expect(res).toBe('done')
    expect(spawnedCwds(fake.calls)).toContain(CWD)
  })

  it('CodexBrain', async () => {
    const fake = makeFakeSpawn({ stdout: 'done', code: 0 })
    const brain = new CodexBrain({ spawn: asSpawn(fake.fn), env: {} })
    const res = await brain.generate(MSGS, { cwd: CWD })
    expect(res).toBe('done')
    expect(spawnedCwds(fake.calls)).toContain(CWD)
  })

  it('GeminiCliBrain', async () => {
    const fake = makeFakeSpawn({ stdout: JSON.stringify({ response: 'done' }), code: 0 })
    const brain = new GeminiCliBrain({ spawn: asSpawn(fake.fn), env: {} })
    const res = await brain.generate(MSGS, { cwd: CWD })
    expect(res).toBe('done')
    expect(spawnedCwds(fake.calls)).toContain(CWD)
  })

  it('KiroCliBrain', async () => {
    const fake = makeFakeSpawn({ stdout: 'done', code: 0 })
    const brain = new KiroCliBrain({ spawn: asSpawn(fake.fn), env: {}, getStoredKey: () => '' })
    const res = await brain.generate(MSGS, { cwd: CWD })
    expect(res).toBe('done')
    expect(spawnedCwds(fake.calls)).toContain(CWD)
  })

  it('omits cwd when the caller does not supply one (legacy callers unchanged)', async () => {
    const fake = makeFakeSpawn({ stdout: 'done', code: 0 })
    const brain = new CodexBrain({ spawn: asSpawn(fake.fn), env: {} })
    await brain.generate(MSGS)
    expect(spawnedCwds(fake.calls)).toEqual([undefined])
  })
})
