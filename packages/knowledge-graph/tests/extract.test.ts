// @vitest-environment node

import { describe, it, expect } from 'vitest'
import {
  extractGraphFromTranscript,
  ExtractionError,
  SchemaError,
  DEFAULT_SCHEMA_REPAIR_POLICY,
} from '../src/extract.js'
import type { LlmExtractor, SchemaRepairPolicy } from '../src/extract.js'

const CLEAN_JSON = JSON.stringify({
  people: [
    { name: 'Alice', skills: ['TypeScript', 'React'], category: 'work' },
    { name: 'Bob', skills: ['GenAI'], category: 'work' },
  ],
  topics: [
    { text: 'Architecture', category: 'work' },
    { text: 'Performance', category: 'work' },
  ],
  projects: [{ text: 'Project Phoenix', category: 'work' }],
  decisions: [{ text: 'Move to microservices', category: 'work' }],
  action_items: [{ text: 'Write ADR', owner: 'Alice', category: 'work' }],
  risks: [{ text: 'Timeline risk', raised_by: 'Bob', category: 'work' }],
  next_steps: [{ text: 'Schedule follow-up', category: 'work' }],
})

const CODE_FENCED_JSON = `\`\`\`json\n${CLEAN_JSON}\n\`\`\``
const PROSE_WRAPPED_JSON = `Here is the extracted data:\n\n${CLEAN_JSON}\n\nEnd of extraction.`
const MESSY_JSON = `\`\`\`\n${CLEAN_JSON}\n\`\`\``

