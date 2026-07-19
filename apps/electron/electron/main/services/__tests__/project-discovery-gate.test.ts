/**
 * F12 — project discovery gate policy (pure).
 *
 * Locks the two bars the reconciler must clear before minting a `projects` row:
 * name plausibility and recurrence across distinct sources. No database, no
 * resolver — just the thresholds, so a tuning change has to state its intent
 * here first.
 */

import { describe, it, expect } from 'vitest'
import {
  scoreProjectNameCandidate,
  decideProjectDiscovery,
  CREATE_CONFIDENCE_FLOOR,
  MIN_DISTINCT_SOURCES
} from '../project-discovery-gate'

describe('scoreProjectNameCandidate — name plausibility', () => {
  describe('structural noise scores 0 (dropped, never remembered)', () => {
    it.each([
      ['', 'empty'],
      ['   ', 'whitespace only'],
      ['AI', 'below the minimum length'],
      ['x', 'single character'],
      ['2026', 'digits only'],
      ['---', 'punctuation only'],
      ['we should probably revisit the pricing model before the next board meeting', 'a sentence'],
      ['What is the plan?', 'sentence punctuation'],
      ['Migration\nPlan', 'embedded newline']
    ])('scores 0 for %j (%s)', (name) => {
      expect(scoreProjectNameCandidate(name).score).toBe(0)
    })

    it('scores 0 for a name longer than the length cap even with few tokens', () => {
      expect(scoreProjectNameCandidate('Supercalifragilistic'.repeat(4)).score).toBe(0)
    })
  })

  describe('names built only from generic vocabulary stay below the floor', () => {
    it.each([
      'the project',
      'this initiative',
      'next steps',
      'weekly sync',
      'follow up',
      'status update',
      'general',
      'various',
      'el proyecto',
      'proximos pasos',
      'reunion semanal'
    ])('caps %j below the create floor', (name) => {
      const { score } = scoreProjectNameCandidate(name)
      expect(score).toBeGreaterThan(0) // non-trivial: still worth deferring
      expect(score).toBeLessThan(CREATE_CONFIDENCE_FLOOR)
    })

    it('folds accents before checking the generic vocabulary', () => {
      // "revisión" must be recognised as the generic "revision".
      expect(scoreProjectNameCandidate('la revisión').score).toBeLessThan(CREATE_CONFIDENCE_FLOOR)
    })
  })

  describe('plausible project names clear the floor', () => {
    it.each([
      'Atlas',
      'Project Atlas',
      'Meridian Alpha',
      'Phantom Initiative',
      'Migration Plan',
      'HiDock Firmware',
      'CRM',
      'Plataforma de Pagos'
    ])('clears the floor for %j', (name) => {
      expect(scoreProjectNameCandidate(name).score).toBeGreaterThanOrEqual(CREATE_CONFIDENCE_FLOOR)
    })

    it('clears the floor even when the extractor lower-cased the name', () => {
      // The proper-case bonus is a nudge, not a requirement.
      expect(scoreProjectNameCandidate('meridian alpha').score).toBeGreaterThanOrEqual(CREATE_CONFIDENCE_FLOOR)
    })

    it('a single distinctive token rescues an otherwise generic phrase', () => {
      // "plan" is generic, "migration" is not — the name carries identity.
      expect(scoreProjectNameCandidate('the migration plan').score).toBeGreaterThanOrEqual(
        CREATE_CONFIDENCE_FLOOR
      )
    })

    it('never exceeds 1', () => {
      expect(scoreProjectNameCandidate('Meridian Alpha Program').score).toBeLessThanOrEqual(1)
    })

    it('is normalization-stable: case and whitespace do not change the verdict', () => {
      const a = scoreProjectNameCandidate('Meridian Alpha')
      const b = scoreProjectNameCandidate('  meridian   ALPHA  ')
      // Only the proper-case nudge differs; both must land on the same side of the floor.
      expect(a.score).toBeGreaterThanOrEqual(CREATE_CONFIDENCE_FLOOR)
      expect(b.score).toBeGreaterThanOrEqual(CREATE_CONFIDENCE_FLOOR)
    })
  })

  it('reports why a name was docked', () => {
    expect(scoreProjectNameCandidate('next steps').reasons).toContain('all-generic-tokens')
    expect(scoreProjectNameCandidate('Meridian Alpha').reasons).toContain('distinctive-token')
    expect(scoreProjectNameCandidate('a').reasons).toContain('too-short')
  })
})

describe('decideProjectDiscovery — combining the two bars', () => {
  it('drops structural noise outright, however often it recurs', () => {
    const d = decideProjectDiscovery({ name: 'What should we do next?', distinctSources: 9 })
    expect(d.action).toBe('drop')
    expect(d.score).toBe(0)
  })

  it('defers a below-floor name no matter how many sources mention it', () => {
    // Recurrence never rescues a weak name — promoting it is the user's call.
    const d = decideProjectDiscovery({ name: 'next steps', distinctSources: 25 })
    expect(d.action).toBe('defer')
    expect(d.reasons).toContain('below-confidence-floor')
  })

  it('defers a strong name seen in a single source', () => {
    const d = decideProjectDiscovery({ name: 'Meridian Alpha', distinctSources: 1 })
    expect(d.action).toBe('defer')
    expect(d.reasons).toContain('single-occurrence')
  })

  it('defers a strong name with no source at all', () => {
    const d = decideProjectDiscovery({ name: 'Meridian Alpha', distinctSources: 0 })
    expect(d.action).toBe('defer')
  })

  it('creates a strong name once it recurs across the required sources', () => {
    const d = decideProjectDiscovery({ name: 'Meridian Alpha', distinctSources: MIN_DISTINCT_SOURCES })
    expect(d.action).toBe('create')
    expect(d.reasons).toContain('recurring')
  })

  it('treats a negative source count as zero rather than passing the bar', () => {
    expect(decideProjectDiscovery({ name: 'Meridian Alpha', distinctSources: -3 }).action).toBe('defer')
  })

  it('exposes the evidence it decided on', () => {
    const d = decideProjectDiscovery({ name: 'Meridian Alpha', distinctSources: 3 })
    expect(d.distinctSources).toBe(3)
    expect(d.score).toBeGreaterThanOrEqual(CREATE_CONFIDENCE_FLOOR)
  })
})
