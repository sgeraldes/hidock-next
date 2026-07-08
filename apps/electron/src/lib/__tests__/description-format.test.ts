import { describe, it, expect } from 'vitest'
import {
  linkify,
  normalizeDescriptionLines,
  parseDescriptionBlocks,
  extractMeetingUrl
} from '../description-format'

describe('linkify', () => {
  it('splits a URL out of surrounding text', () => {
    const tokens = linkify('Join at https://zoom.us/j/123 now')
    expect(tokens).toEqual([
      { kind: 'text', value: 'Join at ' },
      { kind: 'link', value: 'https://zoom.us/j/123', href: 'https://zoom.us/j/123' },
      { kind: 'text', value: ' now' }
    ])
  })

  it('keeps trailing punctuation out of the href', () => {
    const tokens = linkify('See https://example.com/page).')
    const link = tokens.find((t) => t.kind === 'link')
    expect(link).toEqual({ kind: 'link', value: 'https://example.com/page', href: 'https://example.com/page' })
    // the trailing ")." remains as text
    expect(tokens[tokens.length - 1]).toEqual({ kind: 'text', value: ').' })
  })

  it('returns a single text token when there is no URL', () => {
    expect(linkify('plain text')).toEqual([{ kind: 'text', value: 'plain text' }])
  })
})

describe('normalizeDescriptionLines', () => {
  it('joins a lone bullet marker with the following line', () => {
    const raw = ['*', 'First item', '*', 'Second item'].join('\n')
    expect(normalizeDescriptionLines(raw)).toEqual(['- First item', '- Second item'])
  })

  it('normalizes inline bullet markers to a dash', () => {
    expect(normalizeDescriptionLines('* Alpha\n- Beta\n• Gamma')).toEqual(['- Alpha', '- Beta', '- Gamma'])
  })

  it('collapses runs of blank lines and trims edges', () => {
    const raw = '\n\nIntro\n\n\n\nBody\n\n'
    expect(normalizeDescriptionLines(raw)).toEqual(['Intro', '', 'Body'])
  })

  it('drops a lone marker with nothing after it', () => {
    expect(normalizeDescriptionLines('Text\n*')).toEqual(['Text'])
  })
})

describe('parseDescriptionBlocks', () => {
  it('groups bullets into a list and prose into paragraphs', () => {
    const raw = 'Agenda:\n*\nReview roadmap\n*\nAssign owners\n\nThanks all'
    const blocks = parseDescriptionBlocks(raw)
    expect(blocks).toHaveLength(3)
    expect(blocks[0].type).toBe('paragraph')
    expect(blocks[1].type).toBe('list')
    expect(blocks[1].lines).toHaveLength(2)
    expect(blocks[1].lines[0][0]).toEqual({ kind: 'text', value: 'Review roadmap' })
    expect(blocks[2].type).toBe('paragraph')
  })

  it('linkifies URLs inside list items', () => {
    const blocks = parseDescriptionBlocks('- Join https://teams.microsoft.com/l/xyz')
    expect(blocks[0].type).toBe('list')
    const tokens = blocks[0].lines[0]
    expect(tokens.some((t) => t.kind === 'link' && t.href === 'https://teams.microsoft.com/l/xyz')).toBe(true)
  })

  it('returns an empty array for blank input', () => {
    expect(parseDescriptionBlocks('')).toEqual([])
    expect(parseDescriptionBlocks(null)).toEqual([])
    expect(parseDescriptionBlocks('   ')).toEqual([])
  })
})

describe('extractMeetingUrl', () => {
  it('finds a Teams URL embedded in the description', () => {
    const desc = 'Blah blah\nJoin the meeting: https://teams.microsoft.com/l/meetup-join/abc\nMore text'
    expect(extractMeetingUrl(desc)).toBe('https://teams.microsoft.com/l/meetup-join/abc')
  })

  it('finds Zoom and Google Meet links', () => {
    expect(extractMeetingUrl('https://us02web.zoom.us/j/999')).toBe('https://us02web.zoom.us/j/999')
    expect(extractMeetingUrl('meet here https://meet.google.com/abc-defg-hij')).toBe(
      'https://meet.google.com/abc-defg-hij'
    )
  })

  it('ignores non-conferencing URLs', () => {
    expect(extractMeetingUrl('docs at https://example.com/agenda')).toBeNull()
  })

  it('strips trailing punctuation and returns null when absent', () => {
    expect(extractMeetingUrl('(https://zoom.us/j/1).')).toBe('https://zoom.us/j/1')
    expect(extractMeetingUrl(null)).toBeNull()
    expect(extractMeetingUrl('no links here')).toBeNull()
  })
})
