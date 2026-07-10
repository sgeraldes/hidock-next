import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { TodayCommits } from '../TodayCommits'
import type { TodayCommit } from '../useTodayCommits'

function commit(overrides: Partial<TodayCommit> & { hash: string; shortHash: string; subject: string }): TodayCommit {
  return {
    repo: 'project',
    repoPath: '/repo/project',
    branch: 'main',
    authoredAt: '2026-07-10T10:00:00+00:00',
    ...overrides
  }
}

function setCommitsApi(commits: TodayCommit[], success = true, error?: string) {
  const today = vi.fn().mockResolvedValue({ success, commits, error })
  ;(window as unknown as { electronAPI?: unknown }).electronAPI = { commits: { today } }
  return today
}

describe('TodayCommits', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    delete (window as unknown as { electronAPI?: unknown }).electronAPI
  })

  it('renders nothing when there are no commits today', async () => {
    setCommitsApi([])
    const { container } = render(<TodayCommits />)
    await waitFor(() => expect(window.electronAPI.commits.today).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId('today-commits')).not.toBeInTheDocument()
  })

  it('renders nothing when the electronAPI bridge is absent', () => {
    delete (window as unknown as { electronAPI?: unknown }).electronAPI
    const { container } = render(<TodayCommits />)
    expect(container).toBeEmptyDOMElement()
  })

  it("lists today's commits grouped per repo with a total count", async () => {
    setCommitsApi([
      commit({ hash: '1'.repeat(40), shortHash: '1111111', subject: 'later today', authoredAt: '2026-07-10T14:00:00Z' }),
      commit({ hash: '2'.repeat(40), shortHash: '2222222', subject: 'earlier today', authoredAt: '2026-07-10T09:00:00Z' }),
      commit({
        hash: '3'.repeat(40),
        shortHash: '3333333',
        subject: 'web change',
        repo: 'web-app',
        repoPath: '/repo/web-app',
        branch: 'feat/x'
      })
    ])

    render(<TodayCommits />)

    await waitFor(() => expect(screen.getByTestId('today-commits')).toBeInTheDocument())
    expect(screen.getByText('Commits today')).toBeInTheDocument()
    expect(screen.getByText('3 commits')).toBeInTheDocument()
    // Two repo groups
    expect(screen.getAllByTestId('today-commit-repo')).toHaveLength(2)
    expect(screen.getByText('project')).toBeInTheDocument()
    expect(screen.getByText('web-app')).toBeInTheDocument()
    expect(screen.getByText('feat/x')).toBeInTheDocument()
    // All three commit rows
    expect(screen.getAllByTestId('today-commit-row')).toHaveLength(3)
    expect(screen.getByText('later today')).toBeInTheDocument()
    expect(screen.getByText('earlier today')).toBeInTheDocument()
  })

  it('copies the full hash to the clipboard when the hash chip is clicked', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    setCommitsApi([commit({ hash: 'deadbeef'.repeat(5), shortHash: 'deadbee', subject: 'copy me' })])

    render(<TodayCommits />)
    await waitFor(() => expect(screen.getByTestId('today-commit-row')).toBeInTheDocument())

    fireEvent.click(screen.getByText('deadbee'))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('deadbeef'.repeat(5)))
  })
})
