/**
 * F12 — project discovery gate policy (pure).
 *
 * Locks the three outcomes the reconciler routes through: drop (structural
 * noise), defer (plausible but unproven — remembered and surfaced), and create
 * (positive name structure AND recurrence). No database, no resolver — just the
 * thresholds, so a tuning change has to state its intent here first.
 *
 * The fixtures are adversarial in BOTH directions, because an earlier cut of this
 * scorer was mis-calibrated both ways: anything with a single non-blocklisted
 * token cleared the create floor (so recurring noise like "budget" recreated the
 * spurious-project problem), while a raw <3-code-unit rule DROPPED "AI", "XR" and
 * 2-character CJK names outright instead of deferring them.
 */

import { describe, it, expect } from 'vitest'
import {
  scoreProjectNameCandidate,
  nameLikeEvidence,
  decideProjectDiscovery,
  CREATE_CONFIDENCE_FLOOR,
  MIN_DISTINCT_SOURCES
} from '../project-discovery-gate'

/** What the reconciler would do with this name at N distinct sources. */
const actionAt = (name: string, sources: number): string =>
  decideProjectDiscovery({ name, distinctSources: sources }).action

/** Recurrence can never change a drop/defer verdict — check it does not. */
function expectNeverCreates(name: string): void {
  for (const sources of [1, 2, 3, 10, 50]) {
    expect(actionAt(name, sources), `${name} @ ${sources} sources`).not.toBe('create')
  }
}

describe('scoreProjectNameCandidate — shape rules', () => {
  /** DROP is reserved for input with NO usable name content at all. */
  it.each([
    ['', 'empty'],
    ['   ', 'whitespace only'],
    ['2026', 'digits only'],
    ['---', 'punctuation only'],
    ['we should probably revisit the pricing model before the next board meeting', 'prose'],
    ['What is the plan?', 'a question — sentence punctuation on a multi-word clause']
  ])('drops %j (%s) — never even remembered', (name) => {
    expect(scoreProjectNameCandidate(name).score).toBe(0)
    expect(actionAt(name, 99)).toBe('drop')
  })

  it('drops a name longer than the length cap even with few tokens', () => {
    expect(scoreProjectNameCandidate('Supercalifragilistic'.repeat(4)).score).toBe(0)
  })

  /**
   * The drop set previously discarded these outright, contradicting the module's
   * own defer-by-default design: a one-letter codename and punctuation-bearing
   * shapes are plausible names and must stay reviewable. They are held back from
   * auto-creation instead of being thrown away.
   */
  it.each(['X', 'Yahoo!', 'What If?'])('keeps %j for review — deferred, never dropped, never created', (name) => {
    const { score } = scoreProjectNameCandidate(name)
    expect(score).toBeGreaterThan(0)
    expectNeverCreates(name)
  })

  it('treats an embedded newline as whitespace rather than a reason to discard', () => {
    // normalizeName collapses it, so this is simply the name "Migration Plan".
    expect(scoreProjectNameCandidate('Migration\nPlan').score).toBeGreaterThan(0)
  })
})

