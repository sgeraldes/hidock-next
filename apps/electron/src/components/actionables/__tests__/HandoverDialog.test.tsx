import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { HandoverDialog } from '../HandoverDialog'

vi.mock('@/components/ui/toaster', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

// Activity Log store — the dialog pushes entries on completion (best-effort).
const addActivityLogEntry = vi.fn()
vi.mock('@/store', () => ({
  useAppStore: { getState: () => ({ addActivityLogEntry }) },
}))

const OUTPUT = { content: '# Follow-up\nDo the work.', templateId: 'claude_code_prompt', actionableId: 'a-1', sourceId: 'kc-1' }

/** claude-code = usable (agentic, enabled, signed in); codex = agentic but disabled. */
const USABLE_BRAINS = [
  { id: 'gemini-api', label: 'Gemini', capabilities: ['generate', 'chat'], enabled: true, isDefault: true, auth: { configured: true, method: 'api-key' } },
  { id: 'claude-code', label: 'Claude Code', capabilities: ['generate', 'chat', 'agentic'], enabled: true, isDefault: false, auth: { configured: true, method: 'cli-login' } },
  { id: 'codex', label: 'Codex', capabilities: ['generate', 'chat', 'agentic'], enabled: false, isDefault: false, auth: { configured: false, method: 'none', detail: 'Not authenticated' } },
]

const createBundle = vi.fn()
const runAgent = vi.fn()
const copyToClipboard = vi.fn()
const launchClaudeCode = vi.fn()
const openInFolder = vi.fn()
const selectFolder = vi.fn()
const brainsList = vi.fn()

function setApi(brains: unknown[]) {
  brainsList.mockResolvedValue(brains)
  createBundle.mockResolvedValue({
    success: true,
    data: { created: true, bundleDir: 'C:\\repo\\handover\\x', handoverPath: 'C:\\repo\\handover\\x\\HANDOVER.md', targetDir: 'C:\\repo' },
  })
  runAgent.mockResolvedValue({ success: true, data: { ok: true, brainId: 'claude-code', brainLabel: 'Claude Code', finalResponse: 'done', runLogPath: 'r' } })
  copyToClipboard.mockResolvedValue({ success: true })
  launchClaudeCode.mockResolvedValue({ success: true, data: { launched: true, cwd: 'C:\\repo' } })
  openInFolder.mockResolvedValue({ success: true })
  selectFolder.mockResolvedValue({ success: true, data: 'C:\\picked' })
  ;(global.window as any).electronAPI = {
    brains: { list: brainsList },
    handover: { createBundle, runAgent },
    outputs: { copyToClipboard, launchClaudeCode, openInFolder },
    storage: { selectFolder },
  }
}

describe('HandoverDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setApi(USABLE_BRAINS)
  })

  it('renders the target directory field and the agent brain picker', async () => {
    render(<HandoverDialog open onOpenChange={vi.fn()} output={OUTPUT} />)
    expect(await screen.findByLabelText('Target directory')).toBeInTheDocument()
    expect(screen.getByLabelText('Agent brain')).toBeInTheDocument()
    await waitFor(() => expect(brainsList).toHaveBeenCalled())
  })

  it('"Write bundle" calls handover.createBundle with the prompt content', async () => {
    render(<HandoverDialog open onOpenChange={vi.fn()} output={OUTPUT} />)
    await waitFor(() => expect(brainsList).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: /write bundle/i }))
    await waitFor(() =>
      expect(createBundle).toHaveBeenCalledWith(
        expect.objectContaining({ content: OUTPUT.content, actionableId: 'a-1', knowledgeCaptureId: 'kc-1' })
      )
    )
    expect(runAgent).not.toHaveBeenCalled()
  })

  it('"Write + run agent" writes the bundle then runs the selected brain', async () => {
    render(<HandoverDialog open onOpenChange={vi.fn()} output={OUTPUT} />)
    await waitFor(() => expect(brainsList).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: /write \+ run agent/i }))
    await waitFor(() => expect(createBundle).toHaveBeenCalled())
    await waitFor(() =>
      expect(runAgent).toHaveBeenCalledWith(
        expect.objectContaining({ bundleDir: 'C:\\repo\\handover\\x', targetDir: 'C:\\repo', brainId: 'claude-code' })
      )
    )
    // Completion is surfaced to the Activity Log.
    await waitFor(() => expect(addActivityLogEntry).toHaveBeenCalled())
  })

  it('"Copy prompt" copies via the outputs channel', async () => {
    render(<HandoverDialog open onOpenChange={vi.fn()} output={OUTPUT} />)
    fireEvent.click(screen.getByRole('button', { name: /copy prompt/i }))
    await waitFor(() => expect(copyToClipboard).toHaveBeenCalledWith(OUTPUT.content))
  })

  it('"Open in terminal" fallback launches the terminal', async () => {
    render(<HandoverDialog open onOpenChange={vi.fn()} output={OUTPUT} />)
    await waitFor(() => expect(brainsList).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: /open in terminal/i }))
    await waitFor(() => expect(launchClaudeCode).toHaveBeenCalled())
  })

  it('disables run and warns when no agentic brain is enabled + signed in', async () => {
    // Only a disabled agentic brain (codex) + a non-agentic brain.
    setApi([USABLE_BRAINS[0], USABLE_BRAINS[2]])
    render(<HandoverDialog open onOpenChange={vi.fn()} output={OUTPUT} />)
    await waitFor(() => expect(brainsList).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByRole('button', { name: /write \+ run agent/i })).toBeDisabled())
    expect(screen.getByText(/No agentic brain is enabled and signed in/i)).toBeInTheDocument()
  })

  it('greys out a disabled brain in the picker (not selectable)', async () => {
    render(<HandoverDialog open onOpenChange={vi.fn()} output={OUTPUT} />)
    await waitFor(() => expect(brainsList).toHaveBeenCalled())
    // Open the Radix Select and assert the disabled agentic brain is aria-disabled.
    fireEvent.click(screen.getByLabelText('Agent brain'))
    const codex = await screen.findByRole('option', { name: /Codex/i })
    expect(codex).toHaveAttribute('aria-disabled', 'true')
  })
})