describe('extractGraphFromTranscript', () => {
  const fakeLlm = (response: string): LlmExtractor =>
    async (_prompt: string) => response

  it('parses clean JSON correctly', async () => {
    const result = await extractGraphFromTranscript(
      'Alice and Bob discussed architecture.',
      { meetingId: 'meeting-1', title: 'Arch Review', date: '2026-06-01' },
      fakeLlm(CLEAN_JSON)
    )

    expect(result.people).toHaveLength(2)
    expect(result.people[0].name).toBe('Alice')
    expect(result.people[0].skills).toEqual(['TypeScript', 'React'])
    expect(result.people[1].name).toBe('Bob')
    expect(result.topics).toEqual(['Architecture', 'Performance'])
    expect(result.projects).toEqual(['Project Phoenix'])
    expect(result.decisions).toEqual(['Move to microservices'])
    expect(result.action_items).toHaveLength(1)
    expect(result.action_items[0].text).toBe('Write ADR')
    expect(result.action_items[0].owner).toBe('Alice')
    expect(result.risks).toHaveLength(1)
    expect(result.risks[0].text).toBe('Timeline risk')
    expect(result.risks[0].raised_by).toBe('Bob')
    expect(result.next_steps).toEqual(['Schedule follow-up'])
  })

  it('strips ```json code fences', async () => {
    const result = await extractGraphFromTranscript(
      'transcript',
      { meetingId: 'meeting-2' },
      fakeLlm(CODE_FENCED_JSON)
    )
    expect(result.people).toHaveLength(2)
    expect(result.topics).toContain('Architecture')
  })

  it('strips plain ``` code fences', async () => {
    const result = await extractGraphFromTranscript(
      'transcript',
      { meetingId: 'meeting-3' },
      fakeLlm(MESSY_JSON)
    )
    expect(result.people).toHaveLength(2)
  })

  it('handles prose wrapped around JSON', async () => {
    const result = await extractGraphFromTranscript(
      'transcript',
      { meetingId: 'meeting-4' },
      fakeLlm(PROSE_WRAPPED_JSON)
    )
    expect(result.people).toHaveLength(2)
    expect(result.projects).toContain('Project Phoenix')
  })

  it('throws ExtractionError on completely invalid JSON (no {...} block)', async () => {
    // Task 4.1: invalid JSON (nothing parseable, no `{...}` object) now raises a
    // typed ExtractionError instead of silently degrading to an empty result,
    // so the ingest path can leave the transcript unmarked and retryable.
    await expect(
      extractGraphFromTranscript(
        'transcript',
        { meetingId: 'meeting-5' },
        fakeLlm('Sorry, I cannot help with that.')
      )
    ).rejects.toBeInstanceOf(ExtractionError)
  })

  it('throws ExtractionError when a {...} block is present but is not parseable JSON', async () => {
    await expect(
      extractGraphFromTranscript(
        'transcript',
        { meetingId: 'meeting-5b' },
        fakeLlm('{ this is not valid json, }')
      )
    ).rejects.toBeInstanceOf(ExtractionError)
  })

  it('throws SchemaError when the payload is valid JSON but the top level is not an object', async () => {
    // Valid JSON, wrong top-level shape → SchemaError (a subclass of
    // ExtractionError so one guard catches both). An array top level embeds a
    // `{...}` so it parses, but asObj() rejects the array.
    await expect(
      extractGraphFromTranscript(
        'transcript',
        { meetingId: 'meeting-5c' },
        fakeLlm('[{ "people": [] }]')
      )
    ).rejects.toBeInstanceOf(SchemaError)
    // SchemaError IS an ExtractionError (single-catch ergonomics).
    await expect(
      extractGraphFromTranscript(
        'transcript',
        { meetingId: 'meeting-5d' },
        fakeLlm('[{ "people": [] }]')
      )
    ).rejects.toBeInstanceOf(ExtractionError)
  })

  it('treats a valid schema-compliant object with empty/missing arrays as a successful empty extraction', async () => {
    // Req 2.4: valid JSON object, all lists empty (or missing → default []),
    // is a SUCCESS, not an error.
    const empty = await extractGraphFromTranscript(
      'transcript',
      { meetingId: 'meeting-5e' },
      fakeLlm('{}')
    )
    expect(empty).toEqual({
      people: [],
      topics: [],
      projects: [],
      decisions: [],
      action_items: [],
      risks: [],
      next_steps: [],
    })
  })

  it('handles partial JSON gracefully (missing keys default to empty)', async () => {
    // Task 2.4: people are now item-level classified — an untagged person is
    // fail-closed dropped, so a partial `{ people: [{ name: 'Eve' }] }` (no
    // category) yields no people. Only explicitly-work items survive.
    const partial = JSON.stringify({ people: [{ name: 'Eve' }] })
    const result = await extractGraphFromTranscript(
      'transcript',
      { meetingId: 'meeting-6' },
      fakeLlm(partial)
    )
    expect(result.people).toHaveLength(0)
    expect(result.topics).toHaveLength(0)
    expect(result.action_items).toHaveLength(0)
  })

  it('filters out people with empty names', async () => {
    const json = JSON.stringify({
      people: [
        { name: '', category: 'work' },
        { name: 'Valid Person', category: 'work' },
      ],
      topics: [],
      projects: [],
      decisions: [],
      action_items: [],
      risks: [],
      next_steps: [],
    })
    const result = await extractGraphFromTranscript(
      'transcript',
      { meetingId: 'meeting-7' },
      fakeLlm(json)
    )
    expect(result.people).toHaveLength(1)
    expect(result.people[0].name).toBe('Valid Person')
  })

  it('de-duplicates repeated items within one meeting result', async () => {
    const json = JSON.stringify({
      people: [
        { name: 'Alice', category: 'work' },
        { name: 'Alice', category: 'work' },
      ],
      topics: [
        { text: 'Auth', category: 'work' },
        { text: 'auth', category: 'work' },
        { text: 'AUTH', category: 'work' },
      ],
      projects: [],
      decisions: [
        { text: 'Move ticket 9529 to done', category: 'work' },
        { text: 'move ticket 9529 to done', category: 'work' },
        { text: 'Move ticket 9529 to done!', category: 'work' },
      ],
      action_items: [
        { text: 'Reassign the ticket to Kelly', owner: 'Kelly', category: 'work' },
        { text: 'reassign the ticket to kelly', owner: 'Kelly', category: 'work' },
      ],
      risks: [],
      next_steps: [],
    })
    const result = await extractGraphFromTranscript(
      'transcript',
      { meetingId: 'dedup-1' },
      fakeLlm(json)
    )
    expect(result.decisions).toEqual(['Move ticket 9529 to done'])
    expect(result.action_items).toHaveLength(1)
    expect(result.action_items[0].text).toBe('Reassign the ticket to Kelly')
    expect(result.topics).toEqual(['Auth'])
    expect(result.people).toHaveLength(1)
  })

  it('keeps a decision and an action that share the same text (different lists)', async () => {
    const json = JSON.stringify({
      people: [], topics: [], projects: [],
      decisions: [{ text: 'Move to Sev-3', category: 'work' }, { text: 'Move to Sev-3', category: 'work' }],
      action_items: [{ text: 'Move to Sev-3', category: 'work' }, { text: 'Move to Sev-3', category: 'work' }],
      risks: [], next_steps: [],
    })
    const result = await extractGraphFromTranscript(
      'transcript',
      { meetingId: 'dedup-2' },
      fakeLlm(json)
    )
    expect(result.decisions).toEqual(['Move to Sev-3'])
    expect(result.action_items).toHaveLength(1)
    expect(result.action_items[0].text).toBe('Move to Sev-3')
  })

  // -------------------------------------------------------------------------
  // Personal-content full-drop at the parse boundary (privacy)
  // -------------------------------------------------------------------------
  describe('personal-content filtering', () => {
    it('drops personal-tagged decisions/actions/risks/next_steps, keeps work ones', async () => {
      const json = JSON.stringify({
        people: [], topics: [], projects: [],
        decisions: [
          { text: 'Ship EVA25 behind a flag', category: 'work' },
          { text: 'Proceed with surgery on the 30th', category: 'personal' },
        ],
        action_items: [
          { text: 'Kelly to update the Jira board', owner: 'Kelly', category: 'work' },
          { text: 'Ask GP about anesthesia type', owner: 'Kelly', category: 'personal' },
        ],
        risks: [
          { text: 'Timeline risk on the release', raised_by: 'Bob', category: 'work' },
          { text: 'Recovery time may affect availability', raised_by: 'Kelly', category: 'personal' },
        ],
        next_steps: [
          { text: 'Book the sprint review', category: 'work' },
          { text: 'Book the hospital pre-op', category: 'personal' },
        ],
      })
      const result = await extractGraphFromTranscript('t', { meetingId: 'mixed-1' }, fakeLlm(json))
      expect(result.decisions).toEqual(['Ship EVA25 behind a flag'])
      expect(result.action_items).toEqual([{ text: 'Kelly to update the Jira board', owner: 'Kelly' }])
      expect(result.risks).toEqual([{ text: 'Timeline risk on the release', raised_by: 'Bob' }])
      expect(result.next_steps).toEqual(['Book the sprint review'])
      // No personal text survives anywhere.
      const blob = JSON.stringify(result).toLowerCase()
      expect(blob).not.toContain('surgery')
      expect(blob).not.toContain('anesthesia')
      expect(blob).not.toContain('hospital')
      expect(blob).not.toContain('recovery')
    })

    it('treats a MISSING category as personal and drops it (privacy-safe default)', async () => {
      const json = JSON.stringify({
        people: [], topics: [], projects: [],
        decisions: [
          { text: 'Tagged work decision', category: 'work' },
          { text: 'Untagged decision' }, // no category → dropped
        ],
        action_items: [{ text: 'Untagged action', owner: 'X' }], // no category → dropped
        risks: [], next_steps: [],
      })
      const result = await extractGraphFromTranscript('t', { meetingId: 'missing-cat' }, fakeLlm(json))
      expect(result.decisions).toEqual(['Tagged work decision'])
      expect(result.action_items).toEqual([])
    })

    it('treats an UNKNOWN/other category as personal and drops it', async () => {
      const json = JSON.stringify({
        people: [], topics: [], projects: [],
        decisions: [
          { text: 'Real work item', category: 'work' },
          { text: 'Weird category item', category: 'confidential' },
          { text: 'Case check', category: 'WORK' }, // case-insensitive → kept
        ],
        action_items: [], risks: [], next_steps: [],
      })
      const result = await extractGraphFromTranscript('t', { meetingId: 'unknown-cat' }, fakeLlm(json))
      expect(result.decisions).toEqual(['Real work item', 'Case check'])
    })

    it('a fully-personal meeting yields empty lists across every field', async () => {
      // Task 2.4: people/topics/projects are now item-level classified too, so a
      // fully-personal meeting drops EVERYTHING — no personal text survives in
      // ANY output field (Req 1.7).
      const json = JSON.stringify({
        people: [{ name: 'Kelly', category: 'personal' }],
        topics: [{ text: 'health', category: 'personal' }],
        projects: [{ text: 'kitchen renovation', category: 'personal' }],
        decisions: [{ text: 'Start physio next week', category: 'personal' }],
        action_items: [{ text: 'Call the clinic', owner: 'Kelly', category: 'personal' }],
        risks: [], next_steps: [{ text: 'Follow up on results', category: 'personal' }],
      })
      const result = await extractGraphFromTranscript('t', { meetingId: 'all-personal' }, fakeLlm(json))
      expect(result.people).toEqual([])
      expect(result.topics).toEqual([])
      expect(result.projects).toEqual([])
      expect(result.decisions).toEqual([])
      expect(result.action_items).toEqual([])
      expect(result.next_steps).toEqual([])
      // No personal text survives in ANY output field.
      const blob = JSON.stringify(result).toLowerCase()
      expect(blob).not.toContain('health')
      expect(blob).not.toContain('kitchen')
      expect(blob).not.toContain('physio')
      expect(blob).not.toContain('clinic')
    })

    it('drops personal people/topics/projects, keeps the work ones (mixed)', async () => {
      const json = JSON.stringify({
        people: [
          { name: 'Alice', skills: ['TypeScript'], category: 'work' },
          { name: 'Dr Green', category: 'personal' },
        ],
        topics: [
          { text: 'Release planning', category: 'work' },
          { text: 'physio schedule', category: 'personal' },
        ],
        projects: [
          { text: 'Project Phoenix', category: 'work' },
          { text: 'house move', category: 'personal' },
        ],
        decisions: [], action_items: [], risks: [], next_steps: [],
      })
      const result = await extractGraphFromTranscript('t', { meetingId: 'mixed-ppt' }, fakeLlm(json))
      expect(result.people).toEqual([{ name: 'Alice', skills: ['TypeScript'] }])
      expect(result.topics).toEqual(['Release planning'])
      expect(result.projects).toEqual(['Project Phoenix'])
      const blob = JSON.stringify(result).toLowerCase()
      expect(blob).not.toContain('green')
      expect(blob).not.toContain('physio')
      expect(blob).not.toContain('house move')
    })

    it('drops untagged bare-string / untagged-object people/topics/projects (fail-closed)', async () => {
      const json = JSON.stringify({
        people: [{ name: 'Untagged Person' }],
        topics: ['bare topic', { text: 'untagged object topic' }],
        projects: ['bare project'],
        decisions: [], action_items: [], risks: [], next_steps: [],
      })
      const result = await extractGraphFromTranscript('t', { meetingId: 'untagged-ppt' }, fakeLlm(json))
      expect(result.people).toEqual([])
      expect(result.topics).toEqual([])
      expect(result.projects).toEqual([])
    })

    it('retains case-insensitive work topics/projects', async () => {
      const json = JSON.stringify({
        people: [],
        topics: [{ text: 'Latency', category: 'WORK' }],
        projects: [{ text: 'Phoenix', category: 'Work' }],
        decisions: [], action_items: [], risks: [], next_steps: [],
      })
      const result = await extractGraphFromTranscript('t', { meetingId: 'case-ppt' }, fakeLlm(json))
      expect(result.topics).toEqual(['Latency'])
      expect(result.projects).toEqual(['Phoenix'])
    })
  })
})

