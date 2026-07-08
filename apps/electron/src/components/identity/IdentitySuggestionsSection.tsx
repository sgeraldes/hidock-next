import { forwardRef, useImperativeHandle, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ChevronDown,
  ChevronRight,
  Check,
  X,
  Sparkles,
  Users,
  ArrowRight,
  Mail,
  Briefcase,
  CalendarDays,
  AlertTriangle,
  FileText,
  MoreVertical,
  UserSearch,
  Ban,
  ExternalLink,
  Network
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu'
import { toast } from '@/components/ui/toaster'
import { EntityMention } from '@/components/entity'
import { cn, formatDate } from '@/lib/utils'
import {
  useIdentitySuggestions,
  type IdentitySuggestion,
  type MiniProfile,
  type MergeImpact
} from './useIdentitySuggestions'
import { parseEvidence, evidenceToPhrases, topicChips } from './evidenceToPhrases'
import { groupSuggestions, TIER_LABEL, type SuggestionTier } from './groupSuggestions'
import { computeCoMention, mentionKey, mentionStatus, type MentionResult } from './mentionEvidence'
import { computeSharedContext, type PersonContext, type SideContext } from './personContext'
import { MergeIntoDialog } from './MergeIntoDialog'

/** Confidence → badge styling. ≥80 emerald, 50–79 amber. */
function confidenceBadge(confidence: number | null): { label: string; className: string } {
  const pct = Math.round((confidence ?? 0) * 100)
  const className =
    pct >= 80
      ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
      : 'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300'
  return { label: `${pct}%`, className }
}

/** Quoted transcript excerpts where a name literally occurs — the primary source. */
function SnippetList({
  mentions,
  onOpenRecording
}: {
  mentions?: MentionResult
  onOpenRecording: (recordingId: string) => void
}) {
  const snippets = mentions?.snippets ?? []
  if (snippets.length === 0) return null
  return (
    <div className="space-y-1">
      {snippets.map((s) => (
        <button
          key={s.recordingId}
          type="button"
          onClick={() => onOpenRecording(s.recordingId)}
          className="block w-full text-left rounded-md border-l-2 border-muted-foreground/30 bg-muted/30 px-2 py-1 hover:bg-muted/60 transition-colors"
          aria-label={`Open transcript: ${s.title}`}
        >
          <span className="text-xs italic text-muted-foreground">&ldquo;{s.snippet}&rdquo;</span>
          <span className="mt-0.5 block text-[10px] text-muted-foreground/80 truncate">
            {s.title}
            {s.date ? ` · ${formatDate(s.date)}` : ''}
          </span>
        </button>
      ))}
    </div>
  )
}

/**
 * The graph-neighborhood context row for one side (B7 symmetric context): the
 * people this side most co-attends with and its closest topics/projects. SHARED
 * entries (present on both sides) are primary-tinted — corroborating evidence that
 * the two records are one person; a fully disjoint row reads as "different circles".
 */
function ContextChips({ context }: { context?: SideContext }) {
  const chips = context ? [...context.people, ...context.topics] : []
  if (chips.length === 0) return null
  return (
    <div className="mt-1.5 flex flex-wrap gap-1" aria-label="Related context">
      {chips.map((c, i) => (
        <span
          key={`${c.label}-${i}`}
          className={cn(
            'inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] leading-none',
            c.shared
              ? 'border-primary/40 bg-primary/10 text-primary font-medium'
              : 'border-border bg-muted/40 text-muted-foreground'
          )}
          title={c.shared ? 'Shared by both — merge evidence' : undefined}
        >
          {c.label}
        </span>
      ))}
    </div>
  )
}

/**
 * A profile block for one side of a proposed merge. Both sides render with equal
 * weight (B7 symmetry): identity fields when present, and ALWAYS the mention count
 * + primary-source excerpts, so the "duplicate" side is never a bare chip.
 */
function MiniProfileCard({
  kind,
  id,
  name,
  profile,
  role,
  mentions,
  context,
  onOpenRecording
}: {
  kind: 'person' | 'project'
  id?: string
  name: string
  profile?: MiniProfile
  role: 'keeper' | 'candidate'
  mentions?: MentionResult
  context?: SideContext
  onOpenRecording: (recordingId: string) => void
}) {
  const displayName = profile?.name || name
  const roleCompany = [profile?.role, profile?.company].filter(Boolean).join(' · ')
  const status = mentionStatus(mentions)
  return (
    <div
      className={cn(
        'flex-1 min-w-0 rounded-lg border p-2.5',
        role === 'keeper' ? 'border-emerald-500/30 bg-emerald-500/[0.04]' : 'border-border bg-muted/30'
      )}
    >
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {role === 'keeper' ? 'Keeps' : kind === 'person' ? 'Duplicate' : 'Alias'}
        </span>
      </div>
      <EntityMention type={kind} id={id} name={displayName} showIcon />
      <div className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
        {roleCompany && (
          <div className="flex items-center gap-1 truncate">
            <Briefcase className="h-3 w-3 flex-shrink-0" />
            <span className="truncate">{roleCompany}</span>
          </div>
        )}
        {profile?.email && (
          <div className="flex items-center gap-1 truncate">
            <Mail className="h-3 w-3 flex-shrink-0" />
            <span className="truncate">{profile.email}</span>
          </div>
        )}
        {typeof profile?.meetingCount === 'number' && (
          <div className="flex items-center gap-1">
            <CalendarDays className="h-3 w-3 flex-shrink-0" />
            <span>
              {profile.meetingCount} meeting{profile.meetingCount === 1 ? '' : 's'}
            </span>
          </div>
        )}
        {profile?.description && <div className="truncate">{profile.description}</div>}
        <div
          className={cn(
            'flex items-center gap-1 pt-0.5',
            status.state === 'extracted' && 'italic text-muted-foreground/70',
            status.state === 'error' && 'text-amber-600 dark:text-amber-400'
          )}
        >
          <FileText className="h-3 w-3 flex-shrink-0" />
          <span>{status.text}</span>
        </div>
      </div>
      <div className="mt-1.5">
        <SnippetList mentions={mentions} onOpenRecording={onOpenRecording} />
      </div>
      <ContextChips context={context} />
    </div>
  )
}

/** Highest link count that still merges on one click; above it, type-to-confirm. */
const MERGE_LINK_THRESHOLD = 10

/** Human "blast radius" line for a merge, from link counts + moved recordings. */
function ImpactPreview({
  impact,
  movedRecordings,
  keeperName
}: {
  impact?: MergeImpact
  movedRecordings: number
  keeperName: string
}) {
  if (!impact) return null
  const total = impact.keeper + impact.loser
  const highStakes = impact.keeper > MERGE_LINK_THRESHOLD || impact.loser > MERGE_LINK_THRESHOLD
  const parts: string[] = []
  if (movedRecordings > 0) parts.push(`${movedRecordings} recording${movedRecordings === 1 ? '' : 's'}`)
  parts.push(`${impact.loser} link${impact.loser === 1 ? '' : 's'}`)
  return (
    <p className="text-[11px] text-muted-foreground">
      Merging moves {parts.join(' + ')} onto <span className="font-medium">{keeperName}</span> ({total} total
      afterward).
      {highStakes && (
        <span className="text-amber-600 dark:text-amber-400">
          {' '}
          High-impact — you&rsquo;ll confirm by typing the name.
        </span>
      )}
    </p>
  )
}

/** One accept/reject decision: side-by-side profiles, evidence, primary-source
 *  excerpts, the co-presence disproof, impact preview, survivor line, and buttons. */
function CandidateDecision({
  suggestion,
  keeper,
  loser,
  keeperName,
  candidateMentions,
  keeperMentions,
  keeperContext,
  candidateContext,
  coMention,
  impact,
  onAccept,
  onReject,
  onMergeInto,
  onOpenRecording,
  onOpenProfile
}: {
  suggestion: IdentitySuggestion
  keeper?: MiniProfile
  loser?: MiniProfile
  keeperName: string
  candidateMentions?: MentionResult
  keeperMentions?: MentionResult
  keeperContext?: PersonContext
  candidateContext?: PersonContext
  coMention: boolean
  impact?: MergeImpact
  onAccept: (id: string) => void
  onReject: (id: string) => void
  onMergeInto: (suggestionId: string, keeperId: string, loserId: string, keeperName: string) => void
  onOpenRecording: (recordingId: string) => void
  onOpenProfile: (id: string) => void
}) {
  const ev = parseEvidence(suggestion.evidence)
  const loserName = suggestion.candidate_name
  const phrases = evidenceToPhrases(ev, loserName, keeperName)
  const topics = topicChips(ev)
  const badge = confidenceBadge(suggestion.confidence)
  // Co-presence is decisive negative evidence — never lead with a filled "merge".
  const strong = (suggestion.confidence ?? 0) >= 0.8 && !coMention
  const movedRecordings = candidateMentions?.recordingIds.length ?? 0
  const highStakes = !!impact && (impact.keeper > MERGE_LINK_THRESHOLD || impact.loser > MERGE_LINK_THRESHOLD)

  // Base-rate framing: a fuzzy match on a common name proves little on its own.
  const isCommonName = ev.rarity === 'common'
  // Both sides' graph neighborhoods, with shared entries highlighted (B7 context).
  const comparison =
    suggestion.kind === 'person'
      ? computeSharedContext(
          keeperContext ?? { people: [], topics: [] },
          candidateContext ?? { people: [], topics: [] }
        )
      : undefined
  // The reviewed duplicate's own contact id — required to re-route the merge.
  const loserId = ev.loserId
  const canMergeElsewhere = suggestion.kind === 'person' && !!loserId

  const [pickerOpen, setPickerOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const confirmMatches = confirmText.trim() === loserName.trim()

  const openBothProfiles = () => {
    if (suggestion.kind !== 'person') return
    onOpenProfile(suggestion.target_id)
    if (loserId) {
      toast.info(`Opened ${keeperName}`, `Also review '${loserName}' to compare in full.`)
    }
  }

  const handleAccept = () => {
    if (highStakes && !confirming) {
      setConfirming(true)
      return
    }
    onAccept(suggestion.id)
  }

  return (
    <div className="space-y-2.5">
      <div className="flex items-stretch gap-2">
        <MiniProfileCard
          kind={suggestion.kind}
          id={suggestion.target_id}
          name={keeperName}
          profile={keeper}
          role="keeper"
          mentions={keeperMentions}
          context={comparison?.a}
          onOpenRecording={onOpenRecording}
        />
        <div className="flex items-center">
          <ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden />
        </div>
        <MiniProfileCard
          kind={suggestion.kind}
          id={ev.loserId}
          name={loserName}
          profile={loser}
          role="candidate"
          mentions={candidateMentions}
          context={comparison?.b}
          onOpenRecording={onOpenRecording}
        />
      </div>

      {comparison?.disjoint && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/[0.06] px-2.5 py-1.5 text-[11px] text-amber-700 dark:text-amber-300">
          <Network className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" aria-hidden />
          <span>Different circles — no shared people or topics between the two.</span>
        </div>
      )}

      {isCommonName && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/[0.06] px-2.5 py-1.5 text-[11px] text-amber-700 dark:text-amber-300">
          <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" aria-hidden />
          <span>Common name — verify carefully; the name alone is weak evidence.</span>
        </div>
      )}

      {coMention && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-2 text-xs text-red-700 dark:text-red-300"
        >
          <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
          <span>
            Both names appear in the same conversation — <span className="font-semibold">likely different people</span>.
          </span>
        </div>
      )}

      <p className="text-xs">
        Keeps <span className="font-semibold">{keeperName}</span> —{' '}
        <span className="font-medium">&lsquo;{loserName}&rsquo;</span> becomes an alias
      </p>

      {phrases.length > 0 && (
        <ul className="text-xs text-muted-foreground space-y-0.5 list-disc pl-4">
          {phrases.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
      )}

      {topics.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {topics.map((t) => (
            <span
              key={t}
              className="inline-flex items-center rounded-full border bg-muted/50 px-2 py-0.5 text-[10px] text-muted-foreground"
            >
              {t}
            </span>
          ))}
        </div>
      )}

      <ImpactPreview impact={impact} movedRecordings={movedRecordings} keeperName={keeperName} />

      {confirming && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 space-y-1.5">
          <label className="block text-[11px] text-amber-700 dark:text-amber-300">
            High-impact merge. Type <span className="font-semibold">{loserName}</span> to confirm.
          </label>
          <input
            autoFocus
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={loserName}
            aria-label={`Type ${loserName} to confirm merge`}
            className="w-full rounded-md border bg-background px-2 py-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      )}

      <div className="flex items-center gap-2">
        <span
          className={cn(
            'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
            badge.className
          )}
        >
          {badge.label}
        </span>
        <div className="flex-1" />
        {confirming && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7"
            onClick={() => {
              setConfirming(false)
              setConfirmText('')
            }}
          >
            Cancel
          </Button>
        )}
        <Button
          size="sm"
          variant={strong && !confirming ? 'default' : 'outline'}
          className="h-7"
          disabled={confirming && !confirmMatches}
          onClick={handleAccept}
          aria-label={confirming ? `Confirm merge of '${loserName}' into ${keeperName}` : `Merge '${loserName}' into ${keeperName}`}
        >
          <Check className="h-3.5 w-3.5 mr-1" />
          {confirming ? 'Confirm merge' : 'Yes, merge'}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className={cn('h-7', coMention && 'ring-2 ring-red-500/40')}
          onClick={() => onReject(suggestion.id)}
          aria-label={`Keep '${loserName}' separate from ${keeperName}`}
        >
          <X className="h-3.5 w-3.5 mr-1" />
          No
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              aria-label={`More options for '${loserName}'`}
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {canMergeElsewhere && (
              <DropdownMenuItem onSelect={() => setPickerOpen(true)}>
                <UserSearch className="h-4 w-4 mr-2 text-muted-foreground" />
                Merge into someone else…
              </DropdownMenuItem>
            )}
            {suggestion.kind === 'person' && (
              <DropdownMenuItem onSelect={openBothProfiles}>
                <ExternalLink className="h-4 w-4 mr-2 text-muted-foreground" />
                Open both profiles
              </DropdownMenuItem>
            )}
            {(canMergeElsewhere || suggestion.kind === 'person') && <DropdownMenuSeparator />}
            <DropdownMenuItem onSelect={() => onReject(suggestion.id)}>
              <Ban className="h-4 w-4 mr-2 text-muted-foreground" />
              Reject and don&rsquo;t ask again
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {canMergeElsewhere && loserId && (
        <MergeIntoDialog
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          loserName={loserName}
          excludeIds={[suggestion.target_id, loserId]}
          onPick={(chosenId, chosenName) => onMergeInto(suggestion.id, chosenId, loserId, chosenName)}
        />
      )}
    </div>
  )
}

