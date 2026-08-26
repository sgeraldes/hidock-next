import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ipcMain } from 'electron'
import { registerGitCommitsHandlers } from '../git-commits-handlers'
import { getTodayCommits, type TodayCommit } from '../../services/git-commits'

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn()
  }
}))

vi.mock('../../services/git-commits', () => ({
  getTodayCommits: vi.fn()
}))

const sampleCommit: TodayCommit = {
  repo: 'project',
  repoPath: '/repo/project',
  branch: 'main',
  hash: 'a'.repeat(40),
  shortHash: 'aaaaaaa',
  subject: 'feat: add today commits',
  authoredAt: '2026-07-10T10:00:00+00:00'
}

describe('Git Commits IPC Handlers', () => {
  let handlers: Record<string, (...args: any[]) => any> = {}

  beforeEach(() => {
    vi.clearAllMocks()
    handlers = {}
    vi.mocked(ipcMain.handle).mockImplementation((channel: string, handler: (...args: any[]) => any) => {
      handlers[channel] = handler
      return undefined as any
    })
    registerGitCommitsHandlers()
  })

  it('registers the commits:today channel', () => {
    expect(ipcMain.handle).toHaveBeenCalledWith('commits:today', expect.any(Function))
  })

  it('returns today commits from the service', async () => {
    vi.mocked(getTodayCommits).mockResolvedValue([sampleCommit])
    const res = await handlers['commits:today']({}, undefined)
    expect(res).toEqual({ success: true, commits: [sampleCommit] })
    expect(getTodayCommits).toHaveBeenCalledWith({ repoPaths: undefined })
  })

  it('forwards a valid string[] repoPaths argument', async () => {
    vi.mocked(getTodayCommits).mockResolvedValue([])
    await handlers['commits:today']({}, ['/a', '/b', 42, ''])
    // Non-strings and empties are filtered out before reaching the service.
    expect(getTodayCommits).toHaveBeenCalledWith({ repoPaths: ['/a', '/b'] })
  })

  it('returns a soft error result when the service throws', async () => {
    vi.mocked(getTodayCommits).mockRejectedValue(new Error('git exploded'))
    const res = await handlers['commits:today']({}, undefined)
    expect(res).toEqual({ success: false, commits: [], error: 'git exploded' })
  })
})