// ---------------------------------------------------------------------------
// Task 4.9 — optional bounded schema-repair retry (Req 2.6)
//
// Repair is OFF by default, DISTINCT from transport retry (it re-invokes the
// injected extractor directly with no backoff), and FAIL-CLOSED on private
// content (re-parsing runs the identical personal filter, so repair can only
// recover work-tagged, schema-valid items). Fixtures are synthetic; no real
// transcript/model content appears.
// ---------------------------------------------------------------------------

// A valid, schema-compliant, work-only extraction object (synthetic).
const REPAIRED_WORK_JSON = JSON.stringify({
  people: [{ name: 'Alice', skills: ['TypeScript'], category: 'work' }],
  topics: [{ text: 'Release planning', category: 'work' }],
  projects: [{ text: 'Project Phoenix', category: 'work' }],
  decisions: [{ text: 'Ship EVA25 behind a flag', category: 'work' }],
  action_items: [{ text: 'Kelly to update the Jira board', owner: 'Kelly', category: 'work' }],
  risks: [{ text: 'Timeline risk on the release', raised_by: 'Bob', category: 'work' }],
  next_steps: [{ text: 'Book the sprint review', category: 'work' }],
})

// A payload that is VALID JSON but the top level is not an object → SchemaError.
const SCHEMA_BAD_JSON = '[{ "people": [] }]'