describe('false POSITIVES — recurring extraction noise must never auto-create', () => {
  /**
   * The gate-defeating class. These are ordinary nouns an LLM emits when a
   * transcript never actually named a project. None is in the generic blocklist
   * (that is the point — a blocklist only protects vocabulary it enumerates), so
   * they must be held back by the ABSENCE of positive name structure instead.
   */
  it.each([
    'budget',
    'deadline',
    'pricing issue',
    'customer feedback',
    'the migration plan',
    'headcount',
    'quarterly revenue numbers'
  ])('%j stays deferred at every recurrence level', (name) => {
    const { score } = scoreProjectNameCandidate(name)
    expect(score).toBeGreaterThan(0) // plausible — remembered, not discarded
    expect(score).toBeLessThan(CREATE_CONFIDENCE_FLOOR)
    expect(nameLikeEvidence(name)).toBeNull()
    expectNeverCreates(name)
  })

  it.each([
    'next steps',
    'the project',
    'weekly sync',
    'status update',
    'general',
    'el proyecto',
    'proximos pasos',
    'reunion semanal',
    'The Plan', // Title Case cannot rescue all-generic vocabulary
    'Weekly Sync'
  ])('all-generic %j stays deferred at every recurrence level', (name) => {
    const { score } = scoreProjectNameCandidate(name)
    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThan(CREATE_CONFIDENCE_FLOOR)
    expectNeverCreates(name)
  })

  it('folds accents before checking the generic vocabulary', () => {
    expect(scoreProjectNameCandidate('la revisión').score).toBeLessThan(CREATE_CONFIDENCE_FLOOR)
  })

  /**
   * The primary false-positive path, and the one Title Case alone cannot close:
   * structured model output emits business noun phrases in exactly this cased
   * form, and "Customer Feedback" is structurally identical to "Meridian Alpha".
   * Held back by covering business-process vocabulary in the generic set, so the
   * phrase is all-generic and capped below the floor before capitalization is
   * ever consulted.
   */
  it.each(['Customer Feedback', 'Action Items', 'Meeting Notes', 'Status Update', 'Client Requests', 'Open Issues'])(
    'Title-Cased generic noun phrase %j defers and never creates',
    (name) => {
      const { score } = scoreProjectNameCandidate(name)
      expect(score).toBeGreaterThan(0) // still reviewable
      expect(score).toBeLessThan(CREATE_CONFIDENCE_FLOOR)
      expect(nameLikeEvidence(name)).toBeNull()
      expectNeverCreates(name)
    }
  )

  it('genuine two-token names still create despite the Title-Case tightening', () => {
    for (const name of ['Meridian Alpha', 'Basalt Orchard']) {
      expect(scoreProjectNameCandidate(name).score).toBeGreaterThanOrEqual(CREATE_CONFIDENCE_FLOOR)
      expect(actionAt(name, MIN_DISTINCT_SOURCES)).toBe('create')
    }
  })

  it('a lone capitalized word is not evidence — the real name and the noise word look identical', () => {
    // "Atlas" is a plausible project; "Budget" is noise. Structurally the same,
    // so both defer to the suggestion queue rather than one auto-creating.
    expect(nameLikeEvidence('Atlas')).toBeNull()
    expect(nameLikeEvidence('Budget')).toBeNull()
    expectNeverCreates('Atlas')
    expectNeverCreates('Budget')
  })

  it('a lower-cased multi-word name defers — capitalization is the signal being read', () => {
    // Deliberate conservatism: if the extractor stops emitting proper case we
    // defer rather than auto-create. Nothing is lost; the user can promote it.
    expect(nameLikeEvidence('meridian alpha')).toBeNull()
    expectNeverCreates('meridian alpha')
  })
})

describe('false NEGATIVES — short and non-Latin names must defer, never drop', () => {
  /**
   * The old raw code-unit length rule ran before any Unicode-aware analysis and
   * returned 0 for these, discarding them entirely. They are legitimate names:
   * they must be remembered, and creatable once structure + recurrence support it.
   */
  it.each([
    ['AI', 'acronym'],
    ['XR', 'acronym'],
    ['CRM', 'acronym'],
    ['SAP', 'acronym'],
    ['DFX5', 'acronym'],
    ['研究', 'uncased-script'],
    ['プロジェクト', 'uncased-script'],
    ['개발', 'uncased-script']
  ])('%j is never dropped and carries %s evidence', (name, evidence) => {
    const q = scoreProjectNameCandidate(name)
    expect(q.score).toBeGreaterThan(0)
    expect(q.evidence).toBe(evidence)
    // Deferred on a single sighting…
    expect(actionAt(name, 1)).toBe('defer')
    // …and creatable once recurrence corroborates it.
    expect(actionAt(name, MIN_DISTINCT_SOURCES)).toBe('create')
  })

  it('an accented proper name is not dropped and clears the floor', () => {
    const q = scoreProjectNameCandidate('Café Motor')
    expect(q.evidence).toBe('proper-multi')
    expect(q.score).toBeGreaterThanOrEqual(CREATE_CONFIDENCE_FLOOR)
    expect(actionAt('Café Motor', 1)).toBe('defer')
    expect(actionAt('Café Motor', 2)).toBe('create')
  })

  it('scores identically across Unicode normalization forms', () => {
    const nfc = 'Café Motor'.normalize('NFC')
    const nfd = 'Café Motor'.normalize('NFD')
    expect(nfd).not.toBe(nfc)
    expect(scoreProjectNameCandidate(nfd).score).toBe(scoreProjectNameCandidate(nfc).score)
  })
})

