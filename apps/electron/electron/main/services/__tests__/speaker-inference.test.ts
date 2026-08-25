// @vitest-environment node

/**
 * speaker-inference (2026-07-24) — bind speaker labels self-ID could not.
 * Guards the owner contract:
 *   - only 'high'-confidence, roster-corroborated, plausible names are bound;
 *   - existing bindings are never overwritten;
 *   - every failure mode (no roster, no unbound labels, brain null, garbage
 *     answer, off-roster name, generic name) binds NOTHING.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

import {
  parseInferenceResponse,
  isPlausibleName,
  rosterKey,
  firstNameKey,
  buildRoster,
  buildInferencePrompt
} from '../speaker-inference'

describe('parseInferenceResponse', () => {
  it('parses a valid JSON array of proposals', () => {
    const raw = '[{"speaker":"Speaker 5","name":"Óscar Pereda","confidence":"high","evidence":"gracias Óscar"}]'
    expect(parseInferenceResponse(raw)).toEqual([
      { speaker: 'Speaker 5', name: 'Óscar Pereda', confidence: 'high', evidence: 'gracias Óscar' }
    ])
  })
  it('tolerates code fences', () => {
    const raw = '```json\n[{"speaker":"Speaker 2","name":"Ana","confidence":"low"}]\n```'
    expect(parseInferenceResponse(raw)).toEqual([{ speaker: 'Speaker 2', name: 'Ana', confidence: 'low' }])
  })
  it('drops malformed entries and non-JSON input', () => {
    expect(parseInferenceResponse('not json')).toEqual([])
    expect(parseInferenceResponse('[{"speaker":"S","confidence":"high"}]')).toEqual([]) // missing name
    expect(parseInferenceResponse('{"speaker":"S"}')).toEqual([]) // not an array
    expect(parseInferenceResponse(null)).toEqual([])
  })
})

describe('isPlausibleName', () => {
  it('accepts real names incl. accents', () => {
    expect(isPlausibleName('Óscar Pereda')).toBe(true)
    expect(isPlausibleName('Mariana')).toBe(true)
  })
  it('rejects generic / empty / role words', () => {
    expect(isPlausibleName('unknown')).toBe(false)
    expect(isPlausibleName('Speaker 1')).toBe(false)
    expect(isPlausibleName('  ')).toBe(false)
    expect(isPlausibleName('x')).toBe(false)
  })
})

describe('roster keys', () => {
  it('accent-folds and normalizes', () => {
    expect(rosterKey('Óscar Pereda')).toBe('oscar pereda')
    expect(firstNameKey('Óscar Pereda')).toBe('oscar')
  })
})

describe('buildRoster', () => {
  it('includes full names and first names from attendees JSON (string + object forms)', () => {
    const roster = buildRoster('[{"name":"Óscar Pereda"},"Mariana Duarte"]')
    expect(roster.has('oscar pereda')).toBe(true)
    expect(roster.has('oscar')).toBe(true)
    expect(roster.has('mariana duarte')).toBe(true)
    expect(roster.has('mariana')).toBe(true)
  })
  it('adds extra names (existing bindings) for elimination context', () => {
    const roster = buildRoster(null, ['Sebastián Geraldes'])
    expect(roster.has('sebastian geraldes')).toBe(true)
  })
  it('returns an empty roster for garbage attendees', () => {
    expect(buildRoster('not json').size).toBe(0)
  })
})

describe('buildInferencePrompt', () => {
  it('carries bindings, roster, samples, and the strict output contract', () => {
    const prompt = buildInferencePrompt({
      boundNames: [{ label: 'Speaker 1', name: 'Sebastián Geraldes' }],
      unboundSamples: [{ label: 'Speaker 5', samples: ['Puedo ayudarte con el primero'] }],
      rosterNames: ['Sebastián Geraldes'],
      meetingSubject: 'Sync interna TSC',
      transcriptTitle: 'Planificación de Desvíos',
      transcriptSummary: 'Resumen.'
    })
    expect(prompt).toContain('Speaker 1 = Sebastián Geraldes')
    expect(prompt).toContain('Speaker 5 says:')
    expect(prompt).toContain('JSON array')
    expect(prompt).toContain('confidence')
  })
})

// ---------------------------------------------------------------------------
// The pass itself (mocked DB + brain)
// ---------------------------------------------------------------------------

const generateText = vi.fn()
const db = vi.hoisted(() => ({
  speakerMap: [] as Array<{ speaker_label: string; contact_id: string; name: string }>,
  transcript: null as null | { title_suggestion: string | null; summary: string | null; speakers: string | null },
  recording: null as null | { id: string; meeting_id: string | null },
  meeting: null as null | { id: string; subject: string; attendees: string | null },
  mentionResolutions: [] as Array<{ source_name: string }>,
  meetingContacts: [] as Array<{ name: string }>,
  assignments: [] as Array<{ label: string; by: unknown }>,
  mentions: [] as Array<unknown>
}))

vi.mock('../chat-llm', () => ({ getChatLLMService: () => ({ generateText }) }))
vi.mock('../recording-eligibility', () => ({ isRecordingEligible: vi.fn(() => true) }))
vi.mock('../database', () => ({
  getSpeakerMap: vi.fn(() => db.speakerMap),
  getRecordingById: vi.fn(() => db.recording),
  getMeetingById: vi.fn(() => db.meeting),
  queryOne: vi.fn(() => db.transcript),
  queryAll: vi.fn((sql: string) =>
    typeof sql === 'string' && sql.includes('meeting_contacts') ? (db.meetingContacts ?? []) : (db.mentionResolutions ?? [])
  ),
  assignSpeaker: vi.fn((_rec: string, label: string, by: unknown) => {
    db.assignments.push({ label, by })
    return { id: 'c1', name: (by as { newName?: string }).newName ?? 'Roster Name' }
  }),
  resolveMention: vi.fn((...args: unknown[]) => { db.mentions.push(args) })
}))
vi.mock('../entity-resolver', () => ({
  resolveContact: vi.fn(() => ({ id: null, confidence: 0, method: 'none' }))
}))

import { runSpeakerInference } from '../speaker-inference'

const TURNS = [
  { speaker: 'Speaker 1', text: 'Listo, gracias Óscar.' },
  { speaker: 'Speaker 5', text: 'Puedo ayudarte con el primero.' },
  { speaker: 'Speaker 5', text: 'Sí, eso fue lo que Óscar estuvo desplegando.' }
]

beforeEach(() => {
  vi.clearAllMocks()
  db.speakerMap = [{ speaker_label: 'Speaker 1', contact_id: 'c0', name: 'Sebastián Geraldes' }]
  db.transcript = {
    title_suggestion: 'Planificación de Desvíos',
    summary: 'Resumen',
    speakers: JSON.stringify(TURNS)
  }
  db.recording = { id: 'rec-1', meeting_id: 'm1' }
  db.meeting = { id: 'm1', subject: 'Sync interna TSC', attendees: '[{"name":"Sebastián Geraldes"},{"name":"Óscar Pereda"}]' }
  db.assignments = []
  db.mentions = []
  db.mentionResolutions = []
  db.meetingContacts = []
})

describe('runSpeakerInference', () => {
  it('binds a high-confidence, roster-corroborated proposal', async () => {
    generateText.mockResolvedValue('[{"speaker":"Speaker 5","name":"Óscar Pereda","confidence":"high","evidence":"gracias Óscar"}]')
    const res = await runSpeakerInference('rec-1')
    expect(res.bound).toBe(1)
    expect(db.assignments).toEqual([{ label: 'Speaker 5', by: { newName: 'Óscar Pereda' } }])
    expect(db.mentions[0]?.[2]).toBe('c1')
    expect(db.mentions[0]?.[3]).toBe('speaker-inference')
  })

  it('corroborates against mention_resolutions names (the analysis-known "Babesh (Speaker 3)" case)', async () => {
    // No calendar attendees at all; the only roster evidence is the name the
    // transcript analysis already resolved for this recording.
    db.meeting = { id: 'm1', subject: 'Itau POC', attendees: null }
    db.mentionResolutions = [{ source_name: 'Babesh' }]
    generateText.mockResolvedValue('[{"speaker":"Speaker 5","name":"Babesh","confidence":"high","evidence":"Babesh is the tech lead"}]')
    const res = await runSpeakerInference('rec-1')
    expect(res.bound).toBe(1)
    expect(db.assignments[0].label).toBe('Speaker 5')
  })

  it('binds NOTHING for a low-confidence proposal', async () => {
    generateText.mockResolvedValue('[{"speaker":"Speaker 5","name":"Óscar Pereda","confidence":"low"}]')
    const res = await runSpeakerInference('rec-1')
    expect(res.bound).toBe(0)
    expect(db.assignments).toEqual([])
  })

  it('binds NOTHING for an off-roster name (uncorroborated)', async () => {
    generateText.mockResolvedValue('[{"speaker":"Speaker 5","name":"Random Person","confidence":"high"}]')
    const res = await runSpeakerInference('rec-1')
    expect(res.bound).toBe(0)
    expect(db.assignments).toEqual([])
  })

  it('binds NOTHING on a garbage brain answer', async () => {
    generateText.mockResolvedValue('Speaker 5 is probably Óscar')
    const res = await runSpeakerInference('rec-1')
    expect(res.bound).toBe(0)
  })

  it('skips when every label is already bound (no LLM call)', async () => {
    db.speakerMap = [
      { speaker_label: 'Speaker 1', contact_id: 'c0', name: 'Sebastián Geraldes' },
      { speaker_label: 'Speaker 5', contact_id: 'c1', name: 'Óscar Pereda' }
    ]
    const res = await runSpeakerInference('rec-1')
    expect(res.skipped).toBe(true)
    expect(generateText).not.toHaveBeenCalled()
  })

  it('accepts a first-name-only proposal when the first name is on the roster', async () => {
    generateText.mockResolvedValue('[{"speaker":"Speaker 5","name":"Óscar","confidence":"high"}]')
    const res = await runSpeakerInference('rec-1')
    expect(res.bound).toBe(1)
  })

  it('identity correction: an off-roster proposal that resolveContact matches to a canonical contact binds THAT contact', async () => {
    // "Babis" is not on any roster — but resolveContact fuzzy-matches it to the
    // canonical "Bhavesh" contact. The identity is corrected, not created anew.
    const { resolveContact } = await import('../entity-resolver')
    vi.mocked(resolveContact).mockReturnValue({ id: 'c-bhavesh', confidence: 0.9, method: 'fuzzy' })
    generateText.mockResolvedValue('[{"speaker":"Speaker 5","name":"Babis","confidence":"high","evidence":"Babis is the tech lead"}]')
    const res = await runSpeakerInference('rec-1')
    expect(res.bound).toBe(1)
    expect(db.assignments).toEqual([{ label: 'Speaker 5', by: { contactId: 'c-bhavesh' } }])
  })

  it('an ambiguous resolveContact bucket is NEVER an auto-link', async () => {
    const { resolveContact } = await import('../entity-resolver')
    vi.mocked(resolveContact).mockReturnValue({ id: 'c-someone', confidence: 0.9, method: 'fuzzy', ambiguous: true })
    generateText.mockResolvedValue('[{"speaker":"Speaker 5","name":"Babis","confidence":"high"}]')
    const res = await runSpeakerInference('rec-1')
    expect(res.bound).toBe(0)
    expect(db.assignments).toEqual([])
  })
})
