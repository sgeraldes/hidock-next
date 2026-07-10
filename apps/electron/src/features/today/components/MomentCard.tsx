/**
 * A single moment card in the Stream. Dispatches by `source` to render the
 * right per-type body (recording / document / image / code / diagram), but
 * shares one chrome: type badge, clickable title, summary, metadata chips,
 * entity links, and — for still-on-device recordings — a Sync & transcribe CTA.
 */

import { useNavigate } from 'react-router-dom'
import { ArrowUpRight, DownloadCloud, GitBranch, HelpCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Moment, MomentBadge, MomentLink } from '../types'
import { SOURCE_META, BADGE_TONE } from '../sourceMeta'

function Chip({ badge }: { badge: MomentBadge }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium leading-tight',
        BADGE_TONE[badge.tone ?? 'neutral']
      )}
    >
      {badge.label}
    </span>
  )
}

function LinkChip({ link }: { link: MomentLink }) {
  const navigate = useNavigate()
  const target = link.route ?? (link.kind === 'person' && link.id ? `/person/${link.id}` : undefined)
  const prefix =
    link.kind === 'meeting'
      ? 'linked'
      : link.kind === 'output'
        ? 'output'
        : link.kind === 'project'
          ? 'project'
          : link.kind === 'thread'
            ? 'thread'
            : null
  const content = (
    <>
      {prefix && <span className="text-foreground/45">{prefix}:</span>}
      <span className="truncate">{link.label}</span>
    </>
  )
  if (!target) {
    return <span className="inline-flex max-w-[16rem] items-center gap-1 truncate text-foreground/70">{content}</span>
  }
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        navigate(target, link.state ? { state: link.state } : undefined)
      }}
      className="inline-flex max-w-[16rem] items-center gap-1 truncate rounded text-foreground/70 underline-offset-2 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {content}
    </button>
  )
}

/** Per-source body under the shared title/summary. */
function MomentBody({ moment }: { moment: Moment }) {
  switch (moment.source) {
    case 'image':
      return (
        <div className="mt-2 flex items-center gap-3">
          {moment.image.thumbnailUrl && (
            <img
              src={moment.image.thumbnailUrl}
              alt=""
              className="h-14 w-20 flex-shrink-0 rounded-md border border-border object-cover"
            />
          )}
          <div className="flex flex-wrap gap-1.5">
            <Chip badge={{ label: 'screenshot', tone: 'neutral' }} />
            {moment.image.ocr && <Chip badge={{ label: 'OCR’d', tone: 'info' }} />}
            {moment.image.tableExtracted && <Chip badge={{ label: 'table extracted', tone: 'decision' }} />}
          </div>
        </div>
      )
    case 'code':
      return (
        <div className="mt-2 space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            {typeof moment.code.commitCount === 'number' && (
              <Chip
                badge={{
                  label: `${moment.code.commitCount} ${moment.code.commitCount === 1 ? 'commit' : 'commits'}`,
                  tone: 'action'
                }}
              />
            )}
            {moment.code.repo && (
              <span className="inline-flex items-center gap-1 text-xs text-foreground/60">{moment.code.repo}</span>
            )}
            {moment.code.branch && (
              <span className="inline-flex items-center gap-1 text-xs text-foreground/60">
                <GitBranch className="h-3 w-3" aria-hidden="true" />
                {moment.code.branch}
              </span>
            )}
          </div>
          {moment.code.openQuestion && (
            <div className="flex items-start gap-1.5 text-xs text-foreground/70">
              <HelpCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-500" aria-hidden="true" />
              <span>{moment.code.openQuestion}</span>
            </div>
          )}
        </div>
      )
    case 'diagram':
      return (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {moment.diagram.tool && <Chip badge={{ label: moment.diagram.tool, tone: 'neutral' }} />}
          {typeof moment.diagram.componentCount === 'number' && (
            <Chip
              badge={{
                label: `${moment.diagram.componentCount} ${moment.diagram.componentCount === 1 ? 'component' : 'components'}`,
                tone: 'action'
              }}
            />
          )}
        </div>
      )
    default:
      return null
  }
}

export function MomentCard({ moment }: { moment: Moment }) {
  const navigate = useNavigate()
  const meta = SOURCE_META[moment.source]
  const { Icon } = meta

  const openMoment = () => {
    if (moment.open) navigate(moment.open.route, moment.open.state ? { state: moment.open.state } : undefined)
  }

  return (
    <article
      data-testid="moment-card"
      data-source={moment.source}
      className="group rounded-xl border border-border/70 bg-card p-4 shadow-sm transition-colors hover:border-border dark:border-white/[0.06]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {/* Type badge + clickable title */}
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide',
                meta.badge
              )}
            >
              <Icon className="h-3 w-3" aria-hidden="true" />
              {meta.short}
            </span>
          </div>
          <button
            onClick={openMoment}
            disabled={!moment.open}
            data-testid="moment-title"
            className={cn(
              'mt-1.5 block max-w-full truncate text-left text-sm font-semibold text-foreground',
              moment.open &&
                'rounded transition-colors group-hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
            )}
          >
            {moment.title}
          </button>
          {moment.summary && (
            <p className="mt-0.5 line-clamp-1 text-xs text-foreground/60">{moment.summary}</p>
          )}
        </div>
        {moment.open && (
          <ArrowUpRight
            className="h-4 w-4 flex-shrink-0 text-foreground/30 transition-colors group-hover:text-primary"
            aria-hidden="true"
          />
        )}
      </div>

      {/* Metadata chips */}
      {moment.badges.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {moment.badges.map((b, i) => (
            <Chip key={i} badge={b} />
          ))}
        </div>
      )}

      <MomentBody moment={moment} />

      {/* Entity links */}
      {moment.links.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          {moment.links.slice(0, 6).map((l, i) => (
            <LinkChip key={i} link={l} />
          ))}
        </div>
      )}

      {/* Still-on-device → sync & transcribe */}
      {moment.stillOnDevice && (
        <div className="mt-3">
          <button
            onClick={(e) => {
              e.stopPropagation()
              navigate('/sync')
            }}
            data-testid="sync-transcribe"
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <DownloadCloud className="h-3.5 w-3.5" aria-hidden="true" />
            Sync &amp; transcribe
          </button>
        </div>
      )}
    </article>
  )
}

export default MomentCard