describe('auto-create requires positive name structure', () => {
  it.each([
    ['Meridian Alpha', 'proper-multi'],
    ['Project Atlas', 'proper-multi'],
    ['Phantom Initiative', 'proper-multi'],
    ['Migration Plan', 'proper-multi'],
    ['HiDock Firmware', 'distinctive-orthography'],
    ['DFX5 Gateway', 'acronym'],
    ['Plataforma de Pagos', 'proper-multi']
  ])('%j clears the floor via %s', (name, evidence) => {
    const q = scoreProjectNameCandidate(name)
    expect(q.evidence).toBe(evidence)
    expect(q.score).toBeGreaterThanOrEqual(CREATE_CONFIDENCE_FLOOR)
  })

  /**
   * The vocabulary-independent tiers. Unlike proper-multi these read orthography
   * rather than a word list, so noise cannot escape them by picking a word the
   * generic set happens not to enumerate.
   */
  it.each([
    ['HiDock', 'internal capital'],
    ['McKinsey', 'internal capital'],
    ['Q3Platform', 'letter/digit mix']
  ])('%j earns distinctive-orthography evidence (%s) without any word list', (name) => {
    expect(nameLikeEvidence(name)).toBe('distinctive-orthography')
  })

  it('an all-caps letter/digit product name is caught by the acronym tier', () => {
    expect(nameLikeEvidence('S4HANA')).toBe('acronym')
  })

  it('never exceeds 1', () => {
    expect(scoreProjectNameCandidate('Meridian Alpha Program').score).toBeLessThanOrEqual(1)
  })

  it('reports why a name was docked or accepted', () => {
    expect(scoreProjectNameCandidate('next steps').reasons).toContain('all-generic-tokens')
    expect(scoreProjectNameCandidate('pricing issue').reasons).toContain('no-name-structure')
    expect(scoreProjectNameCandidate('Meridian Alpha').reasons).toContain('evidence:proper-multi')
    expect(scoreProjectNameCandidate('What is the plan?').reasons).toContain('prose')
  })
})

describe('decideProjectDiscovery — combining the two bars', () => {
  it('drops structural noise outright, however often it recurs', () => {
    const d = decideProjectDiscovery({ name: 'What should we do next?', distinctSources: 9 })
    expect(d.action).toBe('drop')
    expect(d.score).toBe(0)
  })

  it('defers a structureless name no matter how many sources mention it', () => {
    const d = decideProjectDiscovery({ name: 'budget', distinctSources: 25 })
    expect(d.action).toBe('defer')
    expect(d.reasons).toContain('below-confidence-floor')
  })

  it('defers a well-formed name seen in a single source', () => {
    const d = decideProjectDiscovery({ name: 'Meridian Alpha', distinctSources: 1 })
    expect(d.action).toBe('defer')
    expect(d.reasons).toContain('single-occurrence')
  })

  it('defers a well-formed name with no source at all', () => {
    expect(actionAt('Meridian Alpha', 0)).toBe('defer')
  })

  it('creates a well-formed name once it recurs across the required sources', () => {
    const d = decideProjectDiscovery({ name: 'Meridian Alpha', distinctSources: MIN_DISTINCT_SOURCES })
    expect(d.action).toBe('create')
    expect(d.reasons).toContain('recurring')
  })

  it('treats a negative source count as zero rather than passing the bar', () => {
    expect(actionAt('Meridian Alpha', -3)).toBe('defer')
  })

  it('exposes the evidence it decided on', () => {
    const d = decideProjectDiscovery({ name: 'Meridian Alpha', distinctSources: 3 })
    expect(d.distinctSources).toBe(3)
    expect(d.score).toBeGreaterThanOrEqual(CREATE_CONFIDENCE_FLOOR)
  })
})
