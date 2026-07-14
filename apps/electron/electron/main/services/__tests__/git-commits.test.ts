import { describe, it, expect, vi, beforeEach } from 'vitest'

// execFileAsync = promisify(execFile). We mock child_process.execFile with a
// callback-style function; promisify (no custom symbol on the mock) resolves with
// the first non-error callback argument, so calling cb(null, { stdout }) yields
// `{ stdout }` back to the service. Never touches real git.
const mockExecFile = vi.fn()
vi.mock('child_process', () => {
  const execFile = (...args: any[]) => mockExecFile(...args)
  return { execFile, default: { execFile } }
})

import { getTodayCommits, parseGitLog, isSameLocalDay } from '../git-commits'

const FIELD = '\x1f'

/** Build one `git log` line in the service's `%H\x1f%h\x1f%aI\x1f%s` format. */
function logLine(hash: string, shortHash: string, authoredAt: string, subject: string): string {
  return [hash, shortHash, authoredAt, subject].join(FIELD)
}

/** ISO author date at a given hour on the SAME local day as `ref`. */
function isoToday(ref: Date, hour: number, minute = 0): string {
  const d = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate(), hour, minute, 0)
  return d.toISOString()
}

/** ISO author date on the day BEFORE `ref` (still local). */
function isoYesterday(ref: Date, hour = 12): string {
  const d = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() - 1, hour, 0, 0)
  return d.toISOString()
}

/**
 * Route the mocked execFile by git subcommand. `responses` maps:
 *   'toplevel:<dir>' → repo root string (or the literal 'ENOENT' to simulate no git)
 *   'branch:<root>'  → branch name
 *   'log:<root>'     → raw stdout for `git log`
 */
function routeGit(responses: Record<string, string>) {
  mockExecFile.mockImplementation((_cmd: string, args: string[], _opts: any, cb: any) => {
    const cwd = _opts?.cwd
    const sub = args[0]
    let key = ''
    if (sub === 'rev-parse' && args.includes('--show-toplevel')) key = `toplevel:${cwd}`
    else if (sub === 'rev-parse' && args.includes('--abbrev-ref')) key = `branch:${cwd}`
    else if (sub === 'log') key = `log:${cwd}`

    const value = responses[key]
    if (value === undefined || value === 'ENOENT') {
      const err: any = new Error('git failure')
      cb(err)
      return
    }
    cb(null, { stdout: value, stderr: '' })
  })
}

describe('git-commits service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('isSameLocalDay', () => {
    it('is true for two times on the same local day', () => {
      expect(isSameLocalDay(new Date(2026, 6, 10, 1, 0), new Date(2026, 6, 10, 23, 59))).toBe(true)
    })
    it('is false across a day boundary', () => {
      expect(isSameLocalDay(new Date(2026, 6, 10, 23, 59), new Date(2026, 6, 11, 0, 1))).toBe(false)
    })
  })

  describe('parseGitLog', () => {
    it('parses field-delimited lines into commits', () => {
      const stdout = [
        logLine('a'.repeat(40), 'aaaaaaa', '2026-07-10T10:00:00+00:00', 'feat: add thing'),
        logLine('b'.repeat(40), 'bbbbbbb', '2026-07-10T09:00:00+00:00', 'fix: subject with · dots')
      ].join('\n')
      const parsed = parseGitLog(stdout)
      expect(parsed).toHaveLength(2)
      expect(parsed[0]).toMatchObject({ shortHash: 'aaaaaaa', subject: 'feat: add thing' })
      expect(parsed[1].subject).toBe('fix: subject with · dots')
    })

    it('skips blank and malformed lines', () => {
      const stdout = ['', 'not-a-valid-line', logLine('c'.repeat(40), 'ccccccc', '2026-07-10T08:00:00Z', 'ok')].join('\n')
      const parsed = parseGitLog(stdout)
      expect(parsed).toHaveLength(1)
      expect(parsed[0].shortHash).toBe('ccccccc')
    })
  })

  describe('getTodayCommits', () => {
    const now = new Date()
    const root = '/repo/project'

    it('returns only commits authored on the current local day, newest first', async () => {
      const stdout = [
        logLine('1'.repeat(40), '1111111', isoToday(now, 9), 'earlier today'),
        logLine('2'.repeat(40), '2222222', isoToday(now, 14), 'later today'),
        logLine('3'.repeat(40), '3333333', isoYesterday(now), 'yesterday — excluded')
      ].join('\n')
      routeGit({
        [`toplevel:${root}`]: `${root}\n`,
        [`branch:${root}`]: 'feat/today-timeline\n',
        [`log:${root}`]: stdout
      })

      const commits = await getTodayCommits({ repoPaths: [root], now })

      expect(commits).toHaveLength(2)
      // Newest first
      expect(commits[0].subject).toBe('later today')
      expect(commits[1].subject).toBe('earlier today')
      expect(commits.every((c) => c.repo === 'project')).toBe(true)
      expect(commits[0].branch).toBe('feat/today-timeline')
      expect(commits.some((c) => c.subject.includes('yesterday'))).toBe(false)
    })

    it('returns an empty list when the path is not a git repo', async () => {
      routeGit({ [`toplevel:/not/a/repo`]: 'ENOENT' })
      const commits = await getTodayCommits({ repoPaths: ['/not/a/repo'], now })
      expect(commits).toEqual([])
    })

    it('de-duplicates repos so the same root is not read twice', async () => {
      const stdout = logLine('a'.repeat(40), 'aaaaaaa', isoToday(now, 10), 'only once')
      // Both subdirs resolve to the same root.
      routeGit({
        [`toplevel:${root}/apps/electron`]: `${root}\n`,
        [`toplevel:${root}/apps/web`]: `${root}\n`,
        [`branch:${root}`]: 'main\n',
        [`log:${root}`]: stdout
      })

      const commits = await getTodayCommits({
        repoPaths: [`${root}/apps/electron`, `${root}/apps/web`],
        now
      })

      expect(commits).toHaveLength(1)
      expect(commits[0].subject).toBe('only once')
    })

    it('tolerates a detached HEAD (empty branch) without throwing', async () => {
      routeGit({
        [`toplevel:${root}`]: `${root}\n`,
        // branch lookup fails (detached) — service should treat branch as ''
        [`log:${root}`]: logLine('a'.repeat(40), 'aaaaaaa', isoToday(now, 11), 'detached work')
      })
      const commits = await getTodayCommits({ repoPaths: [root], now })
      expect(commits).toHaveLength(1)
      expect(commits[0].branch).toBe('')
    })
  })
})
