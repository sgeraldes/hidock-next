/**
 * Git Commits IPC Handlers
 *
 * Channel:
 *   commits:today(repoPaths?)  → today's git commits (author-dated to the current
 *                                local day) across the project repo + optional
 *                                extra repo paths. Read-only.
 *
 * Exposed to the renderer as `window.electronAPI.commits.today()`.
 */

import { ipcMain } from 'electron'
import { getTodayCommits, type TodayCommit } from '../services/git-commits'

export interface TodayCommitsResult {
  success: boolean
  commits: TodayCommit[]
  error?: string
}

export function registerGitCommitsHandlers(): void {
  ipcMain.handle('commits:today', async (_event, repoPaths?: unknown): Promise<TodayCommitsResult> => {
    try {
      const paths = Array.isArray(repoPaths)
        ? repoPaths.filter((p): p is string => typeof p === 'string' && p.length > 0)
        : undefined
      const commits = await getTodayCommits({ repoPaths: paths })
      return { success: true, commits }
    } catch (error) {
      return {
        success: false,
        commits: [],
        error: error instanceof Error ? error.message : String(error)
      }
    }
  })
}
