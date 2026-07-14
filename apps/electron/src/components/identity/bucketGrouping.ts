/**
 * Pure grouping for the "Resolve per meeting" card: cluster a bucket's recordings by
 * the real person they most likely denote (an existing resolution wins; otherwise the
 * system's best guess), with everything undecided falling into an "Unclear" group.
 * Kept pure + unit-tested so the card just renders the result.
 */

import type { AmbiguousCandidate, BucketRecording, BucketResolution } from './useAmbiguousBuckets'

export interface BucketGroup {
  /** Candidate contact id, or null for the "Unclear" group. */
  candidateId: string | null
  candidateName: string | null
  recordings: BucketRecording[]
}

const UNCLEAR = '__unclear__'

/** The candidate a recording is currently assigned to: its resolution, else best guess. */
export function assignedCandidateId(r: BucketRecording): string | null {
  if (r.resolved) return r.resolvedContactId // may be null (explicit Unclear)
  return r.method !== 'unclear' ? r.bestGuessId : null
}

/**
 * Group recordings by their assigned candidate. Named-candidate groups come first,
 * ordered by size then name; the "Unclear" group (unassigned) is always last.
 */
export function groupBucketRecordings(res: BucketResolution): BucketGroup[] {
  const nameById = new Map<string, string>(res.candidates.map((c: AmbiguousCandidate) => [c.id, c.name]))
  const byKey = new Map<string, BucketRecording[]>()
  for (const r of res.recordings) {
    const cid = assignedCandidateId(r)
    const key = cid ?? UNCLEAR
    const arr = byKey.get(key)
    if (arr) arr.push(r)
    else byKey.set(key, [r])
  }

  const named: BucketGroup[] = []
  let unclear: BucketGroup | null = null
  for (const [key, recordings] of byKey) {
    if (key === UNCLEAR) {
      unclear = { candidateId: null, candidateName: null, recordings }
    } else {
      named.push({ candidateId: key, candidateName: nameById.get(key) ?? key, recordings })
    }
  }

  named.sort((a, b) => {
    if (a.recordings.length !== b.recordings.length) return b.recordings.length - a.recordings.length
    return (a.candidateName ?? '').localeCompare(b.candidateName ?? '')
  })

  return unclear ? [...named, unclear] : named
}
