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
  getQueueItems: vi.fn(() => []),
  // P2 — used by the boot backfill; the direct runSelfIdentificationForRecording
  // tests pass shouldPersist explicitly so this default is unused there.
  isRecordingProcessable: () => true
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
  corroborateSelfIds,
  reliableSelfNames,
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
// Corroboration — the conservative naming guard (no voice fingerprint from text)
// ---------------------------------------------------------------------------

describe('reliableSelfNames', () => {
  it('captures a name from an explicit first-person predicate', () => {
    expect(reliableSelfNames('Soy Sebastián, del equipo de producto.')).toEqual(['Sebastián'])
    expect(reliableSelfNames('Me llamo Juan Pérez.')).toEqual(['Juan'])
    expect(reliableSelfNames('My name is Tom Baker.')).toEqual(['Tom'])
    expect(reliableSelfNames('Santiago here, ready.')).toContain('Santiago')
  })

  it('does NOT capture from the loose "Yo también <addressee>" / "Aquí" cues', () => {
    // The token after these is often an ADDRESSEE, not the self-name — excluded so
    // they never block a legitimate binding.
    expect(reliableSelfNames('Yo también Seba, eh, Santiago de la Colina.')).toEqual([])
    expect(reliableSelfNames('Aquí María tiene el archivo.')).toEqual([])
  })

  it('does NOT capture from a third-party address', () => {
    expect(reliableSelfNames('Gracias, Mariana, ya te lo paso.')).toEqual([])
  })
})