/** Imperative handle so a parent (e.g. a "Discover" button) can refetch the queue. */
export interface IdentitySuggestionsSectionHandle {
  reload: () => void
}

interface IdentitySuggestionsSectionProps {
  /** When set, only suggestions of this kind are shown (e.g. 'project' on the Projects page). */
  kind?: 'person' | 'project'
}

/**
 * Collapsible "Identity suggestions" review queue. Renders only when at least one
 * pending suggestion exists (optionally filtered to a single `kind`). Suggestions
 * that share a target are clustered into one group card; each decision shows both
 * entities as mini-profiles, human-readable evidence, which record survives, and
 * an accept/reject pair. Exposes a `reload` handle via ref.
 */
export const IdentitySuggestionsSection = forwardRef<
  IdentitySuggestionsSectionHandle,
  IdentitySuggestionsSectionProps
>(function IdentitySuggestionsSection({ kind }, ref) {
  const { suggestions, loading, profiles, targetNames, mentions, impacts, contexts, reload, accept, reject, mergeInto } =
    useIdentitySuggestions()
  const [expanded, setExpanded] = useState(true)
  const navigate = useNavigate()

  useImperativeHandle(ref, () => ({ reload }), [reload])

  const openRecording = (recordingId: string) => navigate('/library', { state: { selectedId: recordingId } })
  const openProfile = (id: string) => navigate(`/person/${id}`)

  const visible = kind ? suggestions.filter((s) => s.kind === kind) : suggestions

  if (loading || visible.length === 0) return null

  const groups = groupSuggestions(visible)

  const nameFor = (s: IdentitySuggestion): string => {
    const ev = parseEvidence(s.evidence)
    return targetNames[s.target_id] || ev.keeperName || (s.kind === 'person' ? 'this person' : 'this project')
  }

  let lastTier: SuggestionTier | null = null

  return (
    <section className="mb-6" aria-label="Identity suggestions">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex items-center gap-2 w-full text-left mb-3 group"
        aria-expanded={expanded}
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
        <Sparkles className="h-4 w-4 text-amber-500" />
        <span className="text-sm font-semibold">Identity suggestions ({visible.length})</span>
        <span className="text-xs text-muted-foreground hidden sm:inline">
          — possible duplicate names to confirm
        </span>
      </button>

      {expanded && (
        <div className="space-y-3">
          {groups.map((group) => {
            const keeperName = nameFor(group.candidates[0])
            const keeperProfile = profiles[group.targetId]
            const isMulti = group.candidates.length > 1
            const showTier = group.tier !== lastTier
            lastTier = group.tier

            return (
              <div key={group.targetId} className="space-y-2">
                {showTier && (
                  <div className="flex items-center gap-2 pt-1">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {TIER_LABEL[group.tier]}
                    </span>
                    <div className="h-px flex-1 bg-border" />
                  </div>
                )}

                <Card className="border-amber-500/20 bg-amber-500/[0.03]">
                  <CardContent className="p-4 space-y-3">
                    {isMulti && (
                      <div className="flex items-start gap-2">
                        {group.kind === 'project' ? (
                          <Sparkles className="h-4 w-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                        ) : (
                          <Users className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
                        )}
                        <p className="text-sm leading-snug">
                          {group.candidates.length} names may be{' '}
                          <span className="font-semibold">{keeperName}</span>:{' '}
                          <span className="text-muted-foreground">
                            {group.candidates
                              .map((c) => `${c.candidate_name} (${Math.round((c.confidence ?? 0) * 100)}%)`)
                              .join(' · ')}
                          </span>
                        </p>
                      </div>
                    )}

                    <div className={cn(isMulti && 'divide-y')}>
                      {group.candidates.map((c) => {
                        const ev = parseEvidence(c.evidence)
                        const candidateMentions = mentions[mentionKey(c.candidate_name)]
                        const keeperMentions = mentions[mentionKey(keeperName)]
                        const { coMention } = computeCoMention(candidateMentions, keeperMentions)
                        const keeperContext = contexts[c.target_id]
                        const candidateContext = contexts[ev.loserId || c.candidate_name]
                        return (
                          <div key={c.id} className={cn(isMulti && 'py-3 first:pt-0 last:pb-0')}>
                            <CandidateDecision
                              suggestion={c}
                              keeper={keeperProfile}
                              loser={ev.loserId ? profiles[ev.loserId] : undefined}
                              keeperName={keeperName}
                              candidateMentions={candidateMentions}
                              keeperMentions={keeperMentions}
                              keeperContext={keeperContext}
                              candidateContext={candidateContext}
                              coMention={coMention}
                              impact={impacts[c.id]}
                              onAccept={accept}
                              onReject={reject}
                              onMergeInto={mergeInto}
                              onOpenRecording={openRecording}
                              onOpenProfile={openProfile}
                            />
                          </div>
                        )
                      })}
                    </div>
                  </CardContent>
                </Card>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
})

export default IdentitySuggestionsSection
