import { useState } from 'react'
import { GitCommitHorizontal, GitBranch, Check, Copy } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { useTodayCommits, type RepoCommitGroup, type TodayCommit } from './useTodayCommits'

function formatTime(iso: string): string {
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/** Per-repo header: "N commits · branch". */
function RepoHeader({ group }: { group: RepoCommitGroup }) {
  const n = group.commits.length
  return (
    <div className="flex items-center gap-2 px-1 text-xs">
      <span className="truncate font-semibold text-foreground">{group.repo}</span>
      <span className="text-muted-foreground">
        · {n} {n === 1 ? 'commit' : 'commits'}
      </span>
      {group.branch && (
        <span className="flex min-w-0 items-center gap-1 text-muted-foreground">
          ·
          <GitBranch className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
          <span className="truncate font-mono">{group.branch}</span>
        </span>
      )}
    </div>
  )
}

/** One commit row: short hash (click to copy) + subject + time. */
function CommitRow({ commit, index }: { commit: TodayCommit; index: number }) {
  const [copied, setCopied] = useState(false)
  const time = formatTime(commit.authoredAt)

  const copyHash = async () => {
    try {
      await navigator.clipboard?.writeText(commit.hash)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      /* clipboard unavailable — non-fatal */
    }
  }

  return (
    <div
      data-testid="today-commit-row"
      style={{ animationDelay: `${Math.min(index, 6) * 40}ms` }}
      className="group animate-rise-in flex items-center gap-3 rounded-lg border p-2.5 transition-colors hover:bg-muted/50"
    >
      <button
        onClick={copyHash}
        title={copied ? 'Copied' : `Copy ${commit.hash}`}
        aria-label={copied ? 'Commit hash copied' : `Copy full hash for ${commit.shortHash}`}
        className={cn(
          'flex flex-shrink-0 items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] font-medium text-foreground/70 transition-colors',
          'hover:bg-muted-foreground/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
        )}
      >
        {copied ? (
          <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-500" aria-hidden="true" />
        ) : (
          <Copy className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
        )}
        {commit.shortHash}
      </button>
      <span className="min-w-0 flex-1 truncate text-sm text-foreground/85">{commit.subject}</span>
      {time && <span className="flex-shrink-0 text-[11px] tabular-nums text-muted-foreground">{time}</span>}
    </div>
  )
}

/**
 * "Commits today" — an ADDITION to the Today agenda surfacing the day's git
 * commits as CODE moments, grouped per repo. Same spirit as "Also captured
 * today": strictly current-day scoped, and renders nothing when there are no
 * commits today (no empty scaffolding).
 *
 * @param repoPaths optional extra repo paths; defaults to the project repo.
 */
export function TodayCommits({ repoPaths }: { repoPaths?: string[] } = {}) {
  const { groups, total } = useTodayCommits(repoPaths)

  if (total === 0) return null

  return (
    <Card className="animate-rise-in" data-testid="today-commits">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base">
          <span className="flex items-center gap-2">
            <GitCommitHorizontal className="h-4 w-4 text-foreground/60" />
            Commits today
          </span>
          <span className="text-xs font-normal text-muted-foreground">
            {total} {total === 1 ? 'commit' : 'commits'}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {groups.map((group) => (
          <div key={group.repoPath} className="space-y-2" data-testid="today-commit-repo">
            <RepoHeader group={group} />
            <div className="space-y-1.5">
              {group.commits.map((c, i) => (
                <CommitRow key={c.hash} commit={c} index={i} />
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

export default TodayCommits