describe('corroborateSelfIds', () => {
  const id = (label: string, name: string) => ({ label, name, confidence: SELF_ID_CONFIDENCE })

  it('keeps a self-ID reliably stated under its own label', () => {
    const analyzed = { identifications: [id('Speaker 5', 'Mariana')], mergeSuspected: [] }
    const turns: SpeakerTurn[] = [{ speaker: 'Speaker 5', text: 'Soy Mariana, encantada.' }]
    const res = corroborateSelfIds(analyzed, turns)
    expect(res.identifications).toEqual([id('Speaker 5', 'Mariana')])
    expect(res.uncorroborated).toEqual([])
  })

  it('keeps the nuanced roll-call form where the self-name is not cue-adjacent', () => {
    // "Yo también Seba, eh, Santiago …" — no RELIABLE cue, but "Santiago" IS spoken
    // in the label's cue turn, so it corroborates. This is the real user recording.
    const analyzed = { identifications: [id('Speaker 7', 'Santiago de la Colina')], mergeSuspected: [] }
    const turns: SpeakerTurn[] = [{ speaker: 'Speaker 7', text: 'Yo también Seba, eh, Santiago de la Colina.' }]
    const res = corroborateSelfIds(analyzed, turns)
    expect(res.identifications).toEqual([id('Speaker 7', 'Santiago de la Colina')])
  })

  it('DROPS a cross-identity mislabel — "soy Sebastián" turn proposed as "Mariana"', () => {
    // The exact reported bug: a turn that is clearly the male owner, confidently
    // named as a different (female) person. The label reliably states "Sebastián",
    // so binding "Mariana" is an identity contradiction → keep "Speaker N".
    const analyzed = { identifications: [id('Speaker 3', 'Mariana')], mergeSuspected: [] }
    const turns: SpeakerTurn[] = [{ speaker: 'Speaker 3', text: 'Soy Sebastián, del equipo.' }]
    const res = corroborateSelfIds(analyzed, turns)
    expect(res.identifications).toEqual([])
    expect(res.uncorroborated).toEqual([id('Speaker 3', 'Mariana')])
  })

  it('DROPS a wrong-label attribution — a name never spoken under that label', () => {
    // Mariana self-identifies under Speaker 5; the LLM mis-attributes her to
    // Speaker 3, whose own cue turn never says "Mariana". Speaker 3 stays neutral.
    const analyzed = { identifications: [id('Speaker 3', 'Mariana')], mergeSuspected: [] }
    const turns: SpeakerTurn[] = [
      { speaker: 'Speaker 3', text: 'Soy Roberto, de finanzas.' },
      { speaker: 'Speaker 5', text: 'Soy Mariana.' }
    ]
    const res = corroborateSelfIds(analyzed, turns)
    expect(res.identifications).toEqual([])
    expect(res.uncorroborated).toEqual([id('Speaker 3', 'Mariana')])
  })

  it('DROPS a third-party address the LLM mistook for a self-name', () => {
    // "Gracias, Mariana" is not a cue turn, so "Mariana" is not treated as this
    // speaker's own name even though it was spoken under the label.
    const analyzed = { identifications: [id('Speaker 2', 'Mariana')], mergeSuspected: [] }
    const turns: SpeakerTurn[] = [
      { speaker: 'Speaker 2', text: 'Gracias, Mariana, ya te lo paso.' },
      { speaker: 'Speaker 4', text: 'Soy Ana.' }
    ]
    const res = corroborateSelfIds(analyzed, turns)
    expect(res.identifications).toEqual([])
    expect(res.uncorroborated).toEqual([id('Speaker 2', 'Mariana')])
  })

  it('flags a label reliably stating TWO distinct names as merge-suspected (no bind)', () => {
    const analyzed = { identifications: [id('Speaker 4', 'Santiago')], mergeSuspected: [] }
    const turns: SpeakerTurn[] = [
      { speaker: 'Speaker 4', text: 'Soy Santiago.' },
      { speaker: 'Speaker 4', text: 'Y también soy Emanuel, jaja.' }
    ]
    const res = corroborateSelfIds(analyzed, turns)
    expect(res.identifications).toEqual([])
    expect(res.mergeSuspected.map((m) => m.label)).toContain('Speaker 4')
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

  it('drops an LLM name the label never actually stated (keeps Speaker N)', async () => {
    // A buggy/hallucinating LLM attributes "Mariana" to Speaker 3, but Speaker 3's
    // only cue turn says "Soy Roberto". Corroboration drops the false name.
    const llm = vi.fn(async () =>
      JSON.stringify([
        { speaker: 'Speaker 3', name: 'Mariana' },
        { speaker: 'Speaker 5', name: 'Ana' }
      ])
    )
    const turns: SpeakerTurn[] = [
      { speaker: 'Speaker 3', text: 'Soy Roberto, de finanzas.' },
      { speaker: 'Speaker 5', text: 'Soy Ana.' }
    ]
    const result = await extractSelfIdentifications(turns, { llm })
    expect(result.identifications.map((i) => `${i.label}=${i.name}`)).toEqual(['Speaker 5=Ana'])
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

  it('P2 (round-3) — shouldPersist()=false persists no bindings/markers and sends nothing to the LLM', async () => {
    currentSpeakers = JSON.stringify([
      { speaker: 'Speaker 7', start: 0, end: 4, text: 'Yo también Seba, eh, Santiago de la Colina.' }
    ])
    const gatedLlm = vi.fn(async () => JSON.stringify([{ speaker: 'Speaker 7', name: 'Santiago de la Colina' }]))
    mockResolveContact.mockReturnValue({ id: null, confidence: 0, method: 'none' })

    const result = await runSelfIdentificationForRecording('rec-inelig', {
      llm: gatedLlm,
      shouldPersist: () => false
    })

    expect(result.skipped).toBe(true)
    expect(result.bound).toBe(0)
    // Pre-LLM gate — the turns are never sent to the provider…
    expect(gatedLlm).not.toHaveBeenCalled()
    // …and no contact/binding/mention is written.
    expect(mockAssignSpeaker).not.toHaveBeenCalled()
    expect(mockResolveMention).not.toHaveBeenCalled()
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

  it('does NOT name a turn when the LLM contradicts the spoken self-name (the Mariana bug)', async () => {
    // Speaker 3 clearly says "Soy Sebastián" (male owner); the LLM confidently
    // proposes "Mariana" (a different, female person). No name is written — the
    // turn keeps its neutral "Speaker N" — because a wrong confident name is worse.
    currentSpeakers = JSON.stringify([{ speaker: 'Speaker 3', start: 0, end: 4, text: 'Soy Sebastián, del equipo.' }])
    mockResolveContact.mockReturnValue({ id: null, confidence: 0, method: 'none' })
    const badLlm = vi.fn(async () => JSON.stringify([{ speaker: 'Speaker 3', name: 'Mariana' }]))

    const result = await runSelfIdentificationForRecording('rec-mariana', { llm: badLlm })

    expect(result.bound).toBe(0)
    expect(mockAssignSpeaker).not.toHaveBeenCalled()
    expect(mockResolveMention).not.toHaveBeenCalled()
  })

  it('names a turn when the self-ID IS corroborated by the spoken words', async () => {
    currentSpeakers = JSON.stringify([{ speaker: 'Speaker 5', start: 0, end: 4, text: 'Soy Mariana, encantada.' }])
    mockResolveContact.mockReturnValue({ id: null, confidence: 0, method: 'none' })
    mockAssignSpeaker.mockReturnValue({ id: 'c-mariana', name: 'Mariana' })
    const goodLlm = vi.fn(async () => JSON.stringify([{ speaker: 'Speaker 5', name: 'Mariana' }]))

    const result = await runSelfIdentificationForRecording('rec-ok', { llm: goodLlm })

    expect(result.bound).toBe(1)
    expect(mockAssignSpeaker).toHaveBeenCalledWith('rec-ok', 'Speaker 5', { newName: 'Mariana' })
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
