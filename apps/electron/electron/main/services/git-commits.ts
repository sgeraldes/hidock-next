/**
 * Git Commits Service (main process)
 *
 * Surfaces TODAY's git commits as CODE moments for the Today agenda — the same
 * spirit as the "Also captured today" captures, but for the work you shipped in
 * code. Reads the system `git` CLI (read-only `git log`) against the current
 * project repo by default, plus any extra repo paths the caller supplies.
 *
 * Design notes:
 *  - **Read-only, always.** We only ever run `rev-parse` and `log`. Never write.
 *  - **Author-dated to the current local day.** A commit belongs to "today" when
 *    its AUTHOR date falls on the current local calendar day. (Author date is the
 *    "when the work was done" timestamp; rebases/amends preserve it.) We fetch a
 *    generous recent window and filter precisely in JS so the boundary is exact
 *    and testable, independent of `git`'s committer-date `--since` semantics.
 *  - **Guarded.** A missing `git`, a non-repo directory, or any git error yields
 *    an empty result for that path — never a throw that breaks the agenda.
 */

import { execFile } from 'child_process'
import { promisify } from 'util'
import { basename } from 'path'

const execFileAsync = promisify(execFile)

/** ASCII unit separator — safe field delimiter inside a single `git log` line. */
const FIELD = '\x1f'

/** How many recent commits to inspect per repo before the today filter. */
const MAX_COMMITS = 300

/** A single commit authored today, ready for the Today agenda. */
export interface TodayCommit {
  /** Repo display name (basename of the repository root). */
  repo: string
  /** Absolute repository root (useful for future deep-links; not shown directly). */
  repoPath: string
  /** Current branch of the repo (best-effort; empty string if detached/unknown). */
  branch: string
  /** Full commit hash. */
  hash: string
  /** Abbreviated commit hash. */
  shortHash: string
  /** First line of the commit message. */
  subject: string
  /** Author date, ISO-8601 with offset (e.g. `2026-07-10T14:03:11+02:00`). */
  authoredAt: string
}

/** True when both dates fall on the same calendar day in the local timezone. */
export function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024
  })
  return stdout
}

/**
 * Resolve a directory to its repository root + current branch, or `null` when the
 * directory is not inside a git repo (or `git` is unavailable). `git rev-parse
 * --show-toplevel` walks up parent directories, so passing a subdirectory of the
 * repo (e.g. `apps/electron`) still resolves the repo root.
 */
export async function getRepoInfo(dir: string): Promise<{ root: string; branch: string } | null> {
  try {
    const root = (await runGit(dir, ['rev-parse', '--show-toplevel'])).trim()
    if (!root) return null
    let branch = ''
    try {
      branch = (await runGit(root, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
    } catch {
      branch = '' // detached HEAD or unusual state — non-fatal
    }
    return { root, branch }
  } catch {
    return null // not a repo / git missing — caller skips this path
  }
}

/** Raw fields parsed out of one `git log` line, before the today filter. */
export interface RawCommit {
  hash: string
  shortHash: string
  authoredAt: string
  subject: string
}

/** Parse the `--pretty` output (one commit per line, `FIELD`-delimited). */
export function parseGitLog(stdout: string): RawCommit[] {
  const out: RawCommit[] = []
  for (const raw of stdout.split('\n')) {
    const line = raw.replace(/\r$/, '')
    if (!line) continue
    const parts = line.split(FIELD)
    if (parts.length < 4) continue
    const [hash, shortHash, authoredAt, ...rest] = parts
    if (!hash || !authoredAt) continue
    out.push({ hash, shortHash, authoredAt, subject: rest.join(FIELD) })
  }
  return out
}

/** Today's commits for a single already-resolved repo root, newest first. */
async function commitsForRepo(root: string, branch: string, now: Date): Promise<TodayCommit[]> {
  let stdout = ''
  try {
    stdout = await runGit(root, [
      'log',
      `--max-count=${MAX_COMMITS}`,
      `--pretty=format:%H${FIELD}%h${FIELD}%aI${FIELD}%s`
    ])
  } catch {
    return [] // empty repo (no commits yet) or git error — non-fatal
  }
  const repo = basename(root)
  const out: TodayCommit[] = []
  for (const c of parseGitLog(stdout)) {
    const authored = new Date(c.authoredAt)
    if (isNaN(authored.getTime()) || !isSameLocalDay(authored, now)) continue
    out.push({
      repo,
      repoPath: root,
      branch,
      hash: c.hash,
      shortHash: c.shortHash,
      subject: c.subject,
      authoredAt: c.authoredAt
    })
  }
  return out
}

export interface GetTodayCommitsOptions {
  /**
   * Repo directories to read. When omitted/empty, defaults to the current
   * project repo (resolved from `process.cwd()`). Each entry may be any
   * subdirectory of a repo — it is resolved to the repo root and de-duplicated.
   */
  repoPaths?: string[]
  /** Clock override for tests; defaults to `new Date()`. */
  now?: Date
}

/**
 * All commits authored today across the configured repos, newest first.
 *
 * Repos are de-duplicated by resolved root, so passing several subdirectories of
 * the same repo (or the same path twice) yields one repo's commits, not copies.
 */
export async function getTodayCommits(options: GetTodayCommitsOptions = {}): Promise<TodayCommit[]> {
  const now = options.now ?? new Date()
  const dirs =
    options.repoPaths && options.repoPaths.length > 0
      ? options.repoPaths
      : [process.cwd()]

  // Resolve to unique repo roots (first branch seen wins per root).
  const roots = new Map<string, string>()
  for (const dir of dirs) {
    if (!dir) continue
    const info = await getRepoInfo(dir)
    if (!info) continue
    if (!roots.has(info.root)) roots.set(info.root, info.branch)
  }

  const all: TodayCommit[] = []
  for (const [root, branch] of roots) {
    all.push(...(await commitsForRepo(root, branch, now)))
  }

  all.sort((a, b) => new Date(b.authoredAt).getTime() - new Date(a.authoredAt).getTime())
  return all
}
