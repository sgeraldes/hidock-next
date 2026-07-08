import { describe, it, expect } from 'vitest'
import { computeCoMention, mentionKey, type MentionResult } from '../mentionEvidence'

const result = (recordingIds: string[]): MentionResult => ({ snippets: [], recordingIds })

describe('mentionKey', () => {
  it('normalizes case and whitespace', () => {
    expect(mentionKey('  Yaraví  ')).toBe('yaraví')
  })
})

describe('computeCoMention', () => {
  it('flags a shared recording as decisive negative evidence', () => {
    const co = computeCoMention(result(['r1', 'r2']), result(['r2', 'r3']))
    expect(co.coMention).toBe(true)
    expect(co.recordingIds).toEqual(['r2'])
  })

  it('is false when the two names never share a recording', () => {
    const co = computeCoMention(result(['r1']), result(['r2', 'r3']))
    expect(co.coMention).toBe(false)
    expect(co.recordingIds).toEqual([])
  })

  it('is false when either side is missing or empty', () => {
    expect(computeCoMention(undefined, result(['r1'])).coMention).toBe(false)
    expect(computeCoMention(result([]), result(['r1'])).coMention).toBe(false)
  })

  it('dedupes shared ids', () => {
    const co = computeCoMention(result(['r1', 'r1', 'r2']), result(['r1']))
    expect(co.recordingIds).toEqual(['r1'])
  })
})
