// @vitest-environment node

import { describe, it, expect } from 'vitest'
import { extractGraphFromTranscript } from '../src/extract.js'
import type { LlmExtractor } from '../src/extract.js'

const CLEAN_JSON = JSON.stringify({
  people: [
    { name: 'Alice', skills: ['TypeScript', 'React'] },
    { name: 'Bob', skills: ['GenAI'] },
  ],
  topics: ['Architecture', 'Performance'],
  projects: ['Project Phoenix'],
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

  it('returns empty result on completely invalid JSON', async () => {
    const result = await extractGraphFromTranscript(
      'transcript',
      { meetingId: 'meeting-5' },
      fakeLlm('Sorry, I cannot help with that.')
    )
    expect(result.people).toHaveLength(0)
    expect(result.topics).toHaveLength(0)
  })

  it('handles partial JSON gracefully (missing keys default to empty)', async () => {
    const partial = JSON.stringify({ people: [{ name: 'Eve' }] })
    const result = await extractGraphFromTranscript(
      'transcript',
      { meetingId: 'meeting-6' },
      fakeLlm(partial)
    )
    expect(result.people[0].name).toBe('Eve')
    expect(result.topics).toHaveLength(0)
    expect(result.action_items).toHaveLength(0)
  })

  it('filters out people with empty names', async () => {
    const json = JSON.stringify({
      people: [{ name: '' }, { name: 'Valid Person' }],
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
      people: [{ name: 'Alice' }, { name: 'Alice' }],
      topics: ['Auth', 'auth', 'AUTH'],
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

    it('a fully-personal meeting yields empty work lists', async () => {
      const json = JSON.stringify({
        people: [{ name: 'Kelly' }], topics: ['health'], projects: [],
        decisions: [{ text: 'Start physio next week', category: 'personal' }],
        action_items: [{ text: 'Call the clinic', owner: 'Kelly', category: 'personal' }],
        risks: [], next_steps: [{ text: 'Follow up on results', category: 'personal' }],
      })
      const result = await extractGraphFromTranscript('t', { meetingId: 'all-personal' }, fakeLlm(json))
      expect(result.decisions).toEqual([])
      expect(result.action_items).toEqual([])
      expect(result.next_steps).toEqual([])
      // topics/projects/people are not item-level personal content and pass through
      expect(result.topics).toEqual(['health'])
    })
  })
})