describe('extractGraphFromTranscript — bounded schema-repair retry (Req 2.6)', () => {
  // An extractor that returns a scripted sequence of responses, one per call,
  // and records how many times it was invoked.
  const scriptedLlm = (responses: string[]): LlmExtractor & { calls: number } => {
    let i = 0
    const fn = (async (_prompt: string) => {
      const r = responses[Math.min(i, responses.length - 1)]
      i++
      return r
    }) as LlmExtractor & { calls: number }
    Object.defineProperty(fn, 'calls', { get: () => i })
    return fn
  }

  it('(a) repair DISABLED by default → SchemaError still thrown, no re-prompt', async () => {
    const llm = scriptedLlm([SCHEMA_BAD_JSON, REPAIRED_WORK_JSON])
    await expect(
      // No policy passed → DEFAULT_SCHEMA_REPAIR_POLICY (maxRepairAttempts: 0).
      extractGraphFromTranscript('t', { meetingId: 'repair-off' }, llm)
    ).rejects.toBeInstanceOf(SchemaError)
    // Default is disabled: the extractor is called exactly once (initial), never
    // re-prompted for repair.
    expect(llm.calls).toBe(1)
    expect(DEFAULT_SCHEMA_REPAIR_POLICY.maxRepairAttempts).toBe(0)
  })

  it('(b) repair ENABLED, bad-then-valid → returns the valid work-only result within the bound', async () => {
    const llm = scriptedLlm([SCHEMA_BAD_JSON, REPAIRED_WORK_JSON])
    const policy: SchemaRepairPolicy = { maxRepairAttempts: 1 }
    const result = await extractGraphFromTranscript('t', { meetingId: 'repair-ok' }, llm, policy)
    // Recovered the work-only content on the single repair attempt.
    expect(result.people).toEqual([{ name: 'Alice', skills: ['TypeScript'] }])
    expect(result.decisions).toEqual(['Ship EVA25 behind a flag'])
    expect(result.action_items).toEqual([{ text: 'Kelly to update the Jira board', owner: 'Kelly' }])
    // Initial call + exactly one repair re-prompt = 2 calls (bounded).
    expect(llm.calls).toBe(2)
  })

  it('(b2) repair loop is DISTINCT from transport retry — invalid JSON in repair is not re-tried here', async () => {
    // First a SchemaError (eligible for repair), then the repair produces invalid
    // JSON (an ExtractionError, a transport-shaped failure). The schema-repair
    // loop does NOT own transport failures: it surfaces the ExtractionError
    // instead of burning further repair attempts, keeping the two concerns
    // separate.
    const llm = scriptedLlm([SCHEMA_BAD_JSON, 'Sorry, I cannot help with that.', REPAIRED_WORK_JSON])
    const policy: SchemaRepairPolicy = { maxRepairAttempts: 3 }
    await expect(
      extractGraphFromTranscript('t', { meetingId: 'repair-transport-split' }, llm, policy)
    ).rejects.toBeInstanceOf(ExtractionError)
    // Initial + one repair (which produced invalid JSON) = 2 calls; the loop
    // stopped rather than continuing to attempt 2/3, because invalid JSON is a
    // transport concern, not a schema-repair concern.
    expect(llm.calls).toBe(2)
  })

  it('(c) repair ENABLED but never valid within the bound → throws SchemaError, no silent empty success', async () => {
    // Every response is schema-bad. With maxRepairAttempts: 2 the extractor is
    // called 3 times total (1 initial + 2 repairs) and then the SchemaError is
    // thrown — never a silent empty result.
    const llm = scriptedLlm([SCHEMA_BAD_JSON, SCHEMA_BAD_JSON, SCHEMA_BAD_JSON, REPAIRED_WORK_JSON])
    const policy: SchemaRepairPolicy = { maxRepairAttempts: 2 }
    await expect(
      extractGraphFromTranscript('t', { meetingId: 'repair-exhausted' }, llm, policy)
    ).rejects.toBeInstanceOf(SchemaError)
    // Bounded: 1 initial + 2 repair attempts = 3; the 4th (valid) response is
    // never reached.
    expect(llm.calls).toBe(3)
  })

  it('(d) repaired output "valid" only via untagged/personal items → those items are STILL dropped (fail-closed)', async () => {
    // The repair returns a schema-valid OBJECT, but it is non-empty ONLY because
    // it contains untagged and personal-tagged items. Re-parsing applies the
    // identical fail-closed personal filter, so NONE of that content survives:
    // repair cannot smuggle private content into a non-empty result.
    const smuggled = JSON.stringify({
      people: [{ name: 'Dr Green', category: 'personal' }, { name: 'Untagged Person' }],
      topics: ['bare topic', { text: 'physio schedule', category: 'personal' }],
      projects: [{ text: 'house move', category: 'personal' }],
      decisions: [{ text: 'Proceed with surgery on the 30th', category: 'personal' }, { text: 'Untagged decision' }],
      action_items: [{ text: 'Ask GP about anesthesia type', owner: 'Kelly', category: 'personal' }],
      risks: [{ text: 'Recovery time may affect availability', category: 'personal' }],
      next_steps: [{ text: 'Book the hospital pre-op', category: 'personal' }],
    })
    const llm = scriptedLlm([SCHEMA_BAD_JSON, smuggled])
    const policy: SchemaRepairPolicy = { maxRepairAttempts: 1 }
    // The repaired object parses (schema-valid), so extraction "succeeds" — but
    // every item is dropped fail-closed, yielding all-empty lists.
    const result = await extractGraphFromTranscript('t', { meetingId: 'repair-fail-closed' }, llm, policy)
    expect(result).toEqual({
      people: [],
      topics: [],
      projects: [],
      decisions: [],
      action_items: [],
      risks: [],
      next_steps: [],
    })
    // No untagged/personal text survives anywhere — repair cannot relax privacy.
    const blob = JSON.stringify(result).toLowerCase()
    expect(blob).not.toContain('green')
    expect(blob).not.toContain('untagged')
    expect(blob).not.toContain('physio')
    expect(blob).not.toContain('house move')
    expect(blob).not.toContain('surgery')
    expect(blob).not.toContain('anesthesia')
    expect(blob).not.toContain('recovery')
    expect(blob).not.toContain('hospital')
  })

  it('a non-schema ExtractionError (invalid JSON) is NEVER routed through repair even when enabled', async () => {
    // Invalid JSON on the initial call is a transport-shaped ExtractionError, not
    // a SchemaError, so the repair loop must not engage — it is re-thrown after
    // exactly one call.
    const llm = scriptedLlm(['Sorry, I cannot help with that.', REPAIRED_WORK_JSON])
    const policy: SchemaRepairPolicy = { maxRepairAttempts: 3 }
    await expect(
      extractGraphFromTranscript('t', { meetingId: 'invalid-json-no-repair' }, llm, policy)
    ).rejects.toBeInstanceOf(ExtractionError)
    // A SchemaError would be a subclass; assert it is NOT one so we know the
    // invalid-JSON path (not the schema path) was taken.
    await expect(
      extractGraphFromTranscript('t', { meetingId: 'invalid-json-no-repair-2' }, scriptedLlm(['not json']), policy)
    ).rejects.not.toBeInstanceOf(SchemaError)
    expect(llm.calls).toBe(1)
  })
})
