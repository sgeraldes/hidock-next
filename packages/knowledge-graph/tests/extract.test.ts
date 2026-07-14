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
  decisions: ['Move to microservices'],
  action_items: [{ text: 'Write ADR', owner: 'Alice' }],
  risks: [{ text: 'Timeline risk', raised_by: 'Bob' }],
  next_steps: ['Schedule follow-up'],
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
})
