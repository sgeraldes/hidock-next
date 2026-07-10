/**
 * Self-identification service tests.
 *
 * The pure extractor (lexical prefilter + prompt + parse + merge analysis) is
 * tested with the LLM injected/mocked, so it is fully deterministic. The impure
 * binding path is tested with '../database' and '../entity-resolver' mocked as
 * plain spies (no real sql.js), verifying the speaker map is written, the contact
 * is resolved/created, the tiered mention-resolution is recorded, and existing
 * (manual) bindings are never overwritten. The signal-tier ordering is asserted
 * directly against signal-tiers.
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// --- Mocks (hoisted) --------------------------------------------------------

const mockAssignSpeaker = vi.fn()
const mockResolveMention = vi.fn()
const mockGetSpeakerMap = vi.fn((_id: string) => [] as Array<{ speaker_label: string }>)
const mockGetRecordingById = vi.fn((_id: string) => ({ meeting_id: null }) as { meeting_id: string | null })
const mockResolveContact = vi.fn()

// queryOne dispatches on the SQL text: config lookups miss (not scanned), the
// transcript lookup returns whatever `currentSpeakers` is set to for the test.
let currentSpeakers: string | null = null
const mockQueryOne = vi.fn((sql: string, _params?: unknown[]) => {
  if (/FROM config/i.test(sql)) return undefined
  if (/FROM transcripts/i.test(sql)) return { speakers: currentSpeakers }
  return undefined
})

vi.mock('../database', () => ({
  queryAll: vi.fn(() => []),
  queryOne: (sql: string, params?: unknown[]) => mockQueryOne(sql, params as never),
  run: vi.fn(),
  getRecordingById: (id: string) => mockGetRecordingById(id as never),
  getSpeakerMap: (id: string) => mockGetSpeakerMap(id as never),
  assignSpeaker: (recordingId: string, label: string, opts: unknown) =>
    mockAssignSpeaker(recordingId, label, opts),
  resolveMention: (recordingId: string, name: string, contactId: string, method: string, confidence: number) =>
    mockResolveMention(recordingId, name, contactId, method, confidence),
  getQueueItems: vi.fn(() => [])
}))

vi.mock('../entity-resolver', () => ({
  resolveContact: (name: string, ctx?: unknown) => mockResolveContact(name, ctx)
}))

vi.mock('../chat-llm', () => ({
  getChatLLMService: () => ({ generate: vi.fn(async () => '[]') })
}))

import {
  hasSelfIdCue,
  findSelfIdCues,
  parseSelfIdResponse,
  analyzeSelfId,
  isPlausibleSelfName,
  extractSelfIdentifications,
  parseSpeakerTurns,
  runSelfIdentificationForRecording,
  SELF_ID_CONFIDENCE,
  type SpeakerTurn
} from '../self-identification'
import { methodPriority, methodConfidence, canUpgrade } from '../signal-tiers'

// The recording-2026Jul08 roll-call the user verified live.
const ROLLCALL: SpeakerTurn[] = [
  { speaker: 'Speaker 1', text: 'Buenos días a todos, vamos a empezar la reunión.' },
  { speaker: 'Speaker 7', text: 'Yo también Seba, eh, Santiago de la Colina.' },
  { speaker: 'Speaker 6', text: 'Óscar Pereda también, por favor.' },
  { speaker: 'Speaker 3', text: 'Dile a Óscar que revise el documento cuando pueda.' },
  { speaker: 'Speaker 2', text: 'Perfecto, entonces de Emanuel esperamos el reporte.' }
]

beforeEach(() => {
  vi.clearAllMocks()
  currentSpeakers = null
  mockGetSpeakerMap.mockReturnValue([])
  mockGetRecordingById.mockReturnValue({ meeting_id: null })
})

// ---------------------------------------------------------------------------
// Lexical prefilter
// ---------------------------------------------------------------------------

describe('lexical prefilter', () => {
  it('fires on Spanish and English first-person self-intros', () => {
    expect(hasSelfIdCue('Yo también Seba, eh, Santiago de la Colina.')).toBe(true)
    expect(hasSelfIdCue('Soy Ana García, de finanzas.')).toBe(true)
    expect(hasSelfIdCue('Me llamo Juan Pérez.')).toBe(true)
    expect(hasSelfIdCue('Les habla Pedro Ramírez.')).toBe(true)
    expect(hasSelfIdCue("Hi, I'm Sarah Connor.")).toBe(true)
    expect(hasSelfIdCue('My name is Tom Baker.')).toBe(true)
    expect(hasSelfIdCue('Santiago here, ready to start.')).toBe(true)
  })

  it('does NOT fire on ordinary sentences without a capitalized self-name', () => {
    expect(hasSelfIdCue('Soy consciente de que llegamos tarde.')).toBe(false)
    expect(hasSelfIdCue('Dile a Óscar que revise el documento.')).toBe(false)
    expect(hasSelfIdCue('Vamos a empezar la reunión ahora.')).toBe(false)
  })

  it('selects only the cue-bearing turns', () => {
    const cues = findSelfIdCues(ROLLCALL)
    const labels = cues.map((c) => c.speaker)
    expect(labels).toContain('Speaker 7') // "yo también … Santiago"
    expect(labels).toContain('Speaker 6') // "Óscar Pereda también"
    expect(labels).not.toContain('Speaker 3') // "Dile a Óscar" — third-party
  })
})

// ---------------------------------------------------------------------------
// Name plausibility + response parsing
// ---------------------------------------------------------------------------

describe('isPlausibleSelfName', () => {
  it('accepts real names, rejects labels/initials/blanks', () => {
    expect(isPlausibleSelfName('Santiago de la Colina')).toBe(true)
    expect(isPlausibleSelfName('Ana')).toBe(true)
    expect(isPlausibleSelfName('Speaker 7')).toBe(false)
    expect(isPlausibleSelfName('A.')).toBe(false)
    expect(isPlausibleSelfName('  ')).toBe(false)
  })
})

describe('parseSelfIdResponse', () => {
  it('parses a plain JSON array', () => {
    const out = parseSelfIdResponse('[{"speaker":"Speaker 7","name":"Santiago de la Colina"}]')
    expect(out).toEqual([{ speaker: 'Speaker 7', name: 'Santiago de la Colina' }])
  })

  it('tolerates a ```json code fence', () => {
    const out = parseSelfIdResponse('```json\n[{"speaker":"Speaker 6","name":"Óscar Pereda"}]\n```')
    expect(out).toEqual([{ speaker: 'Speaker 6', name: 'Óscar Pereda' }])
  })

  it('drops implausible names and malformed rows, never throws', () => {
    const out = parseSelfIdResponse(
      '[{"speaker":"Speaker 1","name":"Speaker 1"},{"speaker":"","name":"X"},{"name":"NoSpeaker"},"junk"]'
    )
    expect(out).toEqual([])
    expect(parseSelfIdResponse('not json')).toEqual([])
    expect(parseSelfIdResponse(null)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Merge analysis
// ---------------------------------------------------------------------------

describe('analyzeSelfId', () => {
  it('binds a label with a single distinct self-name', () => {
    const { identifications, mergeSuspected } = analyzeSelfId([
      { speaker: 'Speaker 7', name: 'Santiago de la Colina' },
      { speaker: 'Speaker 7', name: 'Santiago de la Colina' } // repeat → still one distinct
    ])
    expect(mergeSuspected).toEqual([])
    expect(identifications).toEqual([
      { label: 'Speaker 7', name: 'Santiago de la Colina', confidence: SELF_ID_CONFIDENCE }
    ])
  })

  it('flags a label with TWO distinct self-names as merge-suspected (no bind)', () => {
    const { identifications, mergeSuspected } = analyzeSelfId([
      { speaker: 'Speaker 4', name: 'Santiago de la Colina' },
      { speaker: 'Speaker 4', name: 'Óscar Pereda' }
    ])
    expect(identifications).toEqual([])
    expect(mergeSuspected).toEqual([{ label: 'Speaker 4', names: ['Santiago de la Colina', 'Óscar Pereda'] }])
  })
})

// ---------------------------------------------------------------------------
// End-to-end extractor (LLM injected)
// ---------------------------------------------------------------------------

describe('extractSelfIdentifications', () => {
  it('finds the self-IDs and ignores third-party mentions', async () => {
    // A faithful narrow-LLM: reports only first-person self-names, never "Óscar"
    // from the third-party "Dile a Óscar" turn.
    const llm = vi.fn(async () =>
      JSON.stringify([
        { speaker: 'Speaker 7', name: 'Santiago de la Colina' },
        { speaker: 'Speaker 6', name: 'Óscar Pereda' }
      ])
    )
    const result = await extractSelfIdentifications(ROLLCALL, { llm })
    expect(llm).toHaveBeenCalledOnce()
    expect(result.usedLLM).toBe(true)
    expect(result.identifications.map((i) => i.name).sort()).toEqual(['Santiago de la Colina', 'Óscar Pereda'])
    expect(result.mergeSuspected).toEqual([])
  })

  it('skips the LLM entirely when no turn carries a self-intro cue', async () => {
    const llm = vi.fn(async () => '[]')
    const turns: SpeakerTurn[] = [
      { speaker: 'Speaker 1', text: 'Revisemos el presupuesto del trimestre.' },
      { speaker: 'Speaker 2', text: 'De acuerdo, empecemos por los gastos.' }
    ]
    const result = await extractSelfIdentifications(turns, { llm })
    expect(llm).not.toHaveBeenCalled()
    expect(result).toEqual({ identifications: [], mergeSuspected: [], usedLLM: false })
  })

  it('surfaces a diarization merge when one label self-names twice', async () => {
    const llm = vi.fn(async () =>
      JSON.stringify([
        { speaker: 'Speaker 5', name: 'Santiago de la Colina' },
        { speaker: 'Speaker 5', name: 'Emanuel Rojas' }
      ])
    )
    const turns: SpeakerTurn[] = [
      { speaker: 'Speaker 5', text: 'Soy Santiago de la Colina.' },
      { speaker: 'Speaker 5', text: 'Y yo soy Emanuel Rojas.' }
    ]
    const result = await extractSelfIdentifications(turns, { llm })
    expect(result.identifications).toEqual([])
    expect(result.mergeSuspected).toEqual([{ label: 'Speaker 5', names: ['Santiago de la Colina', 'Emanuel Rojas'] }])
  })
})

describe('parseSpeakerTurns', () => {
  it('parses a transcript speakers JSON column into {speaker,text} turns', () => {
    const json = JSON.stringify([
      { speaker: 'Speaker 1', start: 0, end: 5, text: 'Hola.' },
      { speaker: 'Speaker 2', start: 5, end: 8, text: '  ' }, // dropped (empty)
      { speaker: 'Speaker 2', start: 8, end: 12, text: 'Soy Ana.' }
    ])
    expect(parseSpeakerTurns(json)).toEqual([
      { speaker: 'Speaker 1', text: 'Hola.' },
      { speaker: 'Speaker 2', text: 'Soy Ana.' }
    ])
    expect(parseSpeakerTurns(null)).toEqual([])
    expect(parseSpeakerTurns('not json')).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Binding (impure, DB + resolver mocked)
// ---------------------------------------------------------------------------

describe('runSelfIdentificationForRecording — binding', () => {
  const llm = vi.fn(async () =>
    JSON.stringify([{ speaker: 'Speaker 7', name: 'Santiago de la Colina' }])
  )

  it('creates/resolves the contact and writes the speaker map + tiered resolution', async () => {
    currentSpeakers = JSON.stringify([
      { speaker: 'Speaker 7', start: 0, end: 4, text: 'Yo también Seba, eh, Santiago de la Colina.' }
    ])
    // No existing contact → resolver returns a miss, so we upsert by newName.
    mockResolveContact.mockReturnValue({ id: null, confidence: 0, method: 'none' })
    mockAssignSpeaker.mockReturnValue({ id: 'contact-123', name: 'Santiago de la Colina' })

    const result = await runSelfIdentificationForRecording('rec-1', { llm })

    expect(result).toMatchObject({ bound: 1, mergeSuspected: 0, skipped: false })
    expect(mockAssignSpeaker).toHaveBeenCalledWith('rec-1', 'Speaker 7', {
      newName: 'Santiago de la Colina'
    })
    // Tiered mention-resolution recorded with the self-identification method.
    expect(mockResolveMention).toHaveBeenCalledWith(
      'rec-1',
      'Santiago de la Colina',
      'contact-123',
      'self-identification',
      SELF_ID_CONFIDENCE
    )
  })

  it('links an existing contact when the resolver is confident (no duplicate)', async () => {
    currentSpeakers = JSON.stringify([
      { speaker: 'Speaker 7', start: 0, end: 4, text: 'Soy Santiago de la Colina.' }
    ])
    mockResolveContact.mockReturnValue({ id: 'existing-9', confidence: 0.95, method: 'exact-name' })
    mockAssignSpeaker.mockReturnValue({ id: 'existing-9', name: 'Santiago de la Colina' })

    await runSelfIdentificationForRecording('rec-2', { llm })

    expect(mockAssignSpeaker).toHaveBeenCalledWith('rec-2', 'Speaker 7', { contactId: 'existing-9' })
  })

  it('NEVER overwrites an existing (manual) speaker binding', async () => {
    currentSpeakers = JSON.stringify([
      { speaker: 'Speaker 7', start: 0, end: 4, text: 'Soy Santiago de la Colina.' }
    ])
    // The user already bound Speaker 7 to someone.
    mockGetSpeakerMap.mockReturnValue([{ speaker_label: 'Speaker 7' }])
    mockResolveContact.mockReturnValue({ id: null, confidence: 0, method: 'none' })

    const result = await runSelfIdentificationForRecording('rec-3', { llm })

    expect(result.bound).toBe(0)
    expect(mockAssignSpeaker).not.toHaveBeenCalled()
    expect(mockResolveMention).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Signal-tier ordering
// ---------------------------------------------------------------------------

describe('self-identification signal tier', () => {
  it('ranks just below connector-email and above calendar/attendee signals', () => {
    expect(methodPriority('self-identification')).toBeLessThan(methodPriority('connector-email'))
    expect(methodPriority('self-identification')).toBeGreaterThan(methodPriority('attendee-email'))
    expect(methodPriority('self-identification')).toBeGreaterThan(methodPriority('attendee-context'))
    expect(methodConfidence('self-identification')).toBeCloseTo(0.97)
  })

  it('is not overwritten by a weaker attendee signal, but yields to a connector email', () => {
    expect(canUpgrade('self-identification', 'attendee-context')).toBe(false)
    expect(canUpgrade('self-identification', 'attendee-email')).toBe(false)
    expect(canUpgrade('self-identification', 'connector-email')).toBe(true)
    // A self-identification DOES upgrade a prior weaker resolution.
    expect(canUpgrade('attendee-context', 'self-identification')).toBe(true)
  })
})
